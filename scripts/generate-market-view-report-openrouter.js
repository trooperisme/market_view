#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import { collectMarketViewInput } from "./collect-market-view-data.js";

await loadEnvFile(resolve(".env"));

const DEFAULT_INPUT = "fixtures/market-view/mock-input.json";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";
const COINSENSE_VAULT_URL = "https://www.coinsense.app/vault";
const execFileAsync = promisify(execFile);

async function loadEnvFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function usage() {
  return `
Usage:
  npm run market-view:llm-test
  npm run market-view:llm-test -- --live
  npm run market-view:llm-test -- --input fixtures/market-view/mock-input.json
  npm run market-view:llm-test -- --model openai/gpt-4o

Environment:
  FIRECRAWL_API_KEY is required for live collection unless the local Firecrawl CLI is authenticated.
  OPENROUTER_API_KEY must be set.
  OPENROUTER_MODEL is optional. Default: ${DEFAULT_MODEL}
`.trim();
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    model: DEFAULT_MODEL,
    outputDir: null,
    coinsenseImage: true,
    live: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--input") args.input = argv[++i];
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--output-dir") args.outputDir = argv[++i];
    else if (arg === "--no-coinsense-image") args.coinsenseImage = false;
    else if (arg === "--live") args.live = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function utcStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function numericValue(value) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function sideArrow(side) {
  if (side === "long") return "↑";
  if (side === "short") return "↓";
  return "→";
}

function sideLabel(side) {
  const normalized = String(side || "").toLowerCase();
  if (normalized === "long") return "Long ↑";
  if (normalized === "short") return "Short ↓";
  return "Unknown →";
}

function sentimentForExposure(longPct, shortPct) {
  if (longPct >= 60) return "BULLISH ↑";
  if (shortPct >= 60) return "BEARISH ↓";
  if (longPct === 0 && shortPct === 0) return "NEUTRAL →";
  return "MIXED →";
}

function computeTrader(trader) {
  const positions = trader.positions || [];
  const longExposure = positions
    .filter((position) => position.side === "long")
    .reduce((sum, position) => sum + numericValue(position.position_value_usd), 0);
  const shortExposure = positions
    .filter((position) => position.side === "short")
    .reduce((sum, position) => sum + numericValue(position.position_value_usd), 0);
  const total = longExposure + shortExposure;
  const longPct = total ? (longExposure / total) * 100 : 0;
  const shortPct = total ? (shortExposure / total) * 100 : 0;
  const longBlocks = total ? Math.round((longPct / 100) * 20) : 0;
  const shortBlocks = total ? 20 - longBlocks : 0;
  const visualBar = total ? `${"🟩".repeat(longBlocks)}${"🟥".repeat(shortBlocks)}` : "N/A — No Active Positions";

  return {
    ...trader,
    long_exposure: longExposure,
    short_exposure: shortExposure,
    long_pct: longPct,
    short_pct: shortPct,
    visual_bar: visualBar,
    bias: sentimentForExposure(longPct, shortPct),
  };
}

function buildComputedInput(input) {
  const traders = (input.traders || []).map(computeTrader);
  return { ...input, traders, hyperdash_comparison: computeHyperdashComparison(input.hyperdash_cohorts || []) };
}

function cropPng(buffer, crop) {
  const source = PNG.sync.read(buffer);
  const x = Math.max(0, Math.min(source.width - 1, crop.x));
  const y = Math.max(0, Math.min(source.height - 1, crop.y));
  const width = Math.max(1, Math.min(source.width - x, crop.width));
  const height = Math.max(1, Math.min(source.height - y, crop.height));
  const target = new PNG({ width, height });

  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * source.width + x) * 4;
    const sourceEnd = sourceStart + width * 4;
    const targetStart = row * width * 4;
    source.data.copy(target.data, targetStart, sourceStart, sourceEnd);
  }

  return PNG.sync.write(target);
}

function cropCoinsenseVaultSummary(buffer) {
  const source = PNG.sync.read(buffer);

  // Firecrawl currently returns a 16:9 full-page screenshot for CoinSense.
  // Keep only the main vault chart and three metric cards, removing navigation and the positions table.
  const crop = {
    x: Math.round(source.width * 0.118),
    y: Math.round(source.height * 0.245),
    width: Math.round(source.width * 0.858),
    height: Math.round(source.height * 0.47),
  };

  return cropPng(buffer, crop);
}

