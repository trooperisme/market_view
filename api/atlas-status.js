import { isAuthorizedSecret } from "../lib/auth.js";
import {
  isSupabaseSnapshotStoreConfigured,
  readLatestMarketViewSnapshot,
} from "../src/market-view/supabase-snapshots.js";

function vietnamDay(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function canReadAtlasStatus(req) {
  const authorization = String(req.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  return isAuthorizedSecret(token, process.env.ATLAS_STATUS_TOKEN);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!canReadAtlasStatus(req)) {
    return res.status(401).json({ product: "market", snapshotState: "unavailable" });
  }
  if (!isSupabaseSnapshotStoreConfigured()) {
    return res.status(503).json({ product: "market", snapshotState: "unavailable" });
  }

  try {
    const latest = await readLatestMarketViewSnapshot();
    return res.status(200).json({
      product: "market",
      snapshotState: vietnamDay(latest?.createdAt) === vietnamDay(new Date()) ? "fresh" : "missing",
      snapshotKey: latest?.id || null,
    });
  } catch {
    return res.status(503).json({ product: "market", snapshotState: "unavailable" });
  }
}
