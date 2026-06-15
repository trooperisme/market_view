import { numericValue } from "./format.js";

export function sentimentForExposure(longPct, shortPct) {
  if (longPct >= 60) return "BULLISH ↑";
  if (shortPct >= 60) return "BEARISH ↓";
  if (longPct === 0 && shortPct === 0) return "NEUTRAL →";
  return "MIXED →";
}

export function computeTrader(trader) {
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

export function cohortValueInMillions(value) {
  const raw = String(value || "").replace(/[$,]/g, "").trim();
  const parsed = Number(raw.replace(/[MK]$/i, ""));
  if (!Number.isFinite(parsed)) return 0;
  if (/K$/i.test(raw)) return parsed / 1000;
  return parsed;
}

export function computeHyperdashComparison(cohorts) {
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

export function buildComputedInput(input) {
  const traders = (input.traders || []).map(computeTrader);
  return { ...input, traders, hyperdash_comparison: computeHyperdashComparison(input.hyperdash_cohorts || []) };
}
