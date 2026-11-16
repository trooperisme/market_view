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
  const table = extractTables(markdown).find((candidate) => {
    const headers = candidate.header.map((header) => header.toLowerCase().replace(/[^a-z%]/g, ""));
    return headers.some((header) => ["token", "symbol", "coin"].includes(header))
      && headers.includes("side")
      && headers.some((header) => ["value", "positionvalue", "mktval", "marketvalue"].includes(header));
  });
  if (!table) return [];
  const headers = table.header.map((header) => header.toLowerCase().replace(/[^a-z%]/g, ""));
  const indexOf = (...names) => headers.findIndex((header) => names.includes(header));
  const symbolIndex = indexOf("token", "symbol", "coin");
  const sideIndex = indexOf("side");
  const leverageIndex = indexOf("leverage", "lev");
  const valueIndex = indexOf("value", "positionvalue", "mktval", "marketvalue");
  const sizeIndex = indexOf("size", "amount");
  const entryIndex = indexOf("entry", "entryprice");
  const markIndex = indexOf("mark", "markprice");
  const pnlIndex = indexOf("pnl", "upnl", "unrealizedpnl");
  const fundingIndex = indexOf("funding", "fundingpaid");
  const liquidationIndex = indexOf("liq", "liqprice", "liquidation", "liquidationprice");
  const deltaIndex = indexOf("delta%");
  return table.rows.map((row) => {
    const symbol = row[symbolIndex];
    const delta = deltaIndex < 0 ? "" : row[deltaIndex];
    return {
      symbol,
      side: sideFromText(row[sideIndex]),
      leverage: leverageIndex < 0 ? "" : row[leverageIndex] || "",
      position_value_usd: numericValue(row[valueIndex]),
      size: sizeIndex < 0 ? "" : row[sizeIndex] || "",
      entry: entryIndex < 0 ? "" : normalizeMoneyText(row[entryIndex]),
      mark: markIndex < 0 ? "" : normalizeMoneyText(row[markIndex]),
      unrealized_pnl: pnlIndex < 0 ? "" : normalizeMoneyText(row[pnlIndex]),
      funding: fundingIndex < 0 ? "" : normalizeMoneyText(row[fundingIndex]),
      liquidation: liquidationIndex < 0 ? "" : normalizeMoneyText(row[liquidationIndex]),
      ...(delta ? { delta_pct: delta } : {}),
      category: categoryFor(symbol),
    };
  }).filter((position) => position.symbol && position.side !== "unknown");
}

