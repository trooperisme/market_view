import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FIRECRAWL_API_URL, FRESH_MAX_AGE_MS, sourceUrls } from "../config.js";
import {
  parseCoinsense,
  parseGiverTrader,
  parseHyperdashCohorts,
  parseHypurrscanTrader,
  parseLightLensTrader,
  parseLighterPool,
  parseLighterPoolStats,
} from "./parsers.js";

const execFileAsync = promisify(execFile);

export async function runLimited(tasks, limit = 5) {
  const results = [];
  for (let index = 0; index < tasks.length; index += limit) {
    const batch = tasks.slice(index, index + limit);
    results.push(...await Promise.all(batch.map((task) => task())));
  }
  return results;
}

export async function scrapeMarkdown(url, { outputDir, name, formats = ["markdown"], waitFor = 7000 } = {}) {
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${name}.json`);

  if (process.env.FIRECRAWL_API_KEY) {
    const response = await fetch(`${FIRECRAWL_API_URL}/v2/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats, waitFor, maxAge: FRESH_MAX_AGE_MS }),
    });
    const body = await response.json();
    await writeFile(outputPath, JSON.stringify(body, null, 2));
    if (!response.ok) throw new Error(`Firecrawl scrape failed for ${name}: ${response.status} ${JSON.stringify(body)}`);
    return {
      markdown: body.markdown || body.data?.markdown || "",
      html: body.html || body.data?.html || "",
      screenshot: body.screenshot || body.data?.screenshot || null,
      raw: body,
    };
  }

  const cliOutputPath = join(outputDir, `${name}.md`);
  await execFileAsync("firecrawl", [
    "scrape",
    url,
    "--format",
    formats.join(","),
    "--wait-for",
    String(waitFor),
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

function withPositionSource(positions, source) {
  return positions.map((position) => ({ ...position, source }));
}

export async function collectMarketViewInput({ outputDir = join("runs", "market-view", "live-source-cache") } = {}) {
  const cacheDir = join(outputDir, "sources");
  await mkdir(cacheDir, { recursive: true });

  const [
    hansolarLightlens,
    hansolarHypurrscan,
    hansolarLighter,
    nypLighter,
    kPoolLighter,
    giver,
    onchainSorcerer,
    coinbender,
    cryptoCondom,
    degenDuck,
    tommy,
    bmwball56,
    coinsense,
    hyperdash,
  ] = await runLimited([
    () => scrapeMarkdown(sourceUrls.hansolarLightlens, { outputDir: cacheDir, name: "hansolar-lightlens" }),
    () => scrapeMarkdown(sourceUrls.hansolarHypurrscan, { outputDir: cacheDir, name: "hansolar-hypurrscan" }),
    () => scrapeMarkdown(sourceUrls.hansolarLighter, { outputDir: cacheDir, name: "hansolar-lighter", formats: ["markdown", "html", "screenshot"] }),
    () => scrapeMarkdown(sourceUrls.nypLighter, { outputDir: cacheDir, name: "nyp-lighter", formats: ["markdown", "html", "screenshot"] }),
    () => scrapeMarkdown(sourceUrls.kPoolLighter, { outputDir: cacheDir, name: "k-pool-lighter", formats: ["markdown", "html", "screenshot"] }),
    () => scrapeMarkdown(sourceUrls.giver, { outputDir: cacheDir, name: "giver" }),
    () => scrapeMarkdown(sourceUrls.onchainSorcerer, { outputDir: cacheDir, name: "onchain-sorcerer" }),
    () => scrapeMarkdown(sourceUrls.coinbender, { outputDir: cacheDir, name: "coinbender" }),
    () => scrapeMarkdown(sourceUrls.cryptoCondom, { outputDir: cacheDir, name: "cryptocondom" }),
    () => scrapeMarkdown(sourceUrls.degenDuck, { outputDir: cacheDir, name: "degenduck" }),
    () => scrapeMarkdown(sourceUrls.tommy, { outputDir: cacheDir, name: "tommy" }),
    () => scrapeMarkdown(sourceUrls.bmwball56, { outputDir: cacheDir, name: "bmwball56" }),
    () => scrapeMarkdown(sourceUrls.coinsense, { outputDir: cacheDir, name: "coinsense", formats: ["markdown", "screenshot"] }),
    () => scrapeMarkdown(sourceUrls.hyperdash, { outputDir: cacheDir, name: "hyperdash", formats: ["markdown", "screenshot"] }),
  ]);

  const hansolarLightlensPositions = parseLightLensTrader(hansolarLightlens.markdown);
  const hansolarHypurrscanPositions = parseHypurrscanTrader(hansolarHypurrscan.markdown);
  const hansolarLighterPositions = parseLighterPool(hansolarLighter.markdown, hansolarLighter.html);
  const nypPositions = parseLighterPool(nypLighter.markdown, nypLighter.html);
  const kPoolPositions = parseLighterPool(kPoolLighter.markdown, kPoolLighter.html);

  const input = {
    run_label: "Market View Live Scrape",
    generated_at: new Date().toISOString(),
    freshness: {
      firecrawl_max_age_ms: FRESH_MAX_AGE_MS,
      note: "Live collection requested with Firecrawl maxAge=0. Sources that do not expose rows are marked unavailable instead of filled from stale fixtures.",
    },
    traders: [
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
        source: "Hyperdash Legacy",
        account_stats: "Live scrape maxAge=0",
        positions: parseGiverTrader(giver.markdown),
      },
      {
        name: "OnchainSorcerer",
        display_name: "OnchainSorcerer 🪄",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        status: parseHypurrscanTrader(onchainSorcerer.markdown).length ? undefined : "no_active_positions",
        positions: parseHypurrscanTrader(onchainSorcerer.markdown),
      },
      {
        name: "coinbender_lfg",
        display_name: "coinbender_lfg",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        positions: parseHypurrscanTrader(coinbender.markdown),
      },
      {
        name: "CryptoCondom",
        display_name: "CryptoCondom",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        positions: parseHypurrscanTrader(cryptoCondom.markdown),
      },
      {
        name: "DegenDuck",
        display_name: "DegenDuck",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        status: parseHypurrscanTrader(degenDuck.markdown).length ? undefined : "no_active_positions",
        positions: parseHypurrscanTrader(degenDuck.markdown),
      },
      {
        name: "tommy",
        display_name: "tommy",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        status: parseHypurrscanTrader(tommy.markdown).length ? undefined : "no_active_positions",
        positions: parseHypurrscanTrader(tommy.markdown),
      },
      {
        name: "bmwball56",
        display_name: "bmwball56",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        status: parseHypurrscanTrader(bmwball56.markdown).length ? undefined : "no_active_positions",
        positions: parseHypurrscanTrader(bmwball56.markdown),
      },
      {
        name: "NYP",
        display_name: "NYP — Not YOUR pool",
        source: "Lighter Pool",
        account_stats: parseLighterPoolStats(nypLighter.markdown, nypPositions),
        status: nypPositions.length ? undefined : "positions_unavailable",
        positions: nypPositions,
      },
      {
        name: "K pool",
        display_name: "K pool",
        source: "Lighter Pool",
        account_stats: parseLighterPoolStats(kPoolLighter.markdown, kPoolPositions),
        status: kPoolPositions.length ? undefined : "positions_unavailable",
        positions: kPoolPositions,
      },
    ],
    coinsense: parseCoinsense(coinsense.markdown),
    coinsense_screenshot_url: coinsense.screenshot || null,
    hyperdash_cohorts: parseHyperdashCohorts(hyperdash.markdown),
    hyperdash_screenshot_url: hyperdash.screenshot || null,
  };

  await writeFile(join(outputDir, "live-input.json"), JSON.stringify(input, null, 2));
  return input;
}
