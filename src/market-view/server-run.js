import { join } from "node:path";
import { DEFAULT_MODEL, FIRECRAWL_SOURCE_CONCURRENCY } from "../config.js";
import { generateMarketViewReport } from "./workflow.js";
import {
  isSupabaseSnapshotStoreConfigured,
  readLatestMarketViewSnapshot,
  saveMarketViewSnapshot,
} from "./supabase-snapshots.js";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function runMarketViewJob({
  model = DEFAULT_MODEL,
  includeOpenOrders = true,
  sourceConcurrency = FIRECRAWL_SOURCE_CONCURRENCY,
  scrapeMaxAttempts = 3,
  llmTimeoutMs = 30000,
  llmBackupTimeoutMs = 30000,
  outputPrefix = "web",
  source = "live",
  requirePersistence = false,
} = {}) {
  const persistence = {
    enabled: isSupabaseSnapshotStoreConfigured(),
    saved: false,
    error: null,
  };
  if (requirePersistence && !persistence.enabled) {
    throw new Error("Scheduled Market View runs require Supabase snapshot persistence.");
  }

  let comparisonSnapshot = null;
  if (persistence.enabled) {
    try {
      comparisonSnapshot = await readLatestMarketViewSnapshot();
    } catch (error) {
      persistence.error = error.message;
    }
  }

  const outputDir = join("/tmp", "market-view", `${outputPrefix}-${timestamp()}`);
  const result = await generateMarketViewReport({
    live: true,
    model,
    outputDir,
    includeOpenOrders,
    sourceConcurrency,
    scrapeMaxAttempts,
    llmTimeoutMs,
    llmBackupTimeoutMs,
  });

  const criticalSourceErrors = (result.normalized?.source_errors || [])
    .filter((error) => !String(error.source || "").endsWith("-orders"));
  if (persistence.enabled && criticalSourceErrors.length) {
    const sources = criticalSourceErrors.map((error) => error.source).filter(Boolean).join(", ");
    throw new Error(`Market View scrape incomplete; snapshot not published. Failed sources: ${sources || "unknown"}.`);
  }

  let savedSnapshot = null;
  if (persistence.enabled) {
    try {
      savedSnapshot = await saveMarketViewSnapshot({
        model: result.model,
        report: result.report,
        normalized: result.normalized,
        summaryFallback: result.summaryFallback,
        localRunSnapshotId: result.snapshotId,
        source,
      });
      persistence.saved = true;
    } catch (error) {
      persistence.error ||= error.message;
    }
  }

  if (requirePersistence && !persistence.saved) {
    throw new Error(persistence.error || "Market View snapshot was not persisted.");
  }

  return {
    ...result,
    snapshotId: savedSnapshot?.id || result.snapshotId,
    serverSnapshotId: savedSnapshot?.id || null,
    localRunSnapshotId: result.snapshotId,
    comparisonSnapshot,
    snapshotPersistence: persistence,
  };
}
