import { requireApiAuth } from "../../lib/auth.js";
import {
  isSupabaseSnapshotStoreConfigured,
  listMarketViewSnapshots,
} from "../../src/market-view/supabase-snapshots.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireApiAuth(req, res)) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const persistence = {
    enabled: isSupabaseSnapshotStoreConfigured(),
    ok: false,
    error: null,
  };

  if (!persistence.enabled) {
    return res.status(200).json({
      snapshots: [],
      persistence,
      note: "Supabase snapshot persistence is not configured; browser-local snapshots are shown by the UI.",
    });
  }

  try {
    const snapshots = await listMarketViewSnapshots();
    persistence.ok = true;
    return res.status(200).json({ snapshots, persistence });
  } catch (error) {
    persistence.error = error.message;
    return res.status(200).json({
      snapshots: [],
      persistence,
      note: "Supabase snapshot persistence is unavailable; browser-local snapshots are shown by the UI.",
    });
  }
}
