import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeHyperdashCohorts, computeHyperdashComparison, computeTrader } from "../src/market-view/compute.js";
import { categoryFor, mergePearTraderUiPositions, normalizeMoneyText, parseDeriveOptionPositions, parseHyperdashCohorts, parseHyperliquidAccountStats, parseHyperliquidAssetPositions, parseHypurrscanOpenOrders, parseHypurrscanTrader, parsePearTraderPositions, parsePearTraderUiPositions, sideFromText } from "../src/market-view/parsers.js";
import { renderOpenOrderTable, renderPairPositionTable, renderPositionTable, renderReport } from "../src/market-view/report.js";
import { generateMarketViewReport } from "../src/market-view/workflow.js";
import { attachOpenOrders, hypurrscanOrdersUrl, scrapeMarkdown, vaultAddressFromUrl } from "../src/market-view/collectors.js";
import { readSnapshotWithComparison } from "../src/market-view/snapshots.js";
import { sourceUrls } from "../src/config.js";
import { parsePearVaultPositions, pearVaultAddress } from "../src/market-view/pear-vault.js";
import { vietnamDateKey } from "../api/market-view/daily.js";
import {
  listMarketViewSnapshots,
  normalizeSupabaseUrl,
  saveMarketViewSnapshot,
  snapshotQuality,
} from "../src/market-view/supabase-snapshots.js";
import {
  buildPositionSizeIndex,
  deltaLabel,
  findLatestPriorSnapshot,
  numericPositionSize,
  sortTableRowsByPositionValue,
} from "../public/position-tools.js";
import { ensureHyperdashDirectionalRead } from "../public/cohort-render.js";

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

test("normalizes Pear pair legs without turning them into directional positions", () => {
  const positions = parsePearTraderPositions({
    positions: [{
      positionId: "pair-1",
      status: "OPEN",
      openedAt: "2026-10-29T21:06:31.785Z",
      legs: [{
        asset: "159",
        side: "LONG",
        realized: { quantity: "464.44", exitVwap: "92.77", grossPnl: "+396.63", netPnl: "+266.95" },
        remaining: { quantity: "+433.88", entryVwap: "91.9183864202" },
      }, {
        asset: "110000",
        side: "SHORT",
        realized: { quantity: "0.8424", exitVwap: "29433", grossPnl: "+207.2304", netPnl: "+173.050465" },
        remaining: { quantity: "+0" },
      }],
    }],
  }, { assetSymbols: { "159": "HYPE", "110000": "XYZ100" } });

  assert.deepEqual(positions.map((position) => ({
    group: position.position_group,
    ticker: position.ticker,
    side: position.side,
    status: position.status,
    active_qty: position.active_qty,
    entry_vwap: position.entry_vwap,
    closed_qty: position.closed_qty,
    avg_exit_price: position.avg_exit_price,
  })), [{
    group: "HYPE / XYZ100",
    ticker: "HYPE",
    side: "long",
    status: "open",
    active_qty: 433.88,
    entry_vwap: 91.9183864202,
    closed_qty: 464.44,
    avg_exit_price: 92.77,
  }, {
    group: "HYPE / XYZ100",
    ticker: "XYZ100",
    side: "short",
    status: "closed",
    active_qty: 0,
    entry_vwap: null,
    closed_qty: 0.8424,
    avg_exit_price: 29433,
  }]);
});

