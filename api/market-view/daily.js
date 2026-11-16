import { isAuthorizedCronRequest } from "../../lib/auth.js";
import { DEFAULT_MODEL } from "../../src/config.js";
import { runMarketViewJob } from "../../src/market-view/server-run.js";
import {
  isSupabaseSnapshotStoreConfigured,
  readLatestMarketViewSnapshot,
} from "../../src/market-view/supabase-snapshots.js";

function vietnamDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: "Scheduled Market View access denied." });
  }
  if (!isSupabaseSnapshotStoreConfigured()) {
    return res.status(503).json({ error: "Scheduled Market View requires Supabase snapshot persistence." });
  }

  const runKey = vietnamDateKey();
  const scheduledSource = `scheduled:${runKey}`;
  try {
    const existing = await readLatestMarketViewSnapshot({ source: scheduledSource });
    if (existing) {
      return res.status(200).json({ ok: true, status: "already_claimed", runKey, snapshotId: existing.id });
    }
  } catch (error) {
    return res.status(503).json({ error: `Could not check scheduled run: ${error.message}` });
  }

  try {
    const result = await runMarketViewJob({
      model: DEFAULT_MODEL,
      includeOpenOrders: true,
      sourceConcurrency: 2,
      scrapeMaxAttempts: 3,
      llmTimeoutMs: 30000,
      llmBackupTimeoutMs: 30000,
      outputPrefix: `daily-${runKey}`,
      source: scheduledSource,
      requirePersistence: true,
    });
    return res.status(200).json({
      ok: true,
      status: result.summaryFallback ? "complete_fallback" : "complete",
      runKey,
      snapshotId: result.serverSnapshotId,
      localRunSnapshotId: result.localRunSnapshotId,
      snapshotPersistence: result.snapshotPersistence,
      sourceErrors: result.normalized?.source_errors || [],
      openOrderEntities: (result.normalized?.traders || []).filter((trader) => trader.open_orders_status === "available").length,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, status: "failed", runKey, error: error.message });
  }
}

export { vietnamDateKey };
