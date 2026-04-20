import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL || "https://api.firecrawl.dev";
const FRESH_MAX_AGE_MS = 0;

const urls = {
  hansolar: "https://lightlens.vercel.app/traders/0x9b8d146ab4b61c281b993e3f85066249a6e9b0db",
  giver: "https://legacy.hyperdash.com/trader/0x8fc7c0442e582bca195978c5a4fdec2e7c5bb0f7",
  erebos911: "https://hypurrscan.io/address/0x79cc76364b5fb263a25bd52930e3d9788fcfeea8#perps",
  coinbender: "https://hypurrscan.io/address/0x4829f3bbd5508707339547ebefface2b4c86d3b5#perps",
  smallcap: "https://hypurrscan.io/address/0x93f8e02c6cf992e262069d5f5bb9b80033a5ce77#perps",
  nyp: "https://app.lighter.xyz/public-pools/281474976624925",
  coinsense: "https://www.coinsense.app/vault",
  hyperdash: "https://hyperdash.com/explore",
};

function valueToNumber(value) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

function cleanCell(value) {
  return String(value || "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\\/g, "")
    .trim();
}

function splitMarkdownRow(line) {
  return line.trim().slice(1, -1).split("|").map(cleanCell);
}

function extractTables(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tables = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = splitMarkdownRow(trimmed);
      const isDivider = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
      if (isDivider) continue;
      if (!current) current = { header: cells, rows: [] };
      else current.rows.push(cells);
      continue;
    }

    if (current) {
      tables.push(current);
      current = null;
    }
  }

  if (current) tables.push(current);
  return tables;
}

function categoryFor(symbol) {
  const normalized = String(symbol || "").toUpperCase();
  if (/(XAU|XCU|WTI|CL|OIL|GOLD|BRENTOIL|URA|XYZ100)/.test(normalized)) return "macro";
  return "crypto";
}

function sideFromText(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("short")) return "short";
  if (normalized.includes("long")) return "long";
  return "unknown";
}

async function scrapeMarkdown(url, { outputDir, name, formats = ["markdown"], waitFor = 7000 } = {}) {
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
    screenshot: parsed.screenshot || parsed.data?.screenshot || null,
    raw: parsed,
  };
}

function parseLightLensTrader(markdown) {
  const table = extractTables(markdown).find((candidate) => candidate.header.includes("Symbol") && candidate.header.includes("Position Value"));
  if (!table) return [];
  return table.rows.map((row) => {
    const symbol = row[0];
    return {
      symbol,
      side: sideFromText(row[2]),
      position_value_usd: valueToNumber(row[4]),
      entry: row[3],
      unrealized_pnl: row[5],
      category: categoryFor(symbol),
    };
  }).filter((position) => position.symbol && position.side !== "unknown");
}

function parseHypurrscanTrader(markdown) {
  const table = extractTables(markdown).find((candidate) => candidate.header.includes("Token") && candidate.header.includes("Side") && candidate.header.includes("Value"));
  if (!table) return [];
  return table.rows.map((row) => {
    const symbol = row[0];
    return {
      symbol,
      side: sideFromText(row[1]),
      leverage: row[2],
      position_value_usd: valueToNumber(row[3]),
      size: row[4],
      entry: row[5],
      mark: row[7],
      unrealized_pnl: row[8],
      funding: row[9],
      liquidation: row[10],
      category: categoryFor(symbol),
    };
  }).filter((position) => position.symbol && position.side !== "unknown");
}

function parseGiverTrader(markdown) {
  const compact = markdown.replace(/!\[[^\]]*]\([^)]*\)/g, " ").replace(/\s+/g, " ");
  const btc = compact.match(/BTC\s+\d+×\s+([^$]+?)\s+(\$[\d,.]+)/);
  const aster = compact.match(/ASTER\s+\d+×\s+([^$]+?)\s+(\$[\d,.]+)/);
  const positions = [];
  if (btc) positions.push({ symbol: "BTC", side: btc[1].trim().startsWith("-") ? "short" : "long", size: btc[1].trim(), position_value_usd: valueToNumber(btc[2]), category: "crypto" });
  if (aster) positions.push({ symbol: "ASTER", side: aster[1].trim().startsWith("-") ? "short" : "long", size: aster[1].trim(), position_value_usd: valueToNumber(aster[2]), category: "crypto" });
  return positions;
}