async function scrapeCoinsenseScreenshot(scrapeOutputPath) {
  if (process.env.FIRECRAWL_API_KEY) {
    const response = await fetch(`${process.env.FIRECRAWL_API_URL || "https://api.firecrawl.dev"}/v2/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: COINSENSE_VAULT_URL,
        formats: ["markdown", "screenshot"],
        waitFor: 7000,
        maxAge: 0,
      }),
    });
    const body = await response.json();
    await writeFile(scrapeOutputPath, JSON.stringify(body, null, 2));
    if (!response.ok) throw new Error(`Firecrawl API scrape failed: ${response.status} ${JSON.stringify(body)}`);
    return body.screenshot || body.data?.screenshot;
  }

  await execFileAsync("firecrawl", [
    "scrape",
    COINSENSE_VAULT_URL,
    "--format",
    "markdown,screenshot",
    "--wait-for",
    "7000",
    "--pretty",
    "--max-age",
    "0",
    "-o",
    scrapeOutputPath,
  ], {
    cwd: process.cwd(),
    maxBuffer: 25 * 1024 * 1024,
    env: process.env,
  });

  const scrape = JSON.parse(await readFile(scrapeOutputPath, "utf8"));
  return scrape.screenshot || scrape.data?.screenshot;
}

async function captureCoinsenseImage(outputDir, { embedImage = false } = {}) {
  const assetsDir = join(outputDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  const scrapeOutputPath = join(outputDir, "coinsense-screenshot-scrape.json");

  try {
    const screenshotUrl = await scrapeCoinsenseScreenshot(scrapeOutputPath);
    if (!screenshotUrl) throw new Error("Firecrawl scrape returned no screenshot URL.");
    const response = await fetch(screenshotUrl);
    if (!response.ok) throw new Error(`Screenshot download failed: ${response.status}`);
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const croppedImageBuffer = cropCoinsenseVaultSummary(imageBuffer);
    await writeFile(join(assetsDir, "coinsense-vault.png"), croppedImageBuffer);
    return {
      path: embedImage ? `data:image/png;base64,${croppedImageBuffer.toString("base64")}` : "assets/coinsense-vault.png",
      source: COINSENSE_VAULT_URL,
      status: "ok",
    };
  } catch (error) {
    await writeFile(join(outputDir, "coinsense-image-error.txt"), error.message);
    return {
      path: null,
      source: COINSENSE_VAULT_URL,
      status: "unavailable",
      error: error.message,
    };
  }
}

function cohortValueInMillions(value) {
  const raw = String(value || "").replace(/[$,]/g, "").trim();
  const parsed = Number(raw.replace(/[MK]$/i, ""));
  if (!Number.isFinite(parsed)) return 0;
  if (/K$/i.test(raw)) return parsed / 1000;
  return parsed;
}

function computeHyperdashComparison(cohorts) {
  const profitable = cohorts.slice(0, 3);
  const unprofitable = cohorts.slice(3, 6);
  const summarize = (group) => {
    const long = group.reduce((sum, cohort) => sum + cohortValueInMillions(cohort.long), 0);
    const short = group.reduce((sum, cohort) => sum + cohortValueInMillions(cohort.short), 0);
    const total = long + short;
    return {
      long_millions: Number(long.toFixed(2)),
      short_millions: Number(short.toFixed(2)),
      long_pct: total ? Number(((long / total) * 100).toFixed(1)) : 0,
      short_pct: total ? Number(((short / total) * 100).toFixed(1)) : 0,
      net: long > short ? "long" : short > long ? "short" : "neutral",
    };
  };

  return {
    profitable_cohorts: summarize(profitable),
    unprofitable_cohorts: summarize(unprofitable),
  };
}

function buildPrompt(input) {
  return `
You are writing concise market-view commentary for a crypto trader.

Use only the provided JSON. Do not invent unavailable data. Keep language direct and actionable.

Return strict JSON only with this schema:
{
  "quick_reads": [
    { "trader": "exact display_name", "text": "1-2 sentence quick read" }
  ],
  "final_analysis": {
    "hyperdash_cohort_conclusion": "2-3 sentence comparison of profitable vs unprofitable cohorts",
    "crypto_signals": ["2-4 concise bullets"],
    "macro_signals": ["2-4 concise bullets"],
    "coinsense_summary": ["1-2 concise bullets"]
  }
}

Rules:
- Every trader in input.traders must have one quick read.
- Mention directional bias with arrows where natural: bullish ↑, bearish ↓, neutral →, mixed →.
- Distinguish crypto positioning from macro/commodity positioning.
- For CoinSense, emphasize the largest position and overall long/short ratio.
- For Hyperdash, compare profitable cohorts versus unprofitable cohorts using input.hyperdash_comparison.
- Do not write markdown in JSON values.

INPUT JSON:
${JSON.stringify(input, null, 2)}
`.trim();
}

function stripJsonFence(text) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

async function callOpenRouter({ model, input }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to your shell environment or .env runtime.");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost",
      "X-Title": "Crypto Workflow Market View Test",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: buildPrompt(input),
        },
      ],
      temperature: 0.2,
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`OpenRouter request failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`OpenRouter returned no message content: ${JSON.stringify(body)}`);
  }

  return {
    raw: body,
    parsed: JSON.parse(stripJsonFence(content)),
  };
}

