import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  FIRECRAWL_API_URL,
  FIRECRAWL_MIN_INTERVAL_MS,
  FIRECRAWL_SOURCE_CONCURRENCY,
  FRESH_MAX_AGE_MS,
  HYPERLIQUID_INFO_URL,
  marketViewHypurrscanOrderSources,
  sourceUrls,
} from "../config.js";
import {
  parseDeriveOptionPositions,
  parseHyperliquidAccountStats,
  parseHyperliquidAssetPositions,
  parseHyperdashCohorts,
  parseHypurrscanOpenOrders,
  parseHypurrscanTrader,
  parseLightLensTrader,
  parseLighterPool,
  parseLighterPoolStats,
} from "./parsers.js";
import { collectPearVault } from "./pear-vault.js";

const execFileAsync = promisify(execFile);

let firecrawlSchedule = Promise.resolve();
let nextFirecrawlRequestAt = 0;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFirecrawlSlot(minIntervalMs = FIRECRAWL_MIN_INTERVAL_MS) {
  let release;
  const ticket = new Promise((resolve) => { release = resolve; });
  const previous = firecrawlSchedule;
  firecrawlSchedule = previous.then(async () => {
    const waitMs = Math.max(0, nextFirecrawlRequestAt - Date.now());
    if (waitMs) await delay(waitMs);
    nextFirecrawlRequestAt = Date.now() + minIntervalMs;
    release();
  }, release);
  await ticket;
}

export async function runLimited(tasks, limit = 5) {
  const results = [];
  for (let index = 0; index < tasks.length; index += limit) {
    const batch = tasks.slice(index, index + limit);
    results.push(...await Promise.all(batch.map((task) => task())));
  }
  return results;
}

