import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { computeHyperdashComparison, computeTrader } from "../src/market-view/compute.js";
import { categoryFor, normalizeMoneyText, parseHypurrscanTrader, sideFromText } from "../src/market-view/parsers.js";
import { renderReport } from "../src/market-view/report.js";
import { generateMarketViewReport } from "../src/market-view/workflow.js";
import {
  buildPositionSizeIndex,
  deltaLabel,
  findLatestPriorSnapshot,
  numericPositionSize,
  sortTableRowsByPositionValue,
} from "../public/position-tools.js";

test("normalizes side, category, and money values", () => {
  assert.equal(sideFromText("Long 10x"), "long");
  assert.equal(sideFromText("SHORT"), "short");
  assert.equal(sideFromText("flat"), "unknown");
  assert.equal(categoryFor("XAU"), "macro");
  assert.equal(categoryFor("BTC"), "crypto");
  assert.equal(normalizeMoneyText("- $1,234.56"), "-$1,234.56");
});

test("extracts Hypurrscan position rows from markdown table", () => {
  const markdown = `
| Token | Side | Leverage | Value | Size | Entry | Foo | Mark | PnL | Funding | Liq |
|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|
| BTC | Long | 5X | $10,000 | 0.1 | $90,000 | - | $100,000 | $1,000 | $10 | $80,000 |
`;
  assert.deepEqual(parseHypurrscanTrader(markdown), [{
    symbol: "BTC",
    side: "long",
    leverage: "5X",
    position_value_usd: 10000,
    size: "0.1",
    entry: "$90,000",
    mark: "$100,000",
    unrealized_pnl: "$1,000",
    funding: "$10",
    liquidation: "$80,000",
    category: "crypto",
  }]);
});

test("computes trader exposure and Hyperdash cohort comparison", () => {
  const trader = computeTrader({
    positions: [
      { side: "long", position_value_usd: 75 },
      { side: "short", position_value_usd: 25 },
    ],
  });
  assert.equal(trader.long_exposure, 75);
  assert.equal(trader.short_exposure, 25);
  assert.equal(trader.bias, "BULLISH ↑");

  const comparison = computeHyperdashComparison([
    { long: "$2M", short: "$1M" },
    { long: "$1M", short: "$1M" },
    { long: "$1M", short: "$0M" },
    { long: "$0M", short: "$2M" },
    { long: "$1M", short: "$1M" },
    { long: "$0M", short: "$1M" },
  ]);
  assert.equal(comparison.profitable_cohorts.net, "long");
  assert.equal(comparison.unprofitable_cohorts.net, "short");
});

test("renders report sections and model name", () => {
  const input = sampleComputedInput();
  const report = renderReport(input, sampleAnalysis(), "nvidia/nemotron-3-super-120b-a12b:free");
  assert.match(report, /STEP 1/);
  assert.match(report, /CoinSense Vault Monitor/);
  assert.match(report, /Hyperdash Cohort Sentiment/);
  assert.match(report, /nvidia\/nemotron-3-super-120b-a12b:free/);
});

test("parses position sizes and formats delta labels", () => {
  assert.equal(numericPositionSize("100"), 100);
  assert.equal(numericPositionSize("-3.0000"), -3);
  assert.equal(numericPositionSize("7,000.00"), 7000);
  assert.equal(numericPositionSize("1.76 BTC"), 1.76);
  assert.equal(numericPositionSize("-97.49K ASTER"), -97490);

  assert.equal(deltaLabel("110", 100), "+10.0%");
  assert.equal(deltaLabel("90", 100), "-10.0%");
  assert.equal(deltaLabel("100", 100), "0.0%");
  assert.equal(deltaLabel("1", undefined), "New");
  assert.equal(deltaLabel("1", 0), "New");
  assert.equal(deltaLabel("", 100), "-");
});