function quickReadFor(analysis, displayName) {
  return analysis.quick_reads?.find((read) => read.trader === displayName)?.text || "No quick read returned.";
}

function renderPositionTable(trader) {
  if (!trader.positions?.length) return "";

  const hasSourceColumn = trader.positions.some((position) => position.source);
  const hasLeverageColumn = trader.positions.some((position) => position.leverage);
  const hasSizeColumn = trader.positions.some((position) => position.size);
  const hasEntryColumn = trader.positions.some((position) => position.entry);
  const hasUnrealizedPnlColumn = trader.positions.some((position) => position.unrealized_pnl);
  const rows = trader.positions.map((position) => {
    const value = money(position.position_value_usd);
    const source = hasSourceColumn ? `| ${position.source || "-"} ` : "";
    const cells = [`| ${position.symbol} `];
    if (hasSourceColumn) cells.push(`${position.source || "-"} `);
    cells.push(`${sideLabel(position.side)} `);
    if (hasLeverageColumn) cells.push(`${position.leverage || "-"} `);
    if (hasSizeColumn) cells.push(`${position.size || "-"} `);
    cells.push(`${value} `);
    if (hasEntryColumn) cells.push(`${position.entry || "-"} `);
    if (hasUnrealizedPnlColumn) cells.push(`${position.unrealized_pnl || "-"} `);
    return `${cells.join("| ")}|`;
  });

  const header = ["Symbol"];
  const divider = ["---"];
  if (hasSourceColumn) {
    header.push("Source");
    divider.push("---");
  }
  header.push("Side");
  divider.push("---");
  if (hasLeverageColumn) {
    header.push("Leverage");
    divider.push("---");
  }
  if (hasSizeColumn) {
    header.push("Size");
    divider.push("---:");
  }
  header.push("Position Value");
  divider.push("---:");
  if (hasEntryColumn) {
    header.push("Entry");
    divider.push("---:");
  }
  if (hasUnrealizedPnlColumn) {
    header.push("Unrealized PnL");
    divider.push("---:");
  }

  return [
    `| ${header.join(" | ")} |`,
    `| ${divider.join(" | ")} |`,
    ...rows,
  ].join("\n");
}