export async function scrapeMarkdown(url, {
  outputDir,
  name,
  formats = ["markdown"],
  waitFor = 7000,
  timeout = 45000,
  maxAttempts = 4,
  minIntervalMs = FIRECRAWL_MIN_INTERVAL_MS,
} = {}) {
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${name}.json`);

  if (process.env.FIRECRAWL_API_KEY) {
    let lastBody = null;
    let lastStatus = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await waitForFirecrawlSlot(minIntervalMs);
      const response = await fetch(`${FIRECRAWL_API_URL}/v2/scrape`, {
        method: "POST",
        signal: AbortSignal.timeout(timeout + 5000),
        headers: {
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url, formats, waitFor, timeout, maxAge: FRESH_MAX_AGE_MS }),
      });
      const body = await response.json();
      lastBody = body;
      lastStatus = response.status;
      await writeFile(outputPath, JSON.stringify(body, null, 2));
      if (response.ok) {
        return {
          markdown: body.markdown || body.data?.markdown || "",
          html: body.html || body.data?.html || "",
          screenshot: body.screenshot || body.data?.screenshot || null,
          raw: body,
        };
      }

      if (![408, 429].includes(response.status) || attempt === maxAttempts) break;
      const retryAfter = Number(response.headers.get("retry-after"));
      const resetAt = String(body.error || "").match(/resets at (.+)$/)?.[1];
      const resetDelay = resetAt ? new Date(resetAt).getTime() - Date.now() : 0;
      const waitMs = Math.max(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0,
        Number.isFinite(resetDelay) ? resetDelay : 0,
        response.status === 408 ? 750 * attempt : 1500 * attempt,
      );
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 65000)));
    }

    throw new Error(`Firecrawl scrape failed for ${name}: ${lastStatus} ${JSON.stringify(lastBody)}`);
  }

  const cliOutputPath = join(outputDir, `${name}.md`);
  await execFileAsync("firecrawl", [
    "scrape",
    url,
    "--format",
    formats.join(","),
    "--wait-for",
    String(waitFor),
    "--timeout",
    String(timeout),
    "--max-age",
    String(FRESH_MAX_AGE_MS),
    "-o",
    cliOutputPath,
  ], {
    cwd: process.cwd(),
    maxBuffer: 30 * 1024 * 1024,
    env: process.env,
  });

  const content = await readFile(cliOutputPath, "utf8");
  if (formats.length === 1 && formats[0] === "markdown") return { markdown: content, screenshot: null, raw: content };
  const parsed = JSON.parse(content);
  return {
    markdown: parsed.markdown || parsed.data?.markdown || "",
    html: parsed.html || parsed.data?.html || "",
    screenshot: parsed.screenshot || parsed.data?.screenshot || null,
    raw: parsed,
  };
}

function unavailableScrapeResult(name, error) {
  return {
    markdown: "",
    html: "",
    screenshot: null,
    raw: null,
    status: "unavailable",
    source_name: name,
    error: error.message,
  };
}

async function optionalScrapeMarkdown(url, options) {
  try {
    return await scrapeMarkdown(url, options);
  } catch (error) {
    await mkdir(options.outputDir, { recursive: true });
    await writeFile(join(options.outputDir, `${options.name}.error.txt`), error.message);
    return unavailableScrapeResult(options.name, error);
  }
}

export function vaultAddressFromUrl(url) {
  const address = String(url || "").match(/\/vault\/(0x[a-fA-F0-9]{40})(?:[/?#]|$)/)?.[1];
  if (!address) throw new Error(`Expected Hypurrscan vault URL, received: ${url}`);
  return address;
}

export async function fetchHyperliquidClearinghouseState(user, { outputDir, name, dex = "" } = {}) {
  await mkdir(outputDir, { recursive: true });
  const response = await fetch(HYPERLIQUID_INFO_URL, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clearinghouseState", user, ...(dex ? { dex } : {}) }),
  });
  const body = await response.json();
  await writeFile(join(outputDir, `${name}.json`), JSON.stringify(body, null, 2));
  if (!response.ok) throw new Error(`Hyperliquid state fetch failed for ${name}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function optionalHyperliquidState(url, { outputDir, name, dexes = [""] } = {}) {
  try {
    const user = hypurrscanWalletFromUrl(url);
    if (!user) throw new Error(`Could not extract a Hyperliquid wallet from ${url}`);
    const states = await Promise.all(dexes.map((dex) => fetchHyperliquidClearinghouseState(user, {
      outputDir,
      name: dexes.length > 1 ? `${name}-${dex || "default"}` : name,
      dex,
    })));
    const state = states.length > 1
      ? { ...states[0], assetPositions: states.flatMap((entry) => entry.assetPositions || []) }
      : states[0];
    return {
      state,
      status: "available",
      source_name: name,
      dexes,
    };
  } catch (error) {
    return {
      state: null,
      status: "unavailable",
      source_name: name,
      error: error.message,
    };
  }
}

export async function fetchPearTraderApi(url, { outputDir, name } = {}) {
  await mkdir(outputDir, { recursive: true });
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  await writeFile(join(outputDir, `${name}.json`), JSON.stringify(body, null, 2));
  if (!response.ok) throw new Error(`Pear trader API fetch failed for ${name}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function optionalPearTraderApi(url, { outputDir, name } = {}) {
  try {
    return {
      payload: await fetchPearTraderApi(url, { outputDir, name }),
      status: "available",
      source_name: name,
    };
  } catch (error) {
    return {
      payload: null,
      status: "unavailable",
      source_name: name,
      error: error.message,
    };
  }
}

function withPositionSource(positions, source) {
  return positions.map((position) => ({ ...position, source }));
}

export function hypurrscanOrdersUrl(url) {
  const base = String(url || "").replace(/#.*$/, "");
  return base ? `${base}#orders` : "";
}

function hypurrscanWalletFromUrl(url) {
  return String(url || "").match(/\/(?:address|vault)\/(0x[a-fA-F0-9]{40})(?:[/?#]|$)/)?.[1]?.toLowerCase() || null;
}

function summarizeOpenOrders(orders) {
  const sum = (predicate) => orders
    .filter(predicate)
    .reduce((total, order) => total + (order.value_usd_approx || 0), 0);
  return {
    markets: new Set(orders.map((order) => order.symbol)).size,
    grouped_orders: orders.length,
    reported_orders: orders.reduce((total, order) => total + (order.order_count || 0), 0),
    conditional_value_usd: sum(() => true),
    buy_value_usd: sum((order) => order.side === "BUY" || order.side === "BID"),
    sell_value_usd: sum((order) => order.side === "SELL" || order.side === "ASK"),
  };
}

export function attachOpenOrders(traders, sourceDefinitions, scrapeResults) {
  const byEntity = new Map();
  sourceDefinitions.forEach((source, index) => {
    const result = scrapeResults[index] || { markdown: "", status: "unavailable", error: "No scrape result" };
    const orders = parseHypurrscanOpenOrders(result.markdown).map((order) => ({
      ...order,
      source: source.label,
      source_url: hypurrscanOrdersUrl(source.url),
      wallet_address: hypurrscanWalletFromUrl(source.url),
    }));
    const entries = byEntity.get(source.entity) || [];
    entries.push({ source, result, orders });
    byEntity.set(source.entity, entries);
  });

  return traders.map((trader) => {
    const entries = byEntity.get(trader.name) || [];
    if (!entries.length) {
      return {
        ...trader,
        open_orders: [],
        open_orders_status: "unsupported",
        open_order_summary: summarizeOpenOrders([]),
      };
    }

    const orders = entries.flatMap((entry) => entry.orders);
    const failed = entries.filter((entry) => entry.result.status === "unavailable").length;
    const status = failed === entries.length
      ? "unavailable"
      : failed > 0
        ? "partial"
        : orders.length > 0 ? "available" : "empty";

    return {
      ...trader,
      open_orders: orders,
      open_orders_status: status,
      open_order_summary: summarizeOpenOrders(orders),
    };
  });
}

export async function collectHypurrscanOpenOrders({ outputDir, maxAttempts = 4 } = {}) {
  if (!outputDir) throw new Error("collectHypurrscanOpenOrders requires outputDir");
  return runLimited(
    marketViewHypurrscanOrderSources.map((source) => () => optionalScrapeMarkdown(
      hypurrscanOrdersUrl(source.url),
      { outputDir, name: `${source.id}-orders`, timeout: 60000, maxAttempts },
    )),
    1,
  );
}

export async function collectMarketViewInput({
  outputDir = join("runs", "market-view", "live-source-cache"),
  includeOpenOrders = true,
  sourceConcurrency = FIRECRAWL_SOURCE_CONCURRENCY,
  scrapeMaxAttempts = 4,
} = {}) {
  const cacheDir = join(outputDir, "sources");
  await mkdir(cacheDir, { recursive: true });
  const scrape = (url, options) => optionalScrapeMarkdown(url, {
    ...options,
    maxAttempts: scrapeMaxAttempts,
  });

  const [
    hansolarLightlens,
    hansolarHypurrscan,
    hansolarLighter,
    kyotoHypurrscan,
    giver,
    vuongMcDerive,
    onchainSorcerer,
    onchainSorcererAlt,
    coinbender,
    cryptoCondom,
    degenDuck,
    tommy,
    tommyAlt,
    bmwball56,
    convexityBtc,
    fhdHypurrscan,
    imBallzyHypurrscan,
    hyperdash,
    moritzpikeVault,
  ] = await runLimited([
    () => scrape(sourceUrls.hansolarLightlens, { outputDir: cacheDir, name: "hansolar-lightlens", timeout: 60000 }),
    () => optionalHyperliquidState(sourceUrls.hansolarHypurrscan, { outputDir: cacheDir, name: "hansolar-hypurrscan" }),
    () => scrape(sourceUrls.hansolarLighter, { outputDir: cacheDir, name: "hansolar-lighter", formats: ["markdown", "html", "screenshot"] }),
    () => optionalHyperliquidState(sourceUrls.kyotoHypurrscan, { outputDir: cacheDir, name: "kyoto-hypurrscan" }),
    () => fetchHyperliquidClearinghouseState(vaultAddressFromUrl(sourceUrls.giver), { outputDir: cacheDir, name: "giver" }),
    () => scrape(sourceUrls.vuongMcDerive, { outputDir: cacheDir, name: "vuong-mc-derive", formats: ["markdown", "html", "screenshot"], waitFor: 10000, timeout: 60000 }),
    () => optionalHyperliquidState(sourceUrls.onchainSorcerer, { outputDir: cacheDir, name: "onchain-sorcerer" }),
    () => optionalHyperliquidState(sourceUrls.onchainSorcererAlt, { outputDir: cacheDir, name: "onchain-sorcerer-alt" }),
    () => optionalHyperliquidState(sourceUrls.coinbender, { outputDir: cacheDir, name: "coinbender" }),
    () => optionalHyperliquidState(sourceUrls.cryptoCondom, { outputDir: cacheDir, name: "cryptocondom", dexes: ["", "xyz"] }),
    () => optionalHyperliquidState(sourceUrls.degenDuck, { outputDir: cacheDir, name: "degenduck" }),
    () => optionalHyperliquidState(sourceUrls.tommy, { outputDir: cacheDir, name: "tommy" }),
    () => optionalHyperliquidState(sourceUrls.tommyAlt, { outputDir: cacheDir, name: "tommy-alt" }),
    () => optionalHyperliquidState(sourceUrls.bmwball56, { outputDir: cacheDir, name: "bmwball56" }),
    () => optionalHyperliquidState(sourceUrls.convexityBtc, { outputDir: cacheDir, name: "convexity-btc" }),
    () => optionalHyperliquidState(sourceUrls.fhdHypurrscan, { outputDir: cacheDir, name: "fhd" }),
    () => optionalHyperliquidState(sourceUrls.imBallzyHypurrscan, { outputDir: cacheDir, name: "imballzy" }),
    () => scrape(sourceUrls.hyperdash, { outputDir: cacheDir, name: "hyperdash", formats: ["markdown", "screenshot"], timeout: 60000 }),
    async () => {
      try {
        return { ...(await collectPearVault(sourceUrls.pearMoritzpikeVault, { outputDir: cacheDir })), status: "available", source_name: "pear-moritzpike-vault" };
      } catch (error) {
        return { pairPositions: [], positionCount: 0, status: "unavailable", source_name: "pear-moritzpike-vault", error: error.message };
      }
    },
  ], sourceConcurrency);

  const openOrderScrapes = includeOpenOrders
    ? await collectHypurrscanOpenOrders({ outputDir: cacheDir, maxAttempts: scrapeMaxAttempts })
    : [];
  const orderSources = includeOpenOrders ? marketViewHypurrscanOrderSources : [];

  const hansolarLightlensPositions = parseLightLensTrader(hansolarLightlens.markdown);
  const hansolarHypurrscanPositions = parseHyperliquidAssetPositions(hansolarHypurrscan.state);
  const hansolarLighterPositions = parseLighterPool(hansolarLighter.markdown, hansolarLighter.html);
  const kyotoHypurrscanPositions = parseHyperliquidAssetPositions(kyotoHypurrscan.state);
  const vuongMcOptionPositions = parseDeriveOptionPositions(vuongMcDerive.markdown);
  const onchainSorcererPositions = [
    ...withPositionSource(parseHyperliquidAssetPositions(onchainSorcerer.state), "Hyperliquid 0xba4387"),
    ...withPositionSource(parseHyperliquidAssetPositions(onchainSorcererAlt.state), "Hyperliquid 0x1a02b0"),
  ];
  const tommyPositions = [
    ...withPositionSource(parseHyperliquidAssetPositions(tommy.state), "Hyperliquid 0x83b138"),
    ...withPositionSource(parseHyperliquidAssetPositions(tommyAlt.state), "Hyperliquid 0x57B8cF"),
  ];
  const fhdPositions = parseHyperliquidAssetPositions(fhdHypurrscan.state);
  const imBallzyPositions = parseHyperliquidAssetPositions(imBallzyHypurrscan.state);
  const convexityBtcPositions = withPositionSource(
    parseHyperliquidAssetPositions(convexityBtc.state),
    "Hyperliquid",
  );

  const input = {
    run_label: "Market View Live Scrape",
    generated_at: new Date().toISOString(),
    freshness: {
      firecrawl_max_age_ms: FRESH_MAX_AGE_MS,
      note: `Live collection requested with Firecrawl maxAge=0. Sources that do not expose rows are marked unavailable instead of filled from stale fixtures. ${includeOpenOrders ? "Hypurrscan open orders included." : "Open-order collection skipped for the bounded web refresh."}`,
    },
    source_errors: [
      hansolarLightlens,
      hansolarHypurrscan,
      hansolarLighter,
      kyotoHypurrscan,
      vuongMcDerive,
      onchainSorcerer,
      onchainSorcererAlt,
      coinbender,
      cryptoCondom,
      degenDuck,
      tommy,
      tommyAlt,
      bmwball56,
      convexityBtc,
      fhdHypurrscan,
      imBallzyHypurrscan,
      hyperdash,
      moritzpikeVault,
      ...openOrderScrapes,
    ]
      .filter((source) => source.status === "unavailable")
      .map((source) => ({ source: source.source_name, error: source.error })),
    traders: attachOpenOrders([
      {
        name: "Hansolar",
        display_name: "Hansolar ⭐",
        source: "LightLens + Hypurrscan + Lighter",
        account_stats: `Live scrape maxAge=0 | LightLens ${hansolarLightlensPositions.length} rows | Hypurrscan ${hansolarHypurrscanPositions.length} rows | Lighter ${hansolarLighterPositions.length} rows`,
        positions: [
          ...withPositionSource(hansolarLightlensPositions, "LightLens"),
          ...withPositionSource(hansolarHypurrscanPositions, "Hypurrscan"),
          ...withPositionSource(hansolarLighterPositions, "Lighter"),
        ],
      },
      {
        name: "Giver",
        display_name: "Giver",
        source: "Hypurrscan Vault",
        account_stats: parseHyperliquidAccountStats(giver),
        positions: parseHyperliquidAssetPositions(giver),
      },
      {
        name: "VuongMC",
        display_name: "Vương MC",
        source: "Derive Options",
        account_stats: vuongMcOptionPositions.length
          ? `Live Derive scrape maxAge=0 | Wallet 0xe575ff507bbde43aa48315312365253304dfbe63 | ${vuongMcOptionPositions.length} active option position${vuongMcOptionPositions.length === 1 ? "" : "s"}`
          : "Live Derive scrape maxAge=0 | Option positions unavailable from source",
        status: vuongMcOptionPositions.length ? undefined : "positions_unavailable",
        positions: withPositionSource(vuongMcOptionPositions, "Derive"),
      },
      {
        name: "OnchainSorcerer",
        display_name: "OnchainSorcerer 🪄",
        source: "Hypurrscan x2",
        account_stats: "Live scrape maxAge=0 | Wallets 0xba4387ac1a36f648d1044b2f79023d1f42aa8ee3 + 0x1a02b0e7d51cccdeb4b9ebedbca5607872dac5fe",
        status: onchainSorcererPositions.length ? undefined : "no_active_positions",
        positions: onchainSorcererPositions,
      },
      {
        name: "coinbender_lfg",
        display_name: "coinbender_lfg",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        positions: parseHyperliquidAssetPositions(coinbender.state),
      },
      {
        name: "CryptoCondom",
        display_name: "CryptoCondom",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        positions: parseHyperliquidAssetPositions(cryptoCondom.state),
      },
      {
        name: "DegenDuck",
        display_name: "DegenDuck",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        status: parseHyperliquidAssetPositions(degenDuck.state).length ? undefined : "no_active_positions",
        positions: parseHyperliquidAssetPositions(degenDuck.state),
      },
      {
        name: "tommy",
        display_name: "tommy",
        source: "Hypurrscan x2",
        account_stats: "Live scrape maxAge=0 | Wallets 0x83b1385d8126ecf64bfb3b4254d67eb9db753bcc + 0x57B8cFc502f14CC9eF77668D2208f001e1cCB4fC",
        status: tommyPositions.length ? undefined : "no_active_positions",
        positions: tommyPositions,
      },
      {
        name: "bmwball56",
        display_name: "bmwball56",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        status: parseHyperliquidAssetPositions(bmwball56.state).length ? undefined : "no_active_positions",
        positions: parseHyperliquidAssetPositions(bmwball56.state),
      },
      {
        name: "+convexity (BTC)",
        display_name: "+convexity (BTC)",
        source: "Hyperliquid",
        account_stats: convexityBtc.status === "available"
          ? `Live Hyperliquid state | Wallet 0x5661a070eb13c7c55ac3210b2447d4bea426cbf5 | ${convexityBtcPositions.length} active position${convexityBtcPositions.length === 1 ? "" : "s"}`
          : "Live Hyperliquid state unavailable | Wallet 0x5661a070eb13c7c55ac3210b2447d4bea426cbf5",
        status: convexityBtc.status === "unavailable"
          ? "positions_unavailable"
          : convexityBtcPositions.length ? undefined : "no_active_positions",
        positions: convexityBtcPositions,
      },
      {
        name: "fhd",
        display_name: "0xfhd",
        source: "Hypurrscan",
        account_stats: `Live scrape maxAge=0 | Wallet 0x5cbdb794b3b36df58a7ce6c1a552f117f061103b | ${fhdPositions.length} active position${fhdPositions.length === 1 ? "" : "s"}`,
        status: fhdPositions.length ? undefined : "no_active_positions",
        positions: fhdPositions,
      },
      {
        name: "ImBallzy",
        display_name: "ImBallzy",
        source: "Hypurrscan",
        account_stats: `Live scrape maxAge=0 | Wallet 0x39c3492e9171872eac6a99d9c0b6dbae5d4ae959 | ${imBallzyPositions.length} active position${imBallzyPositions.length === 1 ? "" : "s"}`,
        status: imBallzyPositions.length ? undefined : "no_active_positions",
        positions: imBallzyPositions,
      },
      {
        name: "moritzpike vault",
        display_name: "moritzpike vault",
        source: "Pear Vault",
        account_stats: moritzpikeVault.status === "available"
          ? `Live Pear vault | ${moritzpikeVault.positionCount} open pair${moritzpikeVault.positionCount === 1 ? "" : "s"}`
          : "Live Pear vault positions unavailable",
        status: moritzpikeVault.status === "available" ? undefined : "positions_unavailable",
        positions: [],
        pair_positions: moritzpikeVault.pairPositions,
        pair_positions_status: moritzpikeVault.status === "available"
          ? moritzpikeVault.pairPositions.length ? "available" : "empty"
          : "unavailable",
        pair_source_url: sourceUrls.pearMoritzpikeVault,
        pair_profile_url: sourceUrls.pearMoritzpikeVault,
      },
      {
        name: "0xKyoto",
        display_name: "0xKyoto",
        source: "Hypurrscan",
        account_stats: `Live scrape maxAge=0 | Wallet 0x06184a3d663dae6f40420cb536dcab7fe9492475 | ${kyotoHypurrscanPositions.length} active position${kyotoHypurrscanPositions.length === 1 ? "" : "s"}`,
        status: kyotoHypurrscanPositions.length ? undefined : "no_active_positions",
        positions: kyotoHypurrscanPositions,
      },
    ], orderSources, openOrderScrapes),
    hyperdash_cohorts: parseHyperdashCohorts(hyperdash.markdown),
    hyperdash_screenshot_url: hyperdash.screenshot || null,
  };

  await writeFile(join(outputDir, "live-input.json"), JSON.stringify(input, null, 2));
  return input;
}
