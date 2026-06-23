import { join, resolve } from "node:path";

export const DEFAULT_INPUT = "fixtures/market-view/mock-input.json";
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";
export const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL || "https://api.firecrawl.dev";
export const FRESH_MAX_AGE_MS = 0;
export const OPENROUTER_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 10000);
export const PUBLIC_DIR = resolve("public");
export const RUNS_DIR = resolve("runs", "market-view");
export const LOCAL_PORT = Number(process.env.PORT || 3000);
export const COINSENSE_VAULT_URL = "https://www.coinsense.app/vault";

export const sourceUrls = {
  hansolarLightlens: "https://lightlens.vercel.app/traders/0x9b8d146ab4b61c281b993e3f85066249a6e9b0db",
  hansolarHypurrscan: "https://hypurrscan.io/address/0x9b8d146ab4b61c281b993e3f85066249a6e9b0db#perps",
  hansolarLighter: "https://app.lighter.xyz/public-pools/281474976694250",
  nypLighter: "https://app.lighter.xyz/public-pools/281474976624925",
  kPoolLighter: "https://app.lighter.xyz/public-pools/281474976680237",
  giver: "https://legacy.hyperdash.com/trader/0x8fc7c0442e582bca195978c5a4fdec2e7c5bb0f7",
  onchainSorcerer: "https://hypurrscan.io/address/0xba4387ac1a36f648d1044b2f79023d1f42aa8ee3#perps",
  coinbender: "https://hypurrscan.io/address/0x4829f3bbd5508707339547ebefface2b4c86d3b5#perps",
  cryptoCondom: "https://hypurrscan.io/address/0x48ec0004494081e8332589faf0747d568da79faf#perps",
  bigTrout300: "https://hypurrscan.io/address/0x7d6e1a5c35c7BF01b22Aca2Ed893B9d4132128D3#perps",
  degenDuck: "https://hypurrscan.io/address/0x2bf39a1004ff433938a5f933a44b8dad377937f6#perps",
  tommy: "https://hypurrscan.io/address/0x83b1385d8126ecf64bfb3b4254d67eb9db753bcc#perps",
  bmwball56: "https://hypurrscan.io/address/0xaf6f7a06f7bfb3bdf7bcd2c751564f4990d1efc7#perps",
  coinsense: COINSENSE_VAULT_URL,
  hyperdash: "https://hyperdash.com/explore",
};

export const HYPERDASH_TREND_LAYOUT = [
  { slug: "extremely_profitable", x: 496, y: 176, width: 175, height: 71 },
  { slug: "very_profitable", x: 903, y: 176, width: 175, height: 71 },
  { slug: "profitable", x: 1310, y: 176, width: 175, height: 71 },
  { slug: "unprofitable", x: 1715, y: 176, width: 175, height: 71 },
  { slug: "very_unprofitable", x: 496, y: 372, width: 175, height: 71 },
  { slug: "rekt", x: 903, y: 372, width: 175, height: 71 },
];

export function marketViewRunDir(prefix = "openrouter-test") {
  return join(RUNS_DIR, `${prefix}-${timestamp()}`);
}

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