function renderReport(input, analysis, model) {
  const lines = [];
  lines.push("# TRADER POSITION ANALYSIS — OPENROUTER TEST REPORT");
  lines.push("");
  lines.push(`Date: ${new Date().toISOString()} | Model: ${model}`);
  lines.push("");
  lines.push("## STEP 1 — Active Positions: Trader Breakdown");

  input.traders.forEach((trader, index) => {
    lines.push("");
    lines.push(`### ${index + 1}. ${trader.display_name}`);
    lines.push("");
    lines.push(`Source: ${trader.source}`);
    if (trader.account_stats) lines.push(`Account Stats: ${trader.account_stats}`);
    lines.push("");

    const table = renderPositionTable(trader);
    if (table) lines.push(table);
    else if (trader.status === "positions_unavailable") lines.push("Status: Live position rows are unavailable from text scrape; stale fixture values were intentionally not used.");
    else lines.push("Status: No active positions found.");

    lines.push("");
    lines.push(`Total Long: ${money(trader.long_exposure)} -> ${pct(trader.long_pct)}`);
    lines.push(`Total Short: ${money(trader.short_exposure)} -> ${pct(trader.short_pct)}`);
    lines.push(`Bias: ${trader.bias}`);
    lines.push(`Visual Bar: ${trader.visual_bar}`);
    lines.push("");
    lines.push(`Quick Read: ${quickReadFor(analysis, trader.display_name)}`);
  });

  lines.push("");
  lines.push("## STEP 2 — CoinSense Vault Monitor");
  lines.push("");
  lines.push(`Source: ${input.coinsense.source}`);
  if (input.coinsense.chart_image?.path) {
    lines.push("");
    lines.push(`![CoinSense Vault Longs and Shorts Chart](${input.coinsense.chart_image.path})`);
  } else if (input.coinsense.chart_image?.status === "unavailable") {
    lines.push("");
    lines.push(`CoinSense chart image: unavailable (${input.coinsense.chart_image.error})`);
  }
  lines.push("");
  lines.push(`Account Value: ${input.coinsense.account_value}`);
  lines.push(`Longs Ratio: ${input.coinsense.longs_ratio}`);
  lines.push(`Shorts Ratio: ${input.coinsense.shorts_ratio}`);
  lines.push("");
  lines.push("| # | Coin | Side | Size | Position Value | Unrealized PnL |");
  lines.push("|---:|---|---|---:|---:|---:|");
  for (const position of input.coinsense.positions) {
    lines.push(`| ${position.rank} | ${position.coin} | ${position.side} ${sideArrow(position.side)} | ${position.size} | ${position.position_value} | ${position.unrealized_pnl} |`);
  }

  lines.push("");
  lines.push("## STEP 3 — Hyperdash Cohort Sentiment (All-Time PNL)");
  lines.push("");
  lines.push("| Cohort | Sentiment | Long | Short |");
  lines.push("|---|---|---:|---:|");
  for (const cohort of input.hyperdash_cohorts) {
    lines.push(`| ${cohort.cohort} | ${cohort.sentiment} | ${cohort.long} | ${cohort.short} |`);
  }
  lines.push("");
  lines.push(`Quick Conclusion: ${analysis.final_analysis.hyperdash_cohort_conclusion || fallbackHyperdashConclusion(input.hyperdash_comparison)}`);

  lines.push("");
  lines.push("## FINAL ANALYSIS");
  lines.push("");
  lines.push("### Crypto Signals");
  for (const bullet of analysis.final_analysis.crypto_signals || []) lines.push(`- ${bullet}`);
  lines.push("");
  lines.push("### Macro Signals");
  for (const bullet of analysis.final_analysis.macro_signals || []) lines.push(`- ${bullet}`);
  lines.push("");
  lines.push("### CoinSense Vault Summary");
  for (const bullet of analysis.final_analysis.coinsense_summary || []) lines.push(`- ${bullet}`);

  return `${lines.join("\n")}\n`;
}

function fallbackHyperdashConclusion(comparison) {
  if (!comparison) return "No Hyperdash cohort comparison returned.";
  const profitable = comparison.profitable_cohorts;
  const unprofitable = comparison.unprofitable_cohorts;
  return `Profitable cohorts are ${profitable.net}-tilted with ${pct(profitable.long_pct)} long versus ${pct(profitable.short_pct)} short, while unprofitable cohorts are ${unprofitable.net}-tilted with ${pct(unprofitable.long_pct)} long versus ${pct(unprofitable.short_pct)} short.`;
}

export async function generateMarketViewReport({
  inputPath = DEFAULT_INPUT,
  inputData = null,
  live = false,
  model = DEFAULT_MODEL,
  outputDir = null,
  coinsenseImage = true,
  embedImages = false,
} = {}) {
  const resolvedOutputDir = resolve(outputDir || join("runs", "market-view", `openrouter-test-${utcStamp()}`));
  await mkdir(resolvedOutputDir, { recursive: true });
  const rawInput = inputData || (live
    ? await collectMarketViewInput({ outputDir: resolvedOutputDir })
    : JSON.parse(await readFile(resolve(inputPath), "utf8")));
  const input = buildComputedInput(rawInput);
  if (coinsenseImage) {
    input.coinsense.chart_image = await captureCoinsenseImage(resolvedOutputDir, { embedImage: embedImages });
  }
  await writeFile(join(resolvedOutputDir, "normalized-input.json"), JSON.stringify(input, null, 2));

  const result = await callOpenRouter({ model, input });
  await writeFile(join(resolvedOutputDir, "openrouter-response.json"), JSON.stringify(result.raw, null, 2));
  await writeFile(join(resolvedOutputDir, "analysis.json"), JSON.stringify(result.parsed, null, 2));

  const report = renderReport(input, result.parsed, model);
  await writeFile(join(resolvedOutputDir, "report.md"), report);
  return {
    model,
    snapshotId: basename(resolvedOutputDir),
    outputDir: resolvedOutputDir,
    report,
    normalized: input,
    analysis: result.parsed,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const result = await generateMarketViewReport({
    inputPath: args.input,
    model: args.model,
    outputDir: args.outputDir,
    coinsenseImage: args.coinsenseImage,
    live: args.live,
  });
  console.log(result.report);
  console.error(`Saved report artifacts: ${result.outputDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
