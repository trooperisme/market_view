import { join, resolve } from "node:path";
import { loadEnvFile } from "./env.js";

await loadEnvFile(resolve(".env"));

export const DEFAULT_INPUT = "fixtures/market-view/mock-input.json";
export const DEFAULT_MODEL = process.env.NVIDIA_MODEL || "z-ai/glm-5.3-flash";
export const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_TIMEOUT_MS = Number(process.env.NVIDIA_TIMEOUT_MS || 60000);
export const NVIDIA_BACKUP_TIMEOUT_MS = Number(process.env.NVIDIA_BACKUP_TIMEOUT_MS || 60000);
export const NVIDIA_BACKUP_MODELS = (process.env.NVIDIA_BACKUP_MODELS || "nvidia/nemotron-3.5-lightning-30b-a3b")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
export const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL || "https://api.firecrawl.dev";
export const FIRECRAWL_MIN_INTERVAL_MS = Math.max(0, Number(process.env.FIRECRAWL_MIN_INTERVAL_MS || 6500));
export const FIRECRAWL_SOURCE_CONCURRENCY = Math.max(1, Number(process.env.FIRECRAWL_SOURCE_CONCURRENCY || 2));
export const FRESH_MAX_AGE_MS = 0;
export const HYPERLIQUID_INFO_URL = process.env.HYPERLIQUID_INFO_URL || "https://api.hyperliquid.xyz/info";
export const PUBLIC_DIR = resolve("public");
export const RUNS_DIR = resolve("runs", "market-view");
export const LOCAL_PORT = Number(process.env.PORT || 3000);
export const PEAR_HUF_ASSET_SYMBOLS = {
  "159": "HYPE",
  "223": "LIT",
  "110000": "XYZ100",
  "110012": "GOOGL",
  "110084": "AVGO",
};

export const sourceUrls = {
  hansolarLightlens: "https://lightlens.vercel.app/traders/0x9b8d146ab4b61c281b993e3f85066249a6e9b0db",
  hansolarHypurrscan: "https://hypurrscan.io/address/0x9b8d146ab4b61c281b993e3f85066249a6e9b0db#perps",
  hansolarLighter: "https://app.lighter.xyz/public-pools/281474976694250",
  kyotoHypurrscan: "https://hypurrscan.io/address/0x06184a3d663dae6f40420cb536dcab7fe9492475#perps",
  giver: "https://hypurrscan.io/vault/0x8fc7c0442e582bca195978c5a4fdec2e7c5bb0f7",
  vuongMcDerive: "https://app.derive.xyz/wallet/0xe575ff507bbde43aa48315312365253304dfbe63?tab=positions",
  onchainSorcerer: "https://hypurrscan.io/address/0xba4387ac1a36f648d1044b2f79023d1f42aa8ee3#perps",
  onchainSorcererAlt: "https://hypurrscan.io/address/0x1a02b0e7d51cccdeb4b9ebedbca5607872dac5fe#perps",
  coinbender: "https://hypurrscan.io/address/0x4829f3bbd5508707339547ebefface2b4c86d3b5#perps",
  cryptoCondom: "https://hypurrscan.io/address/0x48ec0004494081e8332589faf0747d568da79faf#perps",
  degenDuck: "https://hypurrscan.io/address/0x962ad4a1276d2f985f8afabd3da59bd32e5c36f2#perps",
  tommy: "https://hypurrscan.io/address/0x83b1385d8126ecf64bfb3b4254d67eb9db753bcc#perps",
  tommyAlt: "https://hypurrscan.io/address/0x57B8cFc502f14CC9eF77668D2208f001e1cCB4fC#perps",
  bmwball56: "https://hypurrscan.io/address/0xaf6f7a06f7bfb3bdf7bcd2c751564f4990d1efc7#perps",
  convexityBtc: "https://hypurrscan.io/address/0x5661a070eb13c7c55ac3210b2447d4bea426cbf5#perps",
  fhdHypurrscan: "https://hypurrscan.io/address/0x5cbdb794b3b36df58a7ce6c1a552f117f061103b#perps",
  imBallzyHypurrscan: "https://hypurrscan.io/address/0x39c3492e9171872eac6a99d9c0b6dbae5d4ae959#perps",
  hyperdash: "https://hyperdash.com/explore",
  pearHufProfile: "https://app.pear.garden/copytrade/trader/7c5dd97c-6c01-45a2-a94b-a18c39faf913",
  pearHufApi: "https://pro-gateway.pearprotocol.io/traders/7c5dd97c-6c01-45a2-a94b-a18c39faf913",
};

export const marketViewHypurrscanOrderSources = [
  { entity: "Hansolar", id: "hansolar", label: "Hypurrscan 0x9b8d", url: sourceUrls.hansolarHypurrscan },
  { entity: "Giver", id: "giver", label: "Hypurrscan Vault", url: sourceUrls.giver },
  { entity: "0xKyoto", id: "kyoto", label: "Hypurrscan 0x06184a", url: sourceUrls.kyotoHypurrscan },
  { entity: "OnchainSorcerer", id: "onchain-sorcerer", label: "Hypurrscan 0xba4387", url: sourceUrls.onchainSorcerer },
  { entity: "OnchainSorcerer", id: "onchain-sorcerer-alt", label: "Hypurrscan 0x1a02b0", url: sourceUrls.onchainSorcererAlt },
  { entity: "coinbender_lfg", id: "coinbender", label: "Hypurrscan 0x4829f3", url: sourceUrls.coinbender },
  { entity: "CryptoCondom", id: "cryptocondom", label: "Hypurrscan 0x48ec00", url: sourceUrls.cryptoCondom },
  { entity: "DegenDuck", id: "degenduck", label: "Hypurrscan 0x962ad4", url: sourceUrls.degenDuck },
  { entity: "tommy", id: "tommy", label: "Hypurrscan 0x83b138", url: sourceUrls.tommy },
  { entity: "tommy", id: "tommy-alt", label: "Hypurrscan 0x57B8cF", url: sourceUrls.tommyAlt },
  { entity: "bmwball56", id: "bmwball56", label: "Hypurrscan 0xaf6f7a", url: sourceUrls.bmwball56 },
  { entity: "+convexity (BTC)", id: "convexity-btc", label: "Hypurrscan 0x5661a0", url: sourceUrls.convexityBtc },
  { entity: "fhd", id: "fhd", label: "Hypurrscan 0x5cbdb7", url: sourceUrls.fhdHypurrscan },
  { entity: "ImBallzy", id: "imballzy", label: "Hypurrscan 0x39c349", url: sourceUrls.imBallzyHypurrscan },
];

export const HYPERDASH_TREND_LAYOUT = [
  { slug: "extremely_profitable", x: 496, y: 176, width: 175, height: 71 },
  { slug: "very_profitable", x: 903, y: 176, width: 175, height: 71 },
  { slug: "profitable", x: 1310, y: 176, width: 175, height: 71 },
  { slug: "unprofitable", x: 1715, y: 176, width: 175, height: 71 },
  { slug: "very_unprofitable", x: 496, y: 372, width: 175, height: 71 },
  { slug: "rekt", x: 903, y: 372, width: 175, height: 71 },
];

export function marketViewRunDir(prefix = "nvidia-run") {
  return join(RUNS_DIR, `${prefix}-${timestamp()}`);
}

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
