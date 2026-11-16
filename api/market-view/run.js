import { requireApiAuth } from "../../lib/auth.js";
import { DEFAULT_MODEL } from "../../src/config.js";
import { readVercelJsonBody } from "../../src/http.js";
import { runMarketViewJob } from "../../src/market-view/server-run.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireApiAuth(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = await readVercelJsonBody(req);
    const result = await runMarketViewJob({
      model: body.model || DEFAULT_MODEL,
      includeOpenOrders: true,
      sourceConcurrency: 2,
      scrapeMaxAttempts: 3,
      llmTimeoutMs: 30000,
      llmBackupTimeoutMs: 30000,
    });
    return res.status(200).json({
      model: result.model,
      snapshotId: result.snapshotId,
      serverSnapshotId: result.serverSnapshotId,
      localRunSnapshotId: result.localRunSnapshotId,
      report: result.report,
      normalized: result.normalized,
      summaryFallback: result.summaryFallback,
      comparisonSnapshot: result.comparisonSnapshot,
      snapshotPersistence: result.snapshotPersistence,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