test("indexes prior positions by trader source symbol and side", () => {
  const prior = buildPositionSizeIndex({
    traders: [{
      display_name: "Trader A",
      source: "Fallback",
      positions: [
        { symbol: "BTC", side: "long", source: "Hypurrscan", size: "2" },
        { symbol: "BTC", side: "short", source: "Hypurrscan", size: "-3" },
      ],
    }],
  });

  assert.equal(prior.get("Trader A||Hypurrscan||BTC||long"), 2);
  assert.equal(prior.get("Trader A||Hypurrscan||BTC||short"), 3);
  assert.equal(prior.get("Trader A||Fallback||BTC||long"), undefined);
});

test("finds latest prior normalized snapshot and sorts table rows by position value", () => {
  const snapshots = [
    { id: "older", createdAt: "2026-06-29T01:00:00.000Z", normalized: { traders: [] } },
    { id: "current", createdAt: "2026-06-29T03:00:00.000Z", normalized: { traders: [] } },
    { id: "latest-prior", createdAt: "2026-06-29T02:00:00.000Z", normalized: { traders: [] } },
    { id: "no-normalized", createdAt: "2026-06-29T02:30:00.000Z" },
  ];

  assert.equal(findLatestPriorSnapshot(snapshots, snapshots[1]).id, "latest-prior");

  const rows = [
    { dataset: { positionValue: "300" } },
    { dataset: { positionValue: "100" } },
    { dataset: { positionValue: "200" } },
  ];
  const appended = [];
  const tbody = {
    querySelectorAll: () => rows,
    appendChild: (row) => appended.push(row.dataset.positionValue),
  };

  sortTableRowsByPositionValue(tbody, "asc");
  assert.deepEqual(appended, ["100", "200", "300"]);

  appended.length = 0;
  sortTableRowsByPositionValue(tbody, "desc");
  assert.deepEqual(appended, ["300", "200", "100"]);
});

test("workflow smoke uses fallback analysis without OpenRouter key", async () => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const outputDir = "runs/market-view/test-refactor-workflow";
  await rm(outputDir, { recursive: true, force: true });

  try {
    const result = await generateMarketViewReport({
      inputData: sampleRawInput(),
      outputDir,
      coinsenseImage: false,
    });
    assert.equal(result.model, "nvidia/nemotron-3-super-120b-a12b:free");
    assert.match(result.report, /Fallback analysis used because OPENROUTER_API_KEY is not set/);
    assert.equal(result.normalized.traders[0].bias, "BULLISH ↑");
  } finally {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldKey;
    await rm(outputDir, { recursive: true, force: true });
  }
});

function sampleRawInput() {
  return {
    traders: [{
      display_name: "Trader A",
      source: "Fixture",
      positions: [
        { symbol: "BTC", side: "long", position_value_usd: 100, size: "1" },
      ],
    }],
    coinsense: {
      source: "CoinSense Vault",
      account_value: "$100",
      longs_ratio: "60%",
      shorts_ratio: "40%",
      positions: [{ rank: 1, coin: "BTC", side: "long", size: "1", position_value: "$100", unrealized_pnl: "$1" }],
    },
    hyperdash_cohorts: [
      { slug: "profitable", cohort: "Profitable", sentiment: "Bullish ↑", long: "$2M", short: "$1M" },
    ],
    hyperdash_screenshot_url: null,
  };
}

function sampleComputedInput() {
  return {
    ...sampleRawInput(),
    traders: [{
      ...sampleRawInput().traders[0],
      long_exposure: 100,
      short_exposure: 0,
      long_pct: 100,
      short_pct: 0,
      bias: "BULLISH ↑",
      visual_bar: "🟩🟩",
    }],
    hyperdash_comparison: {
      profitable_cohorts: { net: "long", long_pct: 66.7, short_pct: 33.3 },
      unprofitable_cohorts: { net: "neutral", long_pct: 0, short_pct: 0 },
    },
  };
}

function sampleAnalysis() {
  return {
    quick_reads: [{ trader: "Trader A", text: "Bullish quick read." }],
    final_analysis: {
      hyperdash_cohort_conclusion: "Profitable cohorts lean long.",
      crypto_signals: ["BTC long."],
      macro_signals: ["No macro signal."],
      coinsense_summary: ["CoinSense leans long."],
    },
  };
}
