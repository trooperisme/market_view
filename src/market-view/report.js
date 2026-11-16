import { money, numericValue, pct, sideLabel } from "./format.js";
import { computeHyperdashCohorts } from "./compute.js";

function formatMillions(value) {
  const amount = Number(value || 0);
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
}

function cohortLabel(cohort) {
  const isUnprofitable = /^(?:unprofitable|rekt|very unprofitable)\b/i.test(String(cohort.cohort || ""));
  return `${isUnprofitable ? "☠️" : "🤓"} ${cohort.cohort}`;
}

function renderHyperdashCohortTable(cohorts = []) {
  if (!cohorts.length) return "No current cohort positioning is available.";

  const rows = computeHyperdashCohorts(cohorts)
    .sort((a, b) => Number(b.values_available) - Number(a.values_available) || b.net_share_pct - a.net_share_pct)
    .map((cohort) => {
      const netLabel = !cohort.values_available ? "Unavailable"
        : cohort.direction === "long" ? `Long ${formatMillions(Math.abs(cohort.net_millions))}`
          : cohort.direction === "short" ? `Short ${formatMillions(Math.abs(cohort.net_millions))}`
            : "Balanced";
      const strength = ` (${cohort.net_share_pct.toFixed(1)}%)`;
      const read = !cohort.values_available ? "Data unavailable"
        : cohort.is_extreme ? `EXTREME ${cohort.direction.toUpperCase()}${strength}`
          : cohort.is_significant ? `SIGNIFICANT ${cohort.direction.toUpperCase()}${strength}`
            : cohort.direction === "balanced" ? `Balanced${strength}` : `Small ${cohort.direction} edge${strength}`;
      const long = cohort.values_available ? formatMillions(cohort.long_millions) : "Unavailable";
      const short = cohort.values_available ? formatMillions(cohort.short_millions) : "Unavailable";
      return `| ${cohortLabel(cohort)} | ${long} | ${short} | ${netLabel} | ${read} |`;
    });

  return [
    "| Cohort | Long | Short | Net | Read |",
    "|---|---:|---:|---:|---|",
    ...rows,
  ].join("\n");
}

