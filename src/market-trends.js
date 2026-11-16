const MAX_AGE_MS = 36 * 60 * 60 * 1000;
const CACHE_MS = 60 * 60 * 1000;
let cached = null;
let pending = null;

function freshTime(value, label) {
  const time = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(time) || time > Date.now() + 5 * 60_000 || Date.now() - time > MAX_AGE_MS) {
    throw new Error(`${label} is missing or stale`);
  }
  return time;
}

async function getText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`CoinRotator returned ${response.status}`);
  return response.text();
}

function parseBtcLeg(value, unit) {
  if (!value || !["UP", "DOWN"].includes(value.trend) || !Number.isInteger(value.streak) || value.streak < 1) {
    throw new Error(`BTC USD ${unit} trend is unavailable`);
  }
  return { usd: { trend: value.trend, streak: value.streak, unit } };
}

async function fetchMarketTrends() {
  const html = await getText("https://coinrotator.app/market-health");
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("CoinRotator market data is missing");
  const next = JSON.parse(match[1]);
  const seed = next.props?.pageProps?.marketHealthSeed;
  if (!Array.isArray(seed?.daily) || seed.daily.length < 60) throw new Error("CoinRotator breadth history is incomplete");
  const updatedAt = freshTime(seed.lastUpdated, "CoinRotator breadth history");
  if (!next.buildId) throw new Error("CoinRotator build ID is missing");
  const year = new Date(updatedAt).getUTCFullYear();
  const history = seed.daily.map((row) => {
    let date = Date.parse(`${row.date}, ${year} UTC`);
    if (date > updatedAt + 24 * 60 * 60 * 1000) date = Date.parse(`${row.date}, ${year - 1} UTC`);
    if (!Number.isFinite(date) || !Number.isInteger(row.amount) || row.amount < 0 || !["UP", "DOWN", "HODL"].includes(row.trend)) {
      throw new Error("CoinRotator breadth history contains an invalid row");
    }
    return { date, amount: row.amount, trend: row.trend };
  });
  const latestDate = Math.max(...history.map((row) => row.date));
  const latest = history.filter((row) => row.date === latestDate);
  if (latest.length !== 3 || new Set(latest.map((row) => row.trend)).size !== 3) {
    throw new Error("Latest CoinRotator breadth reading is incomplete");
  }
  const trends = Object.fromEntries(latest.map((row) => [row.trend, row.amount]));

  const btcUrl = `https://coinrotator.app/_next/data/${encodeURIComponent(next.buildId)}/coin/bitcoin.json?tab=analysis`;
  const btcPage = JSON.parse(await getText(btcUrl)).pageProps;
  if (btcPage?.id !== "bitcoin" || !btcPage.signals) throw new Error("CoinRotator BTC signals are missing");
  const btcTime = freshTime(btcPage.signals.snapshotAt, "CoinRotator BTC signals");
  return {
    source: "CoinRotator", capturedAt: new Date().toISOString(),
    health: { data: { trends, total: latest.reduce((sum, row) => sum + row.amount, 0), reading: { comparison: {} } } },
    history: { data: history },
    btc: {
      asset: "BTC", capturedAt: new Date(btcTime).toISOString(),
      daily: parseBtcLeg(btcPage.signals["1d"]?.usd, "days"),
      weekly: parseBtcLeg(btcPage.signals["1w"]?.usd, "weeks"),
    },
  };
}

export async function getMarketTrends() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (!pending) pending = fetchMarketTrends().then((value) => {
    cached = { at: Date.now(), value };
    return value;
  }).finally(() => { pending = null; });
  return pending;
}
