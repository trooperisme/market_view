import { money, pct, sideArrow, sideLabel } from "./format.js";

export function quickReadFor(analysis, displayName) {
  return analysis.quick_reads?.find((read) => read.trader === displayName)?.text || "No quick read returned.";
}

export function renderPositionTable(trader) {
  if (!trader.positions?.length) return "";

  const hasSourceColumn = trader.positions.some((position) => position.source);
  const hasLeverageColumn = trader.positions.some((position) => position.leverage);
  const hasSizeColumn = trader.positions.some((position) => position.size);
  const hasEntryColumn = trader.positions.some((position) => position.entry);
  const hasUnrealizedPnlColumn = trader.positions.some((position) => position.unrealized_pnl);
  const rows = trader.positions.map((position) => {
    const value = money(position.position_value_usd);
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

export function renderReport(input, analysis, model) {
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
  lines.push("Top 5 positions:");
  lines.push("");
  lines.push("| # | Coin | Side | Size | Position Value | Unrealized PnL |");
  lines.push("|---:|---|---|---:|---:|---:|");
  for (const position of input.coinsense.positions.slice(0, 5)) {
    lines.push(`| ${position.rank} | ${position.coin} | ${position.side} ${sideArrow(position.side)} | ${position.size} | ${position.position_value} | ${position.unrealized_pnl} |`);
  }

  lines.push("");
  lines.push("## STEP 3 — Hyperdash Cohort Sentiment (All-Time PNL)");
  lines.push("");
  lines.push("| Segment | Bias | Long | Short | Trend |");
  lines.push("|---|---|---:|---:|---|");
  for (const cohort of input.hyperdash_cohorts) {
    const trendCell = cohort.trend_image?.path ? `[[img:${cohort.trend_image.path}]]` : "-";
    lines.push(`| ${cohort.cohort} | ${cohort.sentiment} | ${cohort.long} | ${cohort.short} | ${trendCell} |`);
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

export function fallbackHyperdashConclusion(comparison) {
  if (!comparison) return "No Hyperdash cohort comparison returned.";
  const profitable = comparison.profitable_cohorts;
  const unprofitable = comparison.unprofitable_cohorts;
  return `Profitable cohorts are ${profitable.net}-tilted with ${pct(profitable.long_pct)} long versus ${pct(profitable.short_pct)} short, while unprofitable cohorts are ${unprofitable.net}-tilted with ${pct(unprofitable.long_pct)} long versus ${pct(unprofitable.short_pct)} short.`;
}