function parseCoinsense(markdown) {
  const table = extractTables(markdown).find((candidate) => candidate.header.includes("Coin") && candidate.header.includes("Position Value"));
  const accountValue = markdown.match(/Account Value\s+###\s+(\$[\d,.]+)/s)?.[1] || "Unavailable";
  const longsRatio = markdown.match(/Longs Ratio\s+###\s+([\d.]+%)/s)?.[1] || "Unavailable";
  const shortsRatio = markdown.match(/Shorts Ratio\s+###\s+([\d.]+%)/s)?.[1] || "Unavailable";
  const positions = (table?.rows || []).slice(0, 20).map((row) => ({
    rank: Number(row[0]),
    coin: row[1],
    size: row[2],
    position_value: row[3],
    unrealized_pnl: row[4],
    side: sideFromText(row[5]),
  })).filter((position) => position.coin && position.side !== "unknown");

  return {
    source: "CoinSense Vault",
    account_value: accountValue,
    longs_ratio: longsRatio,
    shorts_ratio: shortsRatio,
    positions,
  };
}

function parseHyperdashCohorts(markdown) {
  const expected = [
    ["extremely_profitable", "Extremely Profitable"],
    ["very_profitable", "Very Profitable"],
    ["profitable", "Profitable"],
    ["unprofitable", "Unprofitable"],
    ["very_unprofitable", "Very Unprofitable"],
    ["rekt", "Rekt"],
  ];
  const expectedBySlug = new Map(expected);
  const normalized = markdown.replace(/\\/g, "");
  const sectionStart = normalized.indexOf("All-Time PNL");
  const sectionEnd = normalized.indexOf("Account Size", sectionStart);
  const section = normalized.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd);
  const blocks = new Map();
  const linkPattern = /\[([\s\S]*?)]\(https:\/\/hyperdash\.com\/explore\/cohorts\/([a-z_]+)\)/g;
  let match;

  while ((match = linkPattern.exec(section))) {
    const [, rawBlock, slug] = match;
    if (!expectedBySlug.has(slug)) continue;
    const parts = rawBlock.split(/\n+/).map((part) => part.trim()).filter(Boolean);
    const money = parts.filter((part) => /^\$[\d,.]+M$/.test(part));
    const sentiment = parts.find((part) => /^(Slightly Bearish|Slightly Bullish|Bullish|Bearish|Neutral)$/.test(part)) || "Neutral";
    const pnlRange = parts.find((part) => /PNL$/.test(part)) || "";
    const arrow = sentiment.includes("Bearish") ? "↓" : sentiment.includes("Bullish") ? "↑" : "→";
    blocks.set(slug, {
      cohort: `
${expectedBySlug.get(slug)} (${pnlRange})`.trim(),
      sentiment: `
${sentiment} ${arrow}`.trim(),
      long: money[0] || "Unavailable",
      short: money[1] || "Unavailable",
    });
  }

  return expected.map(([slug]) => blocks.get(slug)).filter(Boolean);
}

function parseLighterPool(markdown) {
  const apr = markdown.match(/APR\s+([\d.]+%)/s)?.[1] || markdown.match(/APR\s*\n\s*([\d.]+%)/s)?.[1] || "Unavailable";
  const tvl = markdown.match(/TVL\s+(\$[\d,.]+)/s)?.[1] || markdown.match(/TVL\s*\n\s*(\$[\d,.]+)/s)?.[1] || "Unavailable";
  const positionCount = markdown.match(/Positions \((\d+)\)/)?.[1] || "unknown";
  const table = extractTables(markdown).find((candidate) => candidate.header.includes("Market") && candidate.header.includes("Position Value"));
  const positions = (table?.rows || []).filter((row) => row.length >= 9 && row[0]).map((row) => ({
    symbol: row[0],
    side: String(row[1] || row[0]).toUpperCase().includes("BTC") ? "short" : "unknown",
    size: row[1],
    position_value_usd: valueToNumber(row[2]),
    entry: row[3],
    mark: row[4],
    liquidation: row[5],
    unrealized_pnl: row[6],
    margin: row[7],
    funding: row[8],
    category: categoryFor(row[0]),
  })).filter((position) => position.position_value_usd > 0);

  return {
    name: "NYP_Not Your Pool",
    display_name: "NYP — Not YOUR Pool",
    source: "Lighter.xyz",
    account_stats: `APR ${apr} | TVL ${tvl} | Positions (${positionCount}) | live text rows ${positions.length ? "available" : "unavailable"}`,
    status: positions.length ? undefined : "positions_unavailable",
    positions,
  };
}

export async function collectMarketViewInput({ outputDir = join("runs", "market-view", "live-source-cache") } = {}) {
  const cacheDir = join(outputDir, "sources");
  await mkdir(cacheDir, { recursive: true });

  const [hansolar, giver, erebos, coinbender, smallcap, nyp, coinsense, hyperdash] = await Promise.all([
    scrapeMarkdown(urls.hansolar, { outputDir: cacheDir, name: "hansolar" }),
    scrapeMarkdown(urls.giver, { outputDir: cacheDir, name: "giver" }),
    scrapeMarkdown(urls.erebos911, { outputDir: cacheDir, name: "erebos911" }),
    scrapeMarkdown(urls.coinbender, { outputDir: cacheDir, name: "coinbender" }),
    scrapeMarkdown(urls.smallcap, { outputDir: cacheDir, name: "smallcap" }),
    scrapeMarkdown(urls.nyp, { outputDir: cacheDir, name: "nyp" }),
    scrapeMarkdown(urls.coinsense, { outputDir: cacheDir, name: "coinsense", formats: ["markdown", "screenshot"] }),
    scrapeMarkdown(urls.hyperdash, { outputDir: cacheDir, name: "hyperdash" }),
  ]);

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
        source: "LightLens",
        account_stats: "Live scrape maxAge=0",
        positions: parseLightLensTrader(hansolar.markdown),
      },
      {
        name: "Giver",
        display_name: "Giver",
        source: "Hyperdash Legacy",
        account_stats: "Live scrape maxAge=0",
        positions: parseGiverTrader(giver.markdown),
      },
      {
        name: "Erebos911",
        display_name: "Erebos911",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        status: parseHypurrscanTrader(erebos.markdown).length ? undefined : "no_active_positions",
        positions: parseHypurrscanTrader(erebos.markdown),
      },
      {
        name: "coinbender_lfg",
        display_name: "coinbender_lfg",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        positions: parseHypurrscanTrader(coinbender.markdown),
      },
      {
        name: "SmallCapScientist",
        display_name: "SmallCapScientist",
        source: "Hypurrscan",
        account_stats: "Live scrape maxAge=0",
        positions: parseHypurrscanTrader(smallcap.markdown),
      },
      parseLighterPool(nyp.markdown),
    ],
    coinsense: parseCoinsense(coinsense.markdown),
    hyperdash_cohorts: parseHyperdashCohorts(hyperdash.markdown),
  };

  await writeFile(join(outputDir, "live-input.json"), JSON.stringify(input, null, 2));
  return input;
}