function parseApproxUsd(value) {
  const cleaned = cleanCell(value).replace(/,/g, "");
  const match = cleaned.match(/\$?([\d.]+)\s*([KMB])?\s*\$?/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[String(match[2] || "").toUpperCase()] || 1;
  return base * multiplier;
}

function parseOrderToken(value) {
  const cleaned = cleanCell(value);
  const countMatch = cleaned.match(/\((\d+)\s+orders?\)/i);
  const count = countMatch ? Number(countMatch[1]) : 1;
  const symbol = cleaned
    .replace(/\s*\(\d+\s+orders?\)\s*/i, "")
    .replace(/-USD$/i, "")
    .trim();
  return {
    symbol,
    order_count: Number.isFinite(count) && count > 0 ? count : 1,
  };
}

export function parseHypurrscanOpenOrders(markdown) {
  const table = extractTables(markdown).find((candidate) => {
    const headers = candidate.header.map((header) => header.toLowerCase().replace(/[^a-z]/g, ""));
    return headers.includes("side")
      && headers.includes("price")
      && headers.includes("value")
      && headers.includes("size")
      && headers.some((header) => ["token", "symbol", "coin", "market"].includes(header));
  });
  if (!table) return [];

  const headers = table.header.map((header) => header.toLowerCase().replace(/[^a-z]/g, ""));
  const indexOf = (...names) => headers.findIndex((header) => names.includes(header));
  const tokenIndex = indexOf("token", "symbol", "coin", "market");
  const sideIndex = indexOf("side");
  const priceIndex = indexOf("price");
  const valueIndex = indexOf("value");
  const sizeIndex = indexOf("size");

  return table.rows.map((row) => {
    const token = parseOrderToken(row[tokenIndex]);
    return {
      symbol: token.symbol,
      side: cleanCell(row[sideIndex]).toUpperCase(),
      price_raw: cleanCell(row[priceIndex]),
      value_raw: cleanCell(row[valueIndex]),
      size_raw: cleanCell(row[sizeIndex]),
      order_count: token.order_count,
      value_usd_approx: parseApproxUsd(row[valueIndex]),
    };
  }).filter((order) => order.symbol && ["BUY", "SELL", "BID", "ASK"].includes(order.side));
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

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function pearLegGroupLabel(legs, assetSymbols) {
  return legs
    .map((leg) => assetSymbols[String(leg.asset)] || `asset:${leg.asset}`)
    .filter(Boolean)
    .join(" / ");
}

export function parsePearTraderPositions(payload, { assetSymbols = {} } = {}) {
  return (payload?.positions || []).flatMap((position, positionIndex) => {
    const legs = Array.isArray(position.legs) ? position.legs : [];
    const positionGroup = pearLegGroupLabel(legs, assetSymbols) || `Pair ${positionIndex + 1}`;
    return legs.map((leg) => {
      const remainingQty = numericOrNull(leg.remaining?.quantity) ?? 0;
      const realized = leg.realized || {};
      const side = String(leg.side || "").toLowerCase();
      const ticker = assetSymbols[String(leg.asset)] || `asset:${leg.asset}`;
      return {
        position_group: positionGroup,
        position_group_id: position.positionId || `pair-${positionIndex + 1}`,
        asset_id: String(leg.asset),
        ticker,
        symbol: ticker,
        side: ["long", "short"].includes(side) ? side : "unknown",
        status: remainingQty === 0 ? "closed" : "open",
        active_qty: remainingQty,
        entry_vwap: numericOrNull(leg.remaining?.entryVwap),
        displayed_size_usd: null,
        current_mark: null,
        current_upnl_usd: null,
        closed_qty: numericOrNull(realized.quantity) ?? 0,
        avg_exit_price: numericOrNull(realized.exitVwap),
        closed_pnl_gross_api: numericOrNull(realized.grossPnl) ?? 0,
        closed_pnl_net_api: numericOrNull(realized.netPnl) ?? 0,
        opened_at: position.openedAt || null,
        updated_at: position.updatedAt || null,
        source: "Pear Protocol",
        category: categoryFor(ticker),
      };
    });
  }).filter((position) => position.side !== "unknown");
}

function parseSignedMoneyNumber(value) {
  const match = String(value || "").match(/([+-]?)\$\s*([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  const number = Number(match[2].replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  return match[1] === "-" ? -number : number;
}

export function parsePearTraderUiPositions(markdown) {
  const rawLines = String(markdown || "").split(/\r?\n/);
  const lines = rawLines.map(cleanCell);
  const headerIndex = lines.findIndex((line) => /PairSizeEntryMarkTP\s*\/\s*SLPnL/i.test(line.replace(/\s+/g, "")));
  if (headerIndex < 0) return [];

  const rows = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (lines[index] !== "Hyperliquid") continue;
    const end = lines.slice(index + 1).findIndex((line) => line === "Hyperliquid");
    const chunk = lines.slice(index + 1, end < 0 ? lines.length : index + 1 + end);
    const rawChunk = rawLines.slice(index + 1, end < 0 ? rawLines.length : index + 1 + end);
    const tickers = [...new Set(rawChunk.flatMap((line) => [...String(line).matchAll(/!\[([^\]]+)\]/g)].map((match) => match[1])))].filter((ticker) => ticker !== "USDC");
    const moneyLines = chunk.filter((line) => /^[+-]?\$\s*[\d,]+(?:\.\d+)?(?:\s*\([^)]*\))?$/.test(line));
    if (!tickers.length || moneyLines.length < 4) continue;
    rows.push({
      position_group: tickers.join(" / "),
      displayed_size_usd: parseSignedMoneyNumber(moneyLines[0]),
      entry_vwap: parseSignedMoneyNumber(moneyLines[1]),
      current_mark: parseSignedMoneyNumber(moneyLines[2]),
      current_upnl_usd: parseSignedMoneyNumber(moneyLines[moneyLines.length - 1]),
    });
  }
  return rows;
}

export function mergePearTraderUiPositions(pairPositions, uiPositions) {
  const uiByGroup = new Map((uiPositions || []).map((position) => [position.position_group, position]));
  const activeCounts = new Map();
  for (const position of pairPositions || []) {
    if (position.status === "open") activeCounts.set(position.position_group, (activeCounts.get(position.position_group) || 0) + 1);
  }
  return (pairPositions || []).map((position) => {
    const ui = uiByGroup.get(position.position_group);
    if (!ui || position.status !== "open" || activeCounts.get(position.position_group) !== 1) return position;
    return {
      ...position,
      displayed_size_usd: ui.displayed_size_usd,
      current_mark: ui.current_mark,
      current_upnl_usd: ui.current_upnl_usd,
    };
  });
}

const SUBSCRIPT_DIGITS = {
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
};

function normalizeSubscriptZeros(value) {
  return String(value || "").replace(/0\.0([₀₁₂₃₄₅₆₇₈₉])(\d+)/g, (_, subscript, digits) => {
    const zeroCount = Number(SUBSCRIPT_DIGITS[subscript] || 0);
    return `0.${"0".repeat(zeroCount)}${digits}`;
  });
}

function signedNumericValue(value) {
  const text = normalizeSubscriptZeros(value);
  const sign = text.includes("-") || text.includes("◢") ? -1 : 1;
  const parsed = Number(text.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return sign * parsed;
}

function signedMoneyText(value) {
  const number = signedNumericValue(value);
  if (!number) return "$0";
  return `${number < 0 ? "-" : ""}${formatUsd(Math.abs(number))}`;
}

function parseDeriveInstrument(instrument) {
  const match = String(instrument || "").match(/^([A-Z0-9]+)\s+\$(\d[\d,]*(?:\.\d+)?)\s+(Call|Put)\s+([A-Z][a-z]{2})\s+(\d{1,2})$/);
  if (!match) {
    return {
      underlying: "",
      strike_usd: null,
      option_type: "option",
      expiry: "",
    };
  }

  const [, underlying, strike, type, month, day] = match;
  return {
    underlying,
    strike_usd: Number(strike.replace(/,/g, "")),
    option_type: type.toLowerCase(),
    expiry: `${month} ${day}`,
  };
}

export function parseDeriveOptionPositions(markdown) {
  const table = extractTables(markdown).find((candidate) => {
    const headers = candidate.header.map((header) => header.toLowerCase().replace(/[^a-z%]/g, ""));
    return headers.includes("instrument")
      && headers.some((header) => ["mktval", "value"].includes(header))
      && headers.some((header) => ["mark", "markprice"].includes(header))
      && headers.some((header) => ["upnl%", "upnlpct"].includes(header));
  });
  if (!table) return [];

  const headers = table.header.map((header) => header.toLowerCase().replace(/[^a-z%]/g, ""));
  const indexOf = (...names) => headers.findIndex((header) => names.includes(header));
  const amountIndex = indexOf("amount");
  const valueIndex = indexOf("mktval", "value");
  const markIndex = indexOf("mark", "markprice");
  const avgCostIndex = indexOf("avgcost");
  const pnlIndex = indexOf("upnl", "pnl");
  const pnlPctIndex = indexOf("upnl%", "upnlpct");

  return table.rows.map((row) => {
    const instrument = row[0];
    const parsed = parseDeriveInstrument(instrument);
    const side = String(row[amountIndex] || "").trim().startsWith("-") ? "short" : "long";
    const amount = signedNumericValue(row[amountIndex]);
    const marketValue = signedNumericValue(row[valueIndex]);
    const unrealizedPnl = signedNumericValue(row[pnlIndex]);
    const unrealizedPnlPct = signedNumericValue(row[pnlPctIndex]);
    return {
      symbol: parsed.underlying || instrument,
      instrument,
      instrument_type: "option",
      side,
      option_type: parsed.option_type,
      strike_usd: parsed.strike_usd,
      expiry: parsed.expiry,
      amount,
      size: row[amountIndex] || "",
      position_value_usd: Math.abs(marketValue),
      mark: normalizeMoneyText(normalizeSubscriptZeros(row[markIndex])),
      avg_cost: normalizeMoneyText(row[avgCostIndex]),
      unrealized_pnl: signedMoneyText(row[pnlIndex]),
      unrealized_pnl_usd: unrealizedPnl,
      unrealized_pnl_pct: unrealizedPnlPct,
      category: "crypto",
    };
  }).filter((position) => position.instrument && position.symbol);
}

function formatUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const formatted = Math.abs(number).toLocaleString("en-US", { maximumFractionDigits: 6 });
  return `${number < 0 ? "-" : ""}$${formatted}`;
}

function formatSize(value, symbol) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value || "");
  return `${Math.abs(number).toLocaleString("en-US", { maximumFractionDigits: 8 })} ${symbol}`;
}

function markPriceFromPosition(position) {
  const value = Number(position?.positionValue);
  const size = Math.abs(Number(position?.szi));
  if (!Number.isFinite(value) || !Number.isFinite(size) || size === 0) return "";
  return formatUsd(value / size);
}

export function parseHyperliquidAssetPositions(state) {
  return (state?.assetPositions || []).map((assetPosition) => {
    const position = assetPosition.position || {};
    const symbol = position.coin || "";
    const size = Number(position.szi);
    const leverage = position.leverage?.value ? `${position.leverage.value}X ${position.leverage.type || ""}`.trim() : "";
    return {
      symbol,
      side: size < 0 ? "short" : "long",
      leverage,
      position_value_usd: numericValue(position.positionValue),
      size: formatSize(position.szi, symbol),
      entry: formatUsd(position.entryPx),
      mark: markPriceFromPosition(position),
      unrealized_pnl: formatUsd(position.unrealizedPnl),
      funding: formatUsd(position.cumFunding?.sinceOpen),
      liquidation: position.liquidationPx ? formatUsd(position.liquidationPx) : "",
      category: categoryFor(symbol),
    };
  }).filter((position) => position.symbol && position.side !== "unknown");
}

export function parseHyperliquidAccountStats(state) {
  const summary = state?.marginSummary || state?.crossMarginSummary || {};
  const positions = state?.assetPositions?.length || 0;
  return [
    "Live Hyperliquid state",
    summary.accountValue ? `Account Value ${formatUsd(summary.accountValue)}` : "",
    summary.totalMarginUsed ? `Margin Used ${formatUsd(summary.totalMarginUsed)}` : "",
    `${positions} active position${positions === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" | ");
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

  function sentimentArrow(sentiment) {
    return sentiment.includes("Bearish") ? "↓" : sentiment.includes("Bullish") ? "↑" : "→";
  }

  function normalizeSentiment(value) {
    return /^(Very Bearish|Slightly Bearish|Slightly Bullish|Very Bullish|Bullish|Bearish|Neutral)$/.test(value) ? value : "Neutral";
  }

  function blockFromParts(slug, rawParts) {
    const parts = rawParts.map((part) => part.trim()).filter(Boolean);
    const money = parts.filter((part) => /^\$[\d,.]+M$/.test(part));
    const sentiment = normalizeSentiment(parts.find((part) => /^(Very Bearish|Slightly Bearish|Slightly Bullish|Very Bullish|Bullish|Bearish|Neutral)$/.test(part)) || "");
    const pnlRange = parts.find((part) => /PNL$/.test(part)) || "";
    return {
      slug,
      cohort: `${expectedBySlug.get(slug)}${pnlRange ? ` (${pnlRange})` : ""}`,
      sentiment: `${sentiment} ${sentimentArrow(sentiment)}`,
      long: money[0] || "Unavailable",
      short: money[1] || "Unavailable",
    };
  }

  const linkPattern = /\[([\s\S]*?)]\(https:\/\/hyperdash\.com\/explore\/cohorts\/([a-z_]+)\)/g;
  let match;

  while ((match = linkPattern.exec(section))) {
    const [, rawBlock, slug] = match;
    if (!expectedBySlug.has(slug)) continue;
    const parts = rawBlock.split(/\n+/).map((part) => part.trim()).filter(Boolean);
    blocks.set(slug, blockFromParts(slug, parts));
  }

  if (!blocks.size) {
    const labels = [];
    let cursor = 0;
    for (const [slug, label] of expected) {
      const index = section.indexOf(label, cursor);
      if (index === -1) continue;
      labels.push({ slug, label, index });
      cursor = index + label.length;
    }

    for (let index = 0; index < labels.length; index += 1) {
      const current = labels[index];
      const next = labels[index + 1];
      const rawBlock = section.slice(
        current.index + current.label.length,
        next ? next.index : section.length,
      ).replace(/Copytrading[\s\S]*$/, "").replace(/Account Size[\s\S]*$/, "");
      const parts = rawBlock.split(/\n+/).map((part) => part.trim()).filter(Boolean);
      if (!parts.length) continue;
      const { slug } = current;
      blocks.set(slug, blockFromParts(slug, parts));
    }
  }

  return expected.map(([slug]) => blocks.get(slug)).filter(Boolean);
}
