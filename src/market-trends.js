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
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const error = new Error(`CoinRotator returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.text();
}

async function scrape(url, format) {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new Error("FIRECRAWL_API_KEY is required when CoinRotator blocks Vercel");
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: [format], maxAge: 0, storeInCache: false, onlyMainContent: false }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) throw new Error(`Firecrawl returned ${response.status}`);
  const payload = await response.json();
  const content = payload.data?.[format];
  if (!content) throw new Error(`Firecrawl ${format} is missing`);
  return content;
}

async function getMarketHealthHtml() {
  const url = "https://coinrotator.app/market-health";
  try { return await getText(url); }
  catch (error) {
    if (error.status !== 403) throw error;
    return scrape(url, "rawHtml");
  }
}

function parseBtcMarkdown(markdown, capturedAt) {
  const daily = markdown.match(/\*\*Daily Trend\*\*([\s\S]*?)\*\*Weekly Trend\*\*/i)?.[1];
  const weekly = markdown.match(/\*\*Weekly Trend\*\*([\s\S]*?)(?:## Price Data|## Analysis)/i)?.[1];
  if (!daily || !weekly) throw new Error("CoinRotator BTC trend sections are missing");
  const leg = (section, unit) => {
    const match = section.match(/USD:\s*(UP|DOWN)\s*(\d+)\s*(days?|weeks?)/i);
    if (!match || !match[3].toLowerCase().startsWith(unit.slice(0, -1))) {
      throw new Error(`BTC USD ${unit} trend is unavailable`);
    }
    return parseBtcLeg({ trend: match[1].toUpperCase(), streak: Number(match[2]) }, unit);
  };
  return { asset: "BTC", capturedAt, daily: leg(daily, "days"), weekly: leg(weekly, "weeks") };
}

function parseBtcLeg(value, unit) {
  if (!value || !["UP", "DOWN"].includes(value.trend) || !Number.isInteger(value.streak) || value.streak < 1) {
    throw new Error(`BTC USD ${unit} trend is unavailable`);
  }
  return { usd: { trend: value.trend, streak: value.streak, unit } };
}

async function fetchMarketTrends() {
  const html = await getMarketHealthHtml();
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
  let btc;
  try {
    const btcPage = JSON.parse(await getText(btcUrl)).pageProps;
    if (btcPage?.id !== "bitcoin" || !btcPage.signals) throw new Error("CoinRotator BTC signals are missing");
    const btcTime = freshTime(btcPage.signals.snapshotAt, "CoinRotator BTC signals");
    btc = {
      asset: "BTC", capturedAt: new Date(btcTime).toISOString(),
      daily: parseBtcLeg(btcPage.signals["1d"]?.usd, "days"),
      weekly: parseBtcLeg(btcPage.signals["1w"]?.usd, "weeks"),
    };
  } catch (error) {
    if (error.status !== 403) throw error;
    const markdown = await scrape("https://coinrotator.app/coin/bitcoin?tab=analysis", "markdown");
    btc = parseBtcMarkdown(markdown, new Date().toISOString());
  }
  return {
    source: "CoinRotator", capturedAt: new Date().toISOString(),
    health: { data: { trends, total: latest.reduce((sum, row) => sum + row.amount, 0), reading: { comparison: {} } } },
    history: { data: history },
    btc,
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