test("merges Pear UI metrics only when they map to one active leg", () => {
  const ui = parsePearTraderUiPositions(`
PairSizeEntryMarkTP / SLPnL
Hyperliquid
![AVGO](https://example.test/avgo.webp)
![USDC](https://example.test/usdc.webp)
$47,853
$346.59
$331.74
-- / --
-$2142.57 (--)
Hyperliquid
![HYPE](https://example.test/hype.webp)
![LIT](https://example.test/lit.webp)
![USDC](https://example.test/usdc.webp)
$74,805
$18.062
$17.929
-- / --
-$543.40 (--)
`);
  assert.deepEqual(ui, [
    { position_group: "AVGO", displayed_size_usd: 47853, entry_vwap: 346.59, current_mark: 331.74, current_upnl_usd: -2142.57 },
    { position_group: "HYPE / LIT", displayed_size_usd: 74805, entry_vwap: 18.062, current_mark: 17.929, current_upnl_usd: -543.4 },
  ]);

  const merged = mergePearTraderUiPositions([
    { position_group: "AVGO", ticker: "AVGO", status: "open", displayed_size_usd: null, current_mark: null, current_upnl_usd: null },
    { position_group: "HYPE / LIT", ticker: "HYPE", status: "open", displayed_size_usd: null, current_mark: null, current_upnl_usd: null },
    { position_group: "HYPE / LIT", ticker: "LIT", status: "open", displayed_size_usd: null, current_mark: null, current_upnl_usd: null },
  ], ui);
  assert.deepEqual(merged.map(({ ticker, displayed_size_usd, current_mark, current_upnl_usd }) => ({ ticker, displayed_size_usd, current_mark, current_upnl_usd })), [
    { ticker: "AVGO", displayed_size_usd: 47853, current_mark: 331.74, current_upnl_usd: -2142.57 },
    { ticker: "HYPE", displayed_size_usd: null, current_mark: null, current_upnl_usd: null },
    { ticker: "LIT", displayed_size_usd: null, current_mark: null, current_upnl_usd: null },
  ]);
});

test("parses Hypurrscan Lev. tables and recognizes the 0xKyoto wallet URL", () => {
  assert.equal(sourceUrls.kyotoHypurrscan, "https://hypurrscan.io/address/0x06184a3d663dae6f40420cb536dcab7fe9492475#perps");
  const markdown = `
| Token | Side | Lev. | Value | Amount | Entry | BE | Price | PnL | Funding | Liq. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HYPE | Long | 3x cross | $12,300 | 100 | $120 | $121 | $123 | $300 | -$2 | $80 |
`;
  const positions = parseHypurrscanTrader(markdown);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].symbol, "HYPE");
  assert.equal(positions[0].leverage, "3x cross");
  assert.equal(positions[0].position_value_usd, 12300);

  const noPositionsMarkdown = `
| Token | Side | Lev. | Value | Amount | Entry | BE | Price | PnL | Funding | Liq. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| No data available |
`;
  assert.deepEqual(parseHypurrscanTrader(noPositionsMarkdown), []);
});

test("registers fhd with its canonical Hypurrscan perps wallet", () => {
  assert.equal(
    sourceUrls.fhdHypurrscan,
    "https://hypurrscan.io/address/0x5cbdb794b3b36df58a7ce6c1a552f117f061103b#perps",
  );
});

test("registers ImBallzy with its supplied Hypurrscan perps wallet", () => {
  assert.equal(
    sourceUrls.imBallzyHypurrscan,
    "https://hypurrscan.io/address/0x39c3492e9171872eac6a99d9c0b6dbae5d4ae959#perps",
  );
});

test("parses grouped Hypurrscan open-order ladders without inventing order IDs", () => {
  const markdown = `
| Token | Side | Price | Value | Size |
| --- | --- | --- | --- | --- |
| [**HYPE-USD**](https://hypurrscan.io/market/HYPE)(100 orders) | SELL | 82 - 95$ | 1.33M$ | 15.00K HYPE |
| BTC | BUY | 90,000$ | 450K$ | 5 BTC |
`;

  assert.deepEqual(parseHypurrscanOpenOrders(markdown), [{
    symbol: "HYPE",
    side: "SELL",
    price_raw: "82 - 95$",
    value_raw: "1.33M$",
    size_raw: "15.00K HYPE",
    order_count: 100,
    value_usd_approx: 1330000,
  }, {
    symbol: "BTC",
    side: "BUY",
    price_raw: "90,000$",
    value_raw: "450K$",
    size_raw: "5 BTC",
    order_count: 1,
    value_usd_approx: 450000,
  }]);
});

