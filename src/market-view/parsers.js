import { numericValue } from "./format.js";

export function cleanCell(value) {
  return String(value || "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\\/g, "")
    .trim();
}

export function normalizeMoneyText(value) {
  const cleaned = String(value || "").replace(/\s+/g, "").trim();
  if (!cleaned || cleaned === "-") return "";
  const negative = cleaned.includes("-");
  const digits = cleaned.replace(/[^0-9.,]/g, "");
  if (!digits) return cleaned;
  return `${negative ? "-" : ""}$${digits}`;
}

export function splitMarkdownRow(line) {
  return line.trim().slice(1, -1).split("|").map(cleanCell);
}

export function extractTables(markdown) {
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

export function categoryFor(symbol) {
  const normalized = String(symbol || "").toUpperCase();
  if (/(XAU|XCU|WTI|CL|OIL|GOLD|BRENTOIL|URA|XYZ100)/.test(normalized)) return "macro";
  return "crypto";
}

export function sideFromText(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("short")) return "short";
  if (normalized.includes("long")) return "long";
  return "unknown";
}

export function parseLightLensTrader(markdown) {
  const table = extractTables(markdown).find((candidate) => candidate.header.includes("Symbol") && candidate.header.includes("Position Value"));
  if (!table) return [];
  return table.rows.map((row) => {
    const symbol = row[0];
    return {
      symbol,
      side: sideFromText(row[2]),
      leverage: "",
      size: row[1] || "",
      position_value_usd: numericValue(row[4]),
      entry: normalizeMoneyText(row[3]),
      mark: "",
      unrealized_pnl: normalizeMoneyText(row[5]),
      funding: "",
      liquidation: "",
      category: categoryFor(symbol),
    };
  }).filter((position) => position.symbol && position.side !== "unknown");
}

export function parseHypurrscanTrader(markdown) {
  const table = extractTables(markdown).find((candidate) => candidate.header.includes("Token") && candidate.header.includes("Side") && candidate.header.includes("Value"));
  if (!table) return [];
  return table.rows.map((row) => {
    const symbol = row[0];
    return {
      symbol,
      side: sideFromText(row[1]),
      leverage: row[2] || "",
      position_value_usd: numericValue(row[3]),
      size: row[4] || "",
      entry: normalizeMoneyText(row[5]),
      mark: normalizeMoneyText(row[7]),
      unrealized_pnl: normalizeMoneyText(row[8]),
      funding: normalizeMoneyText(row[9]),
      liquidation: normalizeMoneyText(row[10]),
      category: categoryFor(symbol),
    };
  }).filter((position) => position.symbol && position.side !== "unknown");
}

export function parseGiverTrader(markdown) {
  const compact = markdown.replace(/!\[[^\]]*]\([^)]*\)/g, " ").replace(/\s+/g, " ");
  const btc = compact.match(/BTC\s+\d+×\s+([^$]+?)\s+(\$[\d,.]+)/);
  const aster = compact.match(/ASTER\s+\d+×\s+([^$]+?)\s+(\$[\d,.]+)/);
  const positions = [];
  if (btc) positions.push({ symbol: "BTC", side: btc[1].trim().startsWith("-") ? "short" : "long", size: btc[1].trim(), position_value_usd: numericValue(btc[2]), category: "crypto" });
  if (aster) positions.push({ symbol: "ASTER", side: aster[1].trim().startsWith("-") ? "short" : "long", size: aster[1].trim(), position_value_usd: numericValue(aster[2]), category: "crypto" });
  return positions;
}

export function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseLighterMarket(value) {
  const market = cleanCell(value);
  const leverage = market.match(/(\d+x)$/i)?.[1] || "";
  const symbol = market.replace(/\s*\d+x$/i, "").trim();
  return { market, symbol, leverage };
}

export function parseLighterPool(markdown, html = "") {
  const rows = [...html.matchAll(/<tr[^>]*data-index="(\d+)"[\s\S]*?<\/tr>/g)]
    .map((match) => {
      const rowHtml = match[0];
      const side = rowHtml.includes('data-testid="direction-short"')
        ? "short"
        : rowHtml.includes('data-testid="direction-long"') ? "long" : "unknown";
      const cell = (field) => stripHtml(rowHtml.match(new RegExp(`data-testid="row-\\d+-cell-\\d+_${field}"[^>]*>([\\s\\S]*?)<\\/td>`))?.[1] || "");
      const { symbol, leverage } = parseLighterMarket(cell("marketSymbol"));
      return {
        symbol,
        side,
        leverage,
        size: cell("sizeCoin"),
        position_value_usd: numericValue(cell("sizeUsd")),
        entry: normalizeMoneyText(cell("avgEntryPrice")),
        mark: normalizeMoneyText(cell("markPrice")),
        unrealized_pnl: normalizeMoneyText(cell("unrealizedPnl").replace(/\s+\([^)]+\)/, "")),
        funding: normalizeMoneyText(cell("funding")),
        liquidation: normalizeMoneyText(cell("liquidationPrice")),
        category: categoryFor(symbol),
      };
    })
    .filter((position) => position.symbol && position.side !== "unknown");

  if (rows.length) return rows;

  const table = extractTables(markdown).find((candidate) => candidate.header.includes("Market") && candidate.header.includes("Position Value"));
  return (table?.rows || []).map((row) => {
    const { symbol, leverage } = parseLighterMarket(row[0]);
    return {
      symbol,
      side: "unknown",
      leverage,
      size: row[1] || "",
      position_value_usd: numericValue(row[2]),
      entry: normalizeMoneyText(row[3]),
      mark: normalizeMoneyText(row[4]),
      unrealized_pnl: normalizeMoneyText(String(row[6] || "").replace(/\s+\([^)]+\)/, "")),
      funding: normalizeMoneyText(row[8]),
      liquidation: normalizeMoneyText(row[5]),
      category: categoryFor(symbol),
    };
  }).filter((position) => position.symbol && position.side !== "unknown");
}

export function parseLighterPoolStats(markdown, positions) {
  const apr = markdown.match(/APR\s+([\d.]+%)/s)?.[1] || "Unavailable";
  const tvl = markdown.match(/TVL\s+(\$[\d,.]+)/s)?.[1] || "Unavailable";
  return `APR ${apr} | TVL ${tvl} | ${positions.length} active position${positions.length === 1 ? "" : "s"}`;
}

export function parseCoinsense(markdown) {
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

export function parseHyperdashCohorts(markdown) {
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
      slug,
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
