import { numericValue } from "./format.js";
import { computeHyperdashSignal } from "../../public/cohort-signal.js";

export { computeHyperdashSignal };

export const HYPERDASH_SIGNIFICANT_NET_SHARE_PCT = 25;
export const HYPERDASH_EXTREME_NET_SHARE_PCT = 40;

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

export function computeHyperdashCohorts(cohorts) {
  return cohorts.map((cohort) => {
    const valuesAvailable = Boolean(cohort.long && cohort.short)
      && !/unavailable/i.test(`${cohort.long} ${cohort.short}`);
    const long = cohortValueInMillions(cohort.long);
    const short = cohortValueInMillions(cohort.short);
    const total = long + short;
    const net = long - short;
    const netSharePct = valuesAvailable && total ? (Math.abs(net) / total) * 100 : 0;
    const direction = !valuesAvailable ? "unknown" : net > 0 ? "long" : net < 0 ? "short" : "balanced";
    const isSignificant = valuesAvailable && total > 0 && netSharePct >= HYPERDASH_SIGNIFICANT_NET_SHARE_PCT;
    const isExtreme = valuesAvailable && total > 0 && netSharePct >= HYPERDASH_EXTREME_NET_SHARE_PCT;

    return {
      ...cohort,
      values_available: valuesAvailable,
      long_millions: Number(long.toFixed(2)),
      short_millions: Number(short.toFixed(2)),
      net_millions: Number(net.toFixed(2)),
      net_share_pct: Number(netSharePct.toFixed(1)),
      direction,
      is_significant: isSignificant,
      is_extreme: isExtreme,
    };
  });
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
  const hyperdashCohorts = computeHyperdashCohorts(input.hyperdash_cohorts || []);
  return {
    ...input,
    traders,
    hyperdash_cohorts: hyperdashCohorts,
    hyperdash_comparison: computeHyperdashComparison(hyperdashCohorts),
    hyperdash_signal: computeHyperdashSignal(hyperdashCohorts),
  };
}
