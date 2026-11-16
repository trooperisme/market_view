import { requireApiAuth } from "../../../lib/auth.js";
import {
  isSupabaseSnapshotStoreConfigured,
  readLatestMarketViewSnapshot,
  readMarketViewSnapshot,
} from "../../../src/market-view/supabase-snapshots.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireApiAuth(req, res)) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isSupabaseSnapshotStoreConfigured()) {
    return res.status(404).json({ error: "Supabase snapshot persistence is not configured. Use browser-local snapshots." });
  }

  try {
    const id = req.query?.id || req.url?.split("/").pop();
    const snapshot = await readMarketViewSnapshot(String(id));
    if (!snapshot) return res.status(404).json({ error: "Snapshot not found." });
    const comparisonSnapshot = await readLatestMarketViewSnapshot({ before: snapshot.createdAt });
    return res.status(200).json({ ...snapshot, comparisonSnapshot });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