test("retries transient Firecrawl scrape failures", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "market-view-firecrawl-"));
  const oldKey = process.env.FIRECRAWL_API_KEY;
  const oldFetch = globalThis.fetch;
  let calls = 0;
  process.env.FIRECRAWL_API_KEY = "test-firecrawl-key";
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 408,
        headers: { get: () => null },
        json: async () => ({ error: "temporary concurrency queue timeout" }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ markdown: "| Token | Side | Value |\\n|---|---|---|\\n| BTC | Long | $1,000 |" }),
    };
  };

  try {
    const result = await scrapeMarkdown("https://example.test/trader", {
      outputDir,
      name: "retry",
      waitFor: 0,
      timeout: 100,
      maxAttempts: 2,
      minIntervalMs: 0,
    });
    assert.equal(calls, 2);
    assert.match(result.markdown, /BTC/);
  } finally {
    if (oldKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = oldKey;
    globalThis.fetch = oldFetch;
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("builds Hypurrscan order URLs for address and vault sources", () => {
  assert.equal(
    hypurrscanOrdersUrl(sourceUrls.fhdHypurrscan),
    "https://hypurrscan.io/address/0x5cbdb794b3b36df58a7ce6c1a552f117f061103b#orders",
  );
  assert.equal(
    hypurrscanOrdersUrl(sourceUrls.giver),
    "https://hypurrscan.io/vault/0x8fc7c0442e582bca195978c5a4fdec2e7c5bb0f7#orders",
  );
});

test("attaches Hypurrscan orders to an entity when the orders scrape is enabled", () => {
  const traders = attachOpenOrders(
    [{ name: "Hansolar", display_name: "Hansolar", positions: [] }],
    [{ entity: "Hansolar", id: "hansolar", label: "Hypurrscan 0x9b8d", url: sourceUrls.hansolarHypurrscan }],
    [{ markdown: "", status: "available" }],
  );

  assert.equal(traders[0].open_orders_status, "empty");
  assert.equal(traders[0].open_orders.length, 0);
  assert.equal(
    traders[0].open_order_summary.grouped_orders,
    0,
  );
});

test("extracts Hyperliquid vault positions from clearinghouse state", () => {
  const state = {
    marginSummary: {
      accountValue: "418908.338819",
      totalMarginUsed: "55109.725637",
    },
    assetPositions: [{
      position: {
        coin: "BTC",
        szi: "2.76232",
        leverage: { type: "cross", value: 40 },
        entryPx: "69400.3",
        positionValue: "179851.89288",
        unrealizedPnl: "-11854.070966",
        liquidationPx: null,
        cumFunding: { sinceOpen: "2083.319969" },
      },
    }, {
      position: {
        coin: "ETH",
        szi: "-10",
        leverage: { type: "isolated", value: 5 },
        entryPx: "4200",
        positionValue: "40000",
        unrealizedPnl: "2000",
        liquidationPx: "5000",
        cumFunding: { sinceOpen: "-12.5" },
      },
    }],
  };

  assert.deepEqual(parseHyperliquidAssetPositions(state), [{
    symbol: "BTC",
    side: "long",
    leverage: "40X cross",
    position_value_usd: 179851.89288,
    size: "2.76232 BTC",
    entry: "$69,400.3",
    mark: "$65,109",
    unrealized_pnl: "-$11,854.070966",
    funding: "$2,083.319969",
    liquidation: "",
    category: "crypto",
  }, {
    symbol: "ETH",
    side: "short",
    leverage: "5X isolated",
    position_value_usd: 40000,
    size: "10 ETH",
    entry: "$4,200",
    mark: "$4,000",
    unrealized_pnl: "$2,000",
    funding: "-$12.5",
    liquidation: "$5,000",
    category: "crypto",
  }]);
  assert.equal(parseHyperliquidAccountStats(state), "Live Hyperliquid state | Account Value $418,908.338819 | Margin Used $55,109.725637 | 2 active positions");
});

test("extracts vault address from Hypurrscan vault URL", () => {
  assert.equal(
    vaultAddressFromUrl("https://hypurrscan.io/vault/0x8fc7c0442e582bca195978c5a4fdec2e7c5bb0f7"),
    "0x8fc7c0442e582bca195978c5a4fdec2e7c5bb0f7",
  );
});

test("extracts Derive option position rows from Firecrawl markdown", () => {
  const markdown = `
| Instrument | Amount | Mkt Val | Mark | Avg Cost | Margin | Leverage | Liq Price | UPnL | UPnL % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HYPE $125 Call Aug 28 | +100 | $0.0₅5002 | $0.00 | $0.78 | — | — | — | $78◢ | 100.00%◢ |
| HYPE $74 Call Sep 25 | +150 | $1,662.24 | $11.08 | $0.70 | — | — | — | $1,557.73◥ | 1490.66%◥ |
`;

  assert.deepEqual(parseDeriveOptionPositions(markdown), [{
    symbol: "HYPE",
    instrument: "HYPE $125 Call Aug 28",
    instrument_type: "option",
    side: "long",
    option_type: "call",
    strike_usd: 125,
    expiry: "Aug 28",
    amount: 100,
    size: "+100",
    position_value_usd: 0.000005002,
    mark: "$0.00",
    avg_cost: "$0.78",
    unrealized_pnl: "-$78",
    unrealized_pnl_usd: -78,
    unrealized_pnl_pct: -100,
    category: "crypto",
  }, {
    symbol: "HYPE",
    instrument: "HYPE $74 Call Sep 25",
    instrument_type: "option",
    side: "long",
    option_type: "call",
    strike_usd: 74,
    expiry: "Sep 25",
    amount: 150,
    size: "+150",
    position_value_usd: 1662.24,
    mark: "$11.08",
    avg_cost: "$0.70",
    unrealized_pnl: "$1,557.73",
    unrealized_pnl_usd: 1557.73,
    unrealized_pnl_pct: 1490.66,
    category: "crypto",
  }]);
});

test("extracts Derive option rows from the current Value and Mark Price schema", () => {
  const markdown = `
| Instrument | Amount | Value | Mark Price | Avg Cost | Margin | Leverage | Liquidation | UPnL | UPnL % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTC $94,000 Call Oct 30 | +1 | $526.61 | $526.61 | $296.00 | — | — | — | $230.60 | 77.91% |
`;

  const [position] = parseDeriveOptionPositions(markdown);
  assert.equal(position.instrument, "BTC $94,000 Call Oct 30");
  assert.equal(position.strike_usd, 94000);
  assert.equal(position.position_value_usd, 526.61);
  assert.equal(position.mark, "$526.61");
  assert.equal(position.unrealized_pnl_pct, 77.91);
});

test("extracts Hyperdash cohorts from linked and plain Firecrawl markdown", () => {
  const linked = `
All-Time PNL

[Very Profitable\\
\\
+$100K to +$1M PNL\\
\\
Very Bullish\\
\\
1,402 Wallets\\
\\
$957.52M\\
\\
LONG\\
\\
$426.97M\\
\\
SHORT](https://hyperdash.com/explore/cohorts/very_profitable)

Account Size
`;
  const plain = `
All-Time PNL

Extremely Profitable
+$1M+ PNL
Bullish
349 Wallets
$2,162.52M
LONG
$1,290.56M
SHORT
Very Profitable
+$100K to +$1M PNL
Very Bullish
1,402 Wallets
$957.52M
LONG
$426.97M
SHORT
Profitable
$0 to +$100K PNL
Very Bullish
71,307 Wallets
$696.84M
LONG
$324.17M
SHORT
Unprofitable
$0 to -$100K PNL
Bullish
140,153 Wallets
$502.30M
LONG
$398.34M
SHORT
Very Unprofitable
-$100K to -$1M PNL
Slightly Bearish
2,084 Wallets
$496.14M
LONG
$646.81M
SHORT
Rekt
-$1M+ PNL
Slightly Bearish
295 Wallets
$738.73M
LONG
$981.35M
SHORT

Account Size
`;

  assert.deepEqual(parseHyperdashCohorts(linked), [{
    slug: "very_profitable",
    cohort: "Very Profitable (+$100K to +$1M PNL)",
    sentiment: "Very Bullish ↑",
    long: "$957.52M",
    short: "$426.97M",
  }]);
  const fallback = parseHyperdashCohorts(plain);
  assert.equal(fallback.length, 6);
  assert.equal(fallback[1].sentiment, "Very Bullish ↑");
  assert.equal(fallback[5].short, "$981.35M");
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

test("marks large Hyperdash net positioning as significant or extreme", () => {
  const [profitable, balanced, rekt] = computeHyperdashCohorts([
    { cohort: "Profitable", long: "$912.32M", short: "$309.55M" },
    { cohort: "Balanced", long: "$550M", short: "$450M" },
    { cohort: "Rekt", long: "$946.13M", short: "$1,212.84M" },
  ]);

  assert.equal(profitable.net_millions, 602.77);
  assert.equal(profitable.net_share_pct, 49.3);
  assert.equal(profitable.is_significant, true);
  assert.equal(profitable.is_extreme, true);
  assert.equal(balanced.is_significant, false);
  assert.equal(balanced.is_extreme, false);
  assert.equal(rekt.direction, "short");
  assert.equal(rekt.is_significant, false);
  assert.equal(rekt.is_extreme, false);

  const report = renderReport({ traders: [], hyperdash_cohorts: [
    { cohort: "Profitable", long: "$912.32M", short: "$309.55M" },
  ] }, sampleAnalysis());
  assert.match(report, /EXTREME LONG \(49\.3%\)/);
  assert.doesNotMatch(report, /Net share = \|Long − Short\|/);
});

test("preserves the Hyperdash cohort table while refreshing its directional read", () => {
  const markdown = [
    "# Market View",
    "",
    "## Hyperdash cohort positioning",
    "",
    "**Directional read: DOWN · low confidence**",
    "",
    "A stale summary.",
    "",
    "| Cohort | Long | Short | Net | Read |",
    "|---|---:|---:|---:|---|",
    "| Profitable | $2M | $1M | Long $1M | EXTREME LONG (33.3%) |",
    "",
    "## Largest positions by trader",
  ].join("\n");

  const updated = ensureHyperdashDirectionalRead(markdown, {
    hyperdash_cohorts: [{ cohort: "Profitable", long: "$2M", short: "$1M" }],
  });

  assert.match(updated, /Directional read: UP/);
  assert.match(updated, /\| Cohort \| Long \| Short \| Net \| Read \|/);
  assert.match(updated, /\| Profitable \| \$2M \| \$1M/);
  assert.doesNotMatch(updated, /CoinSense/i);
});

test("renders every trader position row with the detailed fields", () => {
  const positions = Array.from({ length: 6 }, (_, index) => ({
    symbol: `ASSET${index + 1}`,
    side: "long",
    leverage: "5x cross",
    size: String(index + 1),
    position_value_usd: (6 - index) * 1000,
    entry: "$10.00",
    unrealized_pnl: "$1.00",
  }));
  const table = renderPositionTable({ positions });

  assert.match(table, /\| ASSET6 \| Long ↑ \| 5x cross \| 6 \| \$1,000\.00 \| \$10\.00 \| \$1\.00 \|/);
  assert.equal((table.match(/^\| ASSET\d+ \|/gm) || []).length, 6);
});

test("renders the approved clean Pear leg-level table and preserves unavailable UI fields", () => {
  const table = renderPairPositionTable({
    pair_positions: [{
      position_group: "HYPE / LIT",
      ticker: "HYPE",
      side: "long",
      status: "open",
      active_qty: 433.88,
      entry_vwap: 91.9183864202,
      displayed_size_usd: null,
      current_mark: null,
      current_upnl_usd: null,
    }],
  });

  assert.match(table, /\| Position Group \| Ticker \| Side \| Status \| Active Qty \| Entry VWAP \| Displayed Size USD \| Current Mark \| Current uPnL \|/);
  assert.match(table, /\| HYPE \/ LIT \| HYPE \| LONG \| OPEN \| \+433\.88 \| \$91\.91838642 \| — \| — \| — \|/);
});

test("keeps Pear pair legs out of directional trader exposure", () => {
  const trader = computeTrader({
    name: "moritzpike vault",
    positions: [],
    pair_positions: [{ ticker: "HYPE", side: "long", displayed_size_usd: 100000 }],
  });
  assert.equal(trader.long_exposure, 0);
  assert.equal(trader.short_exposure, 0);
  assert.equal(trader.bias, "NEUTRAL →");
  assert.equal(trader.pair_positions.length, 1);
});

test("parses a Pear vault pair from canonical asset IDs with separate leg notionals", () => {
  assert.equal(pearVaultAddress(sourceUrls.pearMoritzpikeVault), "0x69f2ed780a4cec49e552dbcd35a60f41368bc362");
  const positions = parsePearVaultPositions({ positions: [{
    positionId: "pair-1",
    status: "OPEN",
    legs: [
      { asset: "0", side: "LONG", remaining: { quantity: "+0.5", entryVwap: "60000" } },
      { asset: "110017", side: "SHORT", remaining: { quantity: "-300", entryVwap: "100" } },
    ],
  }] }, { instruments: [
    { id: "0", base: "BTC", connector: "hyperliquid" },
    { id: "110017", base: "xyz:MSTR", connector: "hyperliquid" },
  ] }, { mark: { "0": "65000", "110017": "105" } });
  assert.deepEqual(positions.map((position) => ({
    group: position.position_group,
    ticker: position.ticker,
    side: position.side,
    size: position.displayed_size_usd,
    pnl: position.current_upnl_usd,
  })), [
    { group: "BTC / MSTR", ticker: "BTC", side: "long", size: 32500, pnl: 2500 },
    { group: "BTC / MSTR", ticker: "MSTR", side: "short", size: 31500, pnl: -1500 },
  ]);
  const report = renderReport({ ...sampleComputedInput(), traders: [computeTrader({
    name: "moritzpike vault",
    display_name: "moritzpike vault",
    positions: [],
    pair_positions: positions,
  })] }, sampleAnalysis());
  assert.match(report, /LONG BTC \/ SHORT MSTR · \$64,000\.00 gross/);
  assert.match(report, /Estimated price PnL excludes fees, funding, and realized PnL/);
});

test("summarizes a multi-leg Pear vault basket without repeating every asset in each row", () => {
  const positions = parsePearVaultPositions({ positions: [{
    positionId: "basket-1",
    status: "OPEN",
    legs: [
      { asset: "1", side: "LONG", remaining: { quantity: "10", entryVwap: "10" } },
      ...["2", "3", "4", "5"].map((asset) => ({ asset, side: "SHORT", remaining: { quantity: "-10", entryVwap: "2" } })),
    ],
  }] }, { instruments: [
    { id: "1", base: "HYPE", connector: "hyperliquid" },
    ...["ADA", "XRP", "UNI", "AAVE"].map((base, index) => ({ id: String(index + 2), base, connector: "hyperliquid" })),
  ] }, { mark: { "1": "11", "2": "2", "3": "2", "4": "2", "5": "2" } });
  assert.equal(positions.length, 5);
  assert.ok(positions.every((position) => position.position_group === "HYPE / 4-asset short basket"));
  const report = renderReport({ ...sampleComputedInput(), traders: [computeTrader({
    display_name: "moritzpike vault",
    positions: [],
    pair_positions: positions,
  })] }, sampleAnalysis());
  assert.match(report, /LONG HYPE \/ SHORT 4-asset basket/);
  assert.match(report, /\| HYPE \/ 4-asset short basket \| AAVE \| SHORT \|/);
});

test("renders a concise report without provider details", () => {
  const input = sampleComputedInput();
  const report = renderReport(input, sampleAnalysis());
  assert.match(report, /Market positioning summary/);
  assert.ok(report.lastIndexOf("## Market positioning summary") > report.indexOf("### 1. Trader A"));
  assert.doesNotMatch(report, /Source:|Derive Options|Hypurrscan/);
});

test("renders open orders inside each entity section in Hypurrscan layout", () => {
  const trader = {
    display_name: "0xfhd",
    open_orders_status: "available",
    open_order_summary: {
      markets: 1,
      grouped_orders: 1,
      reported_orders: 100,
      conditional_value_usd: 1330000,
      buy_value_usd: 0,
      sell_value_usd: 1330000,
    },
    open_orders: [{
      symbol: "HYPE",
      side: "SELL",
      price_raw: "82 - 95$",
      value_raw: "1.33M$",
      size_raw: "15.00K HYPE",
      value_usd_approx: 1330000,
      order_count: 100,
    }],
  };
  const report = renderReport({ traders: [trader], hyperdash_cohorts: [] }, sampleAnalysis());
  assert.doesNotMatch(report, /## Open limit orders by trader/);
  assert.match(report, /### 1\. 0xfhd[\s\S]*No active positions\.[\s\S]*Open limit orders: 1 markets/);
  assert.match(report, /Open limit orders: 1 markets · 1 grouped rows · 100 reported orders/);
  assert.match(renderOpenOrderTable(trader), /\| \*\*HYPE\*\* \(100 orders\) \| SELL \| 82 - 95\$ \| 1\.33M\$ \| 15\.00K HYPE \|/);
});

test("renders each entity's long and short position mix", () => {
  const report = renderReport({
    traders: [{
      display_name: "Trader A",
      positions: [
        { symbol: "BTC", side: "long", position_value_usd: 75 },
        { symbol: "ETH", side: "short", position_value_usd: 25 },
      ],
    }],
    hyperdash_cohorts: [],
  }, sampleAnalysis());

  assert.match(report, /Position mix: Long 75\.0% · Short 25\.0% · 🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟥🟥🟥🟥🟥/);
});

test("classifies zero-value opposite-side orders as position stop-loss orders", () => {
  const trader = {
    positions: [
      { symbol: "XRP", side: "long" },
      { symbol: "TAO", side: "short" },
    ],
    open_orders: [
      { symbol: "XRP-USD", side: "SELL", price_raw: "1.521$", value_raw: "0.00$", value_usd_approx: 0, size_raw: "0.00 XRP" },
      { symbol: "TAO-USD", side: "BUY", price_raw: "648$", value_raw: "0.00$", value_usd_approx: 0, size_raw: "0.00 TAO" },
      { symbol: "BTC-USD", side: "SELL", price_raw: "90,000$", value_raw: "0.00$", value_usd_approx: 0, size_raw: "0.00 BTC" },
      { symbol: "ETH-USD", side: "SELL", price_raw: "3,500$", value_raw: "10K$", value_usd_approx: 10000, size_raw: "0.5 ETH" },
    ],
  };
  const table = renderOpenOrderTable(trader);

  assert.match(table, /\| \*\*XRP-USD\*\* · STOP-LOSS \| SELL \|/);
  assert.match(table, /\| \*\*TAO-USD\*\* · STOP-LOSS \| BUY \|/);
  assert.doesNotMatch(table, /BTC-USD.*STOP-LOSS/);
  assert.doesNotMatch(table, /ETH-USD.*STOP-LOSS/);
});

test("renders Derive option positions as a dedicated table", () => {
  const input = {
    ...sampleComputedInput(),
    traders: [{
      display_name: "Vương MC",
      source: "Derive Options",
      account_stats: "Live Derive scrape maxAge=0",
      positions: parseDeriveOptionPositions(`
| Instrument | Amount | Mkt Val | Mark | Avg Cost | Margin | Leverage | Liq Price | UPnL | UPnL % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HYPE $74 Call Sep 25 | +150 | $1,662.24 | $11.08 | $0.70 | — | — | — | $1,557.73◥ | 1490.66%◥ |
      `),
      long_exposure: 1662.24,
      short_exposure: 0,
      long_pct: 100,
      short_pct: 0,
      bias: "BULLISH ↑",
      visual_bar: "🟩🟩",
    }],
  };
  const report = renderReport(input, sampleAnalysis());

  assert.match(report, /### 1\. Vương MC/);
  assert.match(report, /\| Instrument \| Source \| Side \| Amount \| Mkt Val \| Mark \| Avg Cost \| UPnL \| UPnL % \|/);
  assert.match(report, /\| HYPE \$74 Call Sep 25 \| Derive \| Long ↑ \| \+150 \| \$1,662\.24 \| \$11\.08 \| \$0\.70 \| \$1,557\.73 \| 1490\.66% \|/);
  assert.doesNotMatch(report, /Derive Options|Live Derive scrape|Wallet 0x/);
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

test("loads the nearest earlier local snapshot as the position delta baseline", async () => {
  const runsDir = await mkdtemp(join(tmpdir(), "market-view-delta-"));
  try {
    for (const [id, timestamp, normalized] of [
      ["older", "2026-06-29T01:00:00.000Z", { traders: [{ name: "old" }] }],
      ["prior", "2026-06-29T02:00:00.000Z", { traders: [{ name: "prior" }] }],
      ["current", "2026-06-29T03:00:00.000Z", { traders: [{ name: "current" }] }],
    ]) {
      const snapshotDir = join(runsDir, id);
      await mkdir(snapshotDir, { recursive: true });
      const reportPath = join(snapshotDir, "report.md");
      await writeFile(reportPath, `# Market View\nDate: ${timestamp}\n`);
      await writeFile(join(snapshotDir, "normalized-input.json"), JSON.stringify(normalized));
      const time = new Date(timestamp);
      await utimes(reportPath, time, time);
    }

    const current = await readSnapshotWithComparison("current", { runsDir });
    assert.equal(current.comparisonSnapshot.id, "prior");
    assert.equal(current.comparisonSnapshot.normalized.traders[0].name, "prior");
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});

test("normalizes Supabase project refs into API URLs", () => {
  assert.equal(normalizeSupabaseUrl("crmwamlgmxbmwyxysvlp"), "https://crmwamlgmxbmwyxysvlp.supabase.co");
  assert.equal(normalizeSupabaseUrl("https://example.supabase.co/"), "https://example.supabase.co");
  assert.equal(normalizeSupabaseUrl(""), "");
});

test("maps the 00:00 UTC cron trigger to the Vietnam calendar date", () => {
  assert.equal(vietnamDateKey(new Date("2026-10-07T00:00:00.000Z")), "2026-10-07");
  assert.equal(vietnamDateKey(new Date("2026-10-06T23:59:59.000Z")), "2026-10-07");
});

test("lists Supabase snapshots through PostgREST", async () => {
  await withSupabaseEnv(async (requests) => {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return jsonResponse(200, [{
        id: "00000000-0000-4000-8000-000000000001",
        created_at: "2026-07-06T01:00:00.000Z",
        title: "Market View Snapshot",
        subtitle: "Date: 2026-07-06",
        model: "test-model",
        source: "live",
      }]);
    };

    const snapshots = await listMarketViewSnapshots();
    assert.equal(snapshots[0].id, "00000000-0000-4000-8000-000000000001");
    assert.equal(snapshots[0].storage, "supabase");
    assert.match(requests[0].url, /^https:\/\/test-project.supabase.co\/rest\/v1\/market_view_snapshots\?/);
    assert.equal(requests[0].options.headers.apikey, "test-service-role");
  });
});

test("classifies incomplete snapshots without treating order-only failures as missing positions", () => {
  assert.deepEqual(snapshotQuality({ source_errors: [] }), {
    status: "complete",
    sourceErrors: 0,
    criticalSourceErrors: 0,
  });
  assert.equal(snapshotQuality({ source_errors: [{ source: "imballzy-orders" }] }).status, "partial-orders");
  assert.equal(snapshotQuality({ source_errors: [{ source: "imballzy" }] }).status, "incomplete");
});

test("saves Supabase snapshot and flattened positions", async () => {
  await withSupabaseEnv(async (requests) => {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/rest/v1/market_view_snapshots")) {
        return jsonResponse(201, [{
          id: "00000000-0000-4000-8000-000000000002",
          created_at: "2026-07-06T01:00:00.000Z",
          title: "Market View Snapshot",
          subtitle: "Date: 2026-07-06",
          model: "test-model",
          source: "live",
          report: "# Market View Snapshot\nDate: 2026-07-06",
          normalized: { traders: [] },
          local_run_snapshot_id: "web-test",
        }]);
      }
      return jsonResponse(201, null);
    };

    const snapshot = await saveMarketViewSnapshot({
      model: "test-model",
      report: "# Market View Snapshot\nDate: 2026-07-06",
      localRunSnapshotId: "web-test",
      normalized: {
        traders: [{
          display_name: "Trader A",
          source: "Hypurrscan",
          positions: [{
            symbol: "BTC",
            side: "long",
            size: "1.5K",
            position_value_usd: "$100,000",
            entry: "$60,000",
            unrealized_pnl: "$10,000",
            leverage: "5X",
            category: "crypto",
          }],
        }],
      },
    });

    assert.equal(snapshot.id, "00000000-0000-4000-8000-000000000002");
    assert.equal(requests.length, 2);
    const positionsBody = JSON.parse(requests[1].options.body);
    assert.equal(positionsBody[0].snapshot_id, snapshot.id);
    assert.equal(positionsBody[0].size_numeric, 1500);
    assert.equal(positionsBody[0].position_value_usd, 100000);
  });
});

test("workflow smoke uses fallback analysis without NVIDIA key", async () => {
  const oldKey = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  const outputDir = "runs/market-view/test-refactor-workflow";
  await rm(outputDir, { recursive: true, force: true });

  try {
    const result = await generateMarketViewReport({
      inputData: sampleRawInput(),
      outputDir,
    });
    assert.equal(result.summaryFallback, true);
    assert.match(result.report, /Market positioning summary/);
    assert.match(result.report, /Aggregate tracked exposure leans long/);
    assert.equal(result.normalized.traders[0].bias, "BULLISH ↑");
  } finally {
    if (oldKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = oldKey;
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
    overall_summary: "Tracked positions lean long with a neutral cohort read.",
    hyperdash_summary: "Profitable cohorts lean long while loss-making cohorts lean short, producing a bullish UP read.",
    key_points: ["BTC long."],
  };
}

async function withSupabaseEnv(callback) {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oldFetch = globalThis.fetch;
  const requests = [];
  process.env.SUPABASE_URL = "test-project";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

  try {
    await callback(requests);
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    globalThis.fetch = oldFetch;
  }
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    text: async () => payload === null ? "" : JSON.stringify(payload),
  };
}
