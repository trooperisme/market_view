#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve, join } from "node:path";

await loadEnvFile(resolve(".env"));

const DEFAULT_INPUT = "fixtures/market-view/mock-input.json";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

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
  npm run market-view:llm-test -- --input fixtures/market-view/mock-input.json
  npm run market-view:llm-test -- --model openai/gpt-4o

Environment:
  OPENROUTER_API_KEY must be set.
  OPENROUTER_MODEL is optional. Default: ${DEFAULT_MODEL}
`.trim();
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    model: DEFAULT_MODEL,
    outputDir: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--input") args.input = argv[++i];
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--output-dir") args.outputDir = argv[++i];
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
  return { ...input, traders };
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

  const rows = trader.positions.map((position) => {
    const value = money(position.position_value_usd);
    const size = position.size ? ` | ${position.size}` : "";
    const entry = position.entry ? ` | ${position.entry}` : "";
    const mark = position.mark ? ` | ${position.mark}` : "";
    const pnl = position.unrealized_pnl ? ` | ${position.unrealized_pnl}` : "";
    if (size || entry || mark || pnl) {
      return `| ${position.symbol} | ${sideLabel(position.side)} | ${size.slice(3) || "-"} | ${value} | ${position.entry || "-"} | ${position.mark || "-"} | ${position.unrealized_pnl || "-"} |`;
    }
    return `| ${position.symbol} | ${sideLabel(position.side)} | ${value} |`;
  });

  const hasDetailedRows = trader.positions.some((position) => position.size || position.entry || position.mark || position.unrealized_pnl);
  if (hasDetailedRows) {
    return [
      "| Symbol | Side | Size | Position Value | Entry | Mark | Unrealized PnL |",
      "|---|---|---:|---:|---:|---:|---:|",
      ...rows,
    ].join("\n");
  }

  return [
    "| Symbol | Side | Position Value |",
    "|---|---|---:|",
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const inputPath = resolve(args.input);
  const input = buildComputedInput(JSON.parse(await readFile(inputPath, "utf8")));
  const outputDir = resolve(args.outputDir || join("runs", "market-view", `openrouter-test-${utcStamp()}`));
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "normalized-input.json"), JSON.stringify(input, null, 2));

  const result = await callOpenRouter({ model: args.model, input });
  await writeFile(join(outputDir, "openrouter-response.json"), JSON.stringify(result.raw, null, 2));
  await writeFile(join(outputDir, "analysis.json"), JSON.stringify(result.parsed, null, 2));

  const report = renderReport(input, result.parsed, args.model);
  await writeFile(join(outputDir, "report.md"), report);
  console.log(report);
  console.error(`Saved report artifacts: ${outputDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