export function renderPositionTable(trader) {
  if (!trader.positions?.length) return "";
  const positions = [...trader.positions]
    .sort((a, b) => Number(b.position_value_usd || 0) - Number(a.position_value_usd || 0));
  const isOptions = positions.some((position) => position.instrument_type === "option");
  if (isOptions) {
    const source = String(positions.find((position) => position.source)?.source || trader.source || "")
      .replace(/\s+Options$/i, "") || "—";
    const rows = positions.map((position) => {
      const pnlPct = Number(position.unrealized_pnl_pct);
      return [
        position.instrument || position.symbol || "Option",
        position.source || source,
        sideLabel(position.side),
        position.size || (Number.isFinite(Number(position.amount)) ? `${Number(position.amount) > 0 ? "+" : ""}${position.amount}` : "—"),
        money(position.position_value_usd),
        position.mark || "—",
        position.avg_cost || "—",
        position.unrealized_pnl || "—",
        Number.isFinite(pnlPct) ? `${pnlPct.toFixed(2)}%` : "—",
      ];
    });
    return [
      "| Instrument | Source | Side | Amount | Mkt Val | Mark | Avg Cost | UPnL | UPnL % |",
      "|---|---|---|---:|---:|---:|---:|---:|---:|",
      ...rows.map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");
  }

  const rows = positions.map((position) => {
    const label = position.instrument || position.symbol || position.coin || "Position";
    return [
      label,
      sideLabel(position.side),
      position.leverage || "—",
      position.size || "—",
      money(position.position_value_usd),
      position.entry || "—",
      position.unrealized_pnl || "—",
    ];
  });

  const labelHeader = isOptions ? "Instrument" : "Symbol";
  return [
    `| ${labelHeader} | Side | Leverage | Size | Position Value | Entry | Unrealized PnL |`,
    "|---|---|---:|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function pairNumber(value, { moneyValue = false, signed = true, maxDecimals = 8 } = {}) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const formatted = Math.abs(number).toLocaleString("en-US", { maximumFractionDigits: maxDecimals, minimumFractionDigits: maxDecimals === 2 ? 2 : 0 });
  if (!moneyValue) return `${number < 0 ? "-" : number > 0 && signed ? "+" : ""}${formatted}`;
  return `${number < 0 ? "-" : ""}$${formatted}`;
}

export function renderPairPositionTable(trader) {
  if (!trader.pair_positions?.length) return "";
  const estimatedPnl = trader.pair_positions.some((position) => position.pnl_basis === "price_only_estimate_excludes_fees_funding");
  const rows = trader.pair_positions.map((position) => [
      position.position_group || "—",
      position.ticker || position.symbol || "—",
      String(position.side || "unknown").toUpperCase(),
      String(position.status || "unknown").toUpperCase(),
      pairNumber(position.active_qty, { signed: !estimatedPnl }),
      pairNumber(position.entry_vwap, { moneyValue: true }),
      pairNumber(position.displayed_size_usd, { moneyValue: true, maxDecimals: estimatedPnl ? 2 : 8 }),
      pairNumber(position.current_mark, { moneyValue: true }),
      pairNumber(position.current_upnl_usd, { moneyValue: true, maxDecimals: estimatedPnl ? 2 : 8 }),
    ]);
  return [
    `| Position Group | Ticker | Side | Status | Active Qty | ${estimatedPnl ? "Entry" : "Entry VWAP"} | ${estimatedPnl ? "Leg Notional USD" : "Displayed Size USD"} | Current Mark | ${estimatedPnl ? "Est. Price PnL" : "Current uPnL"} |`,
    "|---|---|---|---|---:|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function renderPairReads(trader) {
  const groups = new Map();
  for (const leg of trader.pair_positions || []) {
    const key = leg.position_group_id || leg.position_group;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(leg);
  }
  return [...groups.values()].map((legs) => {
    const open = legs.filter((leg) => leg.status === "open");
    const sideRead = (side) => {
      const selected = open.filter((leg) => leg.side === side);
      if (!selected.length) return "";
      return selected.length === 1
        ? `${side.toUpperCase()} ${selected[0].ticker}`
        : `${side.toUpperCase()} ${selected.length}-asset basket`;
    };
    const sides = [sideRead("long"), sideRead("short")].filter(Boolean).join(" / ");
    const gross = open.reduce((sum, leg) => sum + (Number(leg.displayed_size_usd) || 0), 0);
    return `- ${sides || "No open legs"}${gross ? ` · ${money(gross)} gross` : ""}`;
  }).join("\n");
}

function openOrderValue(value) {
  return Number.isFinite(Number(value)) ? money(value) : "—";
}

function normalizedInstrument(value) {
  return String(value || "")
    .replace(/-USD$/i, "")
    .trim()
    .toUpperCase();
}

function isZeroValueOrder(order) {
  return Number.isFinite(Number(order.value_usd_approx))
    ? Number(order.value_usd_approx) === 0
    : /^\$?0+(?:\.0+)?\s*\$?$/.test(String(order.value_raw || "").trim());
}

function isStopLossOrder(order, trader) {
  if (!isZeroValueOrder(order)) return false;
  const expectedPositionSide = order.side === "SELL" ? "long" : order.side === "BUY" ? "short" : "";
  if (!expectedPositionSide) return false;
  return (trader.positions || []).some((position) => normalizedInstrument(position.symbol || position.instrument)
    === normalizedInstrument(order.symbol) && position.side === expectedPositionSide);
}

export function renderOpenOrderTable(trader) {
  if (!trader.open_orders?.length) return "";
  const orders = [...trader.open_orders]
    .sort((a, b) => (b.value_usd_approx || 0) - (a.value_usd_approx || 0));
  const rows = orders.map((order) => {
    const stopLoss = isStopLossOrder(order, trader);
    const orderCount = order.order_count > 1 ? ` (${order.order_count} orders)` : "";
    const token = stopLoss
      ? `**${order.symbol || "—"}**${orderCount} · STOP-LOSS`
      : order.order_count > 1
        ? `**${order.symbol || "—"}**${orderCount}`
        : order.symbol || "—";
    return [
      token,
      order.side || "—",
      order.price_raw || "—",
      order.value_raw || openOrderValue(order.value_usd_approx),
      order.size_raw || "—",
    ];
  });
  return [
    "| Token | Side | Price | Value | Size |",
    "|---|---|---:|---:|---:|",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function openOrderStatusLine(trader) {
  const summary = trader.open_order_summary || {};
  if (trader.open_orders_status === "unsupported") return "Open limit orders unavailable — this entity has no Hypurrscan orders source.";
  if (trader.open_orders_status === "unavailable") return "Open limit orders could not be scraped in this snapshot.";
  if (trader.open_orders_status === "partial") return `Open limit orders were only partially scraped (${summary.grouped_orders || 0} grouped rows visible).`;
  if (trader.open_orders_status === "empty") return "No visible open limit orders in this snapshot.";
  return `Open limit orders: ${summary.markets || 0} markets · ${summary.grouped_orders || 0} grouped rows · ${summary.reported_orders || 0} reported orders · ${money(summary.conditional_value_usd || 0)} conditional value (BUY ${money(summary.buy_value_usd || 0)} · SELL ${money(summary.sell_value_usd || 0)}).`;
}

function visibleAccountStats(value) {
  const visible = String(value || "")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => /^(?:Account Value|Margin Used|APR|TVL)\b/i.test(part)
      || /^Option positions unavailable\b/i.test(part)
      || /^\d+ active (?:option )?positions?$/i.test(part));
  return visible.join(" · ");
}

function traderPositionMix(trader) {
  const positions = trader.positions || [];
  const longExposure = Number.isFinite(Number(trader.long_exposure))
    ? Number(trader.long_exposure)
    : positions.filter((position) => position.side === "long")
      .reduce((sum, position) => sum + numericValue(position.position_value_usd), 0);
  const shortExposure = Number.isFinite(Number(trader.short_exposure))
    ? Number(trader.short_exposure)
    : positions.filter((position) => position.side === "short")
      .reduce((sum, position) => sum + numericValue(position.position_value_usd), 0);
  const total = longExposure + shortExposure;
  const longPct = total ? (longExposure / total) * 100 : 0;
  const shortPct = total ? (shortExposure / total) * 100 : 0;
  const longBlocks = total ? Math.round((longPct / 100) * 20) : 0;
  const visualBar = total ? `${"🟩".repeat(longBlocks)}${"🟥".repeat(20 - longBlocks)}` : "";
  return { total, longPct, shortPct, visualBar };
}

function renderTraderPositionMix(trader) {
  const mix = traderPositionMix(trader);
  if (!mix.total) return trader.pair_positions?.length
    ? "Position mix: not computed — pair legs are kept separate from directional exposure."
    : "Position mix: unavailable — no active positions.";
  return `Position mix: Long ${mix.longPct.toFixed(1)}% · Short ${mix.shortPct.toFixed(1)}% · ${mix.visualBar}`;
}

export function renderReport(input, analysis) {
  const lines = [];
  lines.push("# Market View");
  lines.push("");
  lines.push(`${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`);
  lines.push("");
  lines.push("## Hyperdash cohort positioning");
  lines.push("");
  const signal = input.hyperdash_signal;
  if (signal) {
    lines.push(`**Directional read: ${signal.direction} · ${signal.confidence} confidence**`);
    lines.push("");
    lines.push(analysis.hyperdash_summary || signal.reason);
    lines.push("");
  }
  lines.push(renderHyperdashCohortTable(input.hyperdash_cohorts));
  lines.push("");
  lines.push("## Largest positions by trader");
  const hasOpenOrderLayer = input.traders.some((trader) => Object.hasOwn(trader, "open_orders_status"));

  input.traders.forEach((trader, index) => {
    lines.push("");
    lines.push(`### ${index + 1}. ${trader.display_name}`);
    lines.push("");
    const accountStats = visibleAccountStats(trader.account_stats);
    if (accountStats) {
      lines.push(`Account stats: ${accountStats}`);
      lines.push("");
    }
    lines.push(renderTraderPositionMix(trader));
    lines.push("");
    const table = renderPositionTable(trader);
    if (table) lines.push(table);
    else if (trader.pair_positions?.length || trader.pair_positions_status) lines.push("Relative pair trades only.");
    else lines.push(trader.status === "positions_unavailable" ? "Current positions could not be confirmed." : "No active positions.");
    lines.push("");

    if (trader.pair_positions?.length || trader.pair_positions_status) {
      lines.push("Pair positions");
      lines.push("");
      if (trader.pair_positions?.length) {
        lines.push(renderPairReads(trader));
        lines.push("");
      }
      const pairTable = renderPairPositionTable(trader);
      if (pairTable) lines.push(pairTable);
      else lines.push(trader.pair_positions_status === "unavailable"
        ? "Pair positions could not be confirmed."
        : "No active pair positions.");
      lines.push("");
      if (trader.pair_positions?.some((position) => position.pnl_basis === "price_only_estimate_excludes_fees_funding")) {
        lines.push("Leg notional uses quantity × mark. Estimated price PnL excludes fees, funding, and realized PnL; pair trades are not a market-direction signal.");
        lines.push("");
      }
    }

    if (hasOpenOrderLayer) {
      lines.push(openOrderStatusLine(trader));
      lines.push("");
      const openOrderTable = renderOpenOrderTable(trader);
      if (openOrderTable) lines.push(openOrderTable);
      lines.push("");
    }
  });

  lines.push("");
  lines.push("## Market positioning summary");
  lines.push("");
  lines.push(analysis.overall_summary || "A complete market positioning summary is unavailable for this run.");

  return `${lines.join("\n")}\n`;
}

export function fallbackHyperdashConclusion(comparison) {
  if (!comparison) return "No Hyperdash cohort comparison returned.";
  const profitable = comparison.profitable_cohorts;
  const unprofitable = comparison.unprofitable_cohorts;
  return `Profitable cohorts are ${profitable.net}-tilted with ${pct(profitable.long_pct)} long versus ${pct(profitable.short_pct)} short, while unprofitable cohorts are ${unprofitable.net}-tilted with ${pct(unprofitable.long_pct)} long versus ${pct(unprofitable.short_pct)} short.`;
}
