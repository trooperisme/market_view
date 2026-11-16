#!/usr/bin/env node

import { createServer } from "node:http";
import crypto from "node:crypto";
import { join, resolve } from "node:path";
import { DEFAULT_MODEL, LOCAL_PORT, PUBLIC_DIR, RUNS_DIR, timestamp } from "./src/config.js";
import { loadEnvFile } from "./src/env.js";
import { isAuthConfigured, isAuthorizedHeader } from "./src/auth.js";
import { readJsonBody, sendJson, serveStatic } from "./src/http.js";
import { generateMarketViewReport } from "./src/market-view/workflow.js";
import { getMarketTrends } from "./src/market-trends.js";
import { listSnapshots, readSnapshotWithComparison, serveSnapshotAsset } from "./src/market-view/snapshots.js";
import {
  isSupabaseSnapshotStoreConfigured,
  listMarketViewSnapshots,
  readLatestMarketViewSnapshot,
  readMarketViewSnapshot,
  saveMarketViewSnapshot,
} from "./src/market-view/supabase-snapshots.js";

await loadEnvFile(resolve(".env"));

function requireLocalAuth(req, res) {
  if (!isAuthConfigured()) {
    sendJson(res, 503, { error: "Market View auth is not configured. Set MARKET_VIEW_USER and MARKET_VIEW_PASSWORD in .env." });
    return false;
  }

  if (isAuthorizedHeader(req.headers.authorization)) return true;

  res.writeHead(401, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "WWW-Authenticate": 'Basic realm="Market View", charset="UTF-8"',
  });
  res.end("Authentication required.");
  return false;
}

function hasAtlasToken(req) {
  const expected = String(process.env.ATLAS_STATUS_TOKEN || "").trim();
  const authorization = String(req.headers.authorization || "");
  const provided = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!expected || !provided) return false;
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  const providedDigest = crypto.createHash("sha256").update(provided).digest();
  return crypto.timingSafeEqual(expectedDigest, providedDigest);
}

function vietnamDay(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

async function atlasStatus(req, res) {
  if (!hasAtlasToken(req)) {
    sendJson(res, 401, { product: "market", snapshotState: "unavailable" });
    return;
  }

  try {
    const latest = isSupabaseSnapshotStoreConfigured()
      ? await readLatestMarketViewSnapshot()
      : (await listSnapshots())[0] || null;
    const today = vietnamDay(new Date().toISOString());
    sendJson(res, 200, {
      product: "market",
      snapshotState: vietnamDay(latest?.createdAt) === today ? "fresh" : "missing",
    });
  } catch {
    sendJson(res, 503, { product: "market", snapshotState: "unavailable" });
  }
}

async function runMarketView({ model }) {
  const result = await generateMarketViewReport({
    live: true,
    model: model || DEFAULT_MODEL,
    outputDir: join(RUNS_DIR, `web-${timestamp()}`),
  });
  const persistence = {
    enabled: isSupabaseSnapshotStoreConfigured(),
    saved: false,
    error: null,
  };
  let comparisonSnapshot = null;
  let savedSnapshot = null;

  if (persistence.enabled) {
    try {
      comparisonSnapshot = await readLatestMarketViewSnapshot();
      savedSnapshot = await saveMarketViewSnapshot({
        model: result.model,
        report: result.report,
        normalized: result.normalized,
        summaryFallback: result.summaryFallback,
        localRunSnapshotId: result.snapshotId,
        source: "live",
      });
      persistence.saved = true;
    } catch (error) {
      persistence.error = error.message;
    }
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/atlas-status") {
      await atlasStatus(req, res);
      return;
    }
    if (!requireLocalAuth(req, res)) return;

    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        model: DEFAULT_MODEL,
        hasNvidiaKey: Boolean(process.env.NVIDIA_API_KEY),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/market-trends") {
      try {
        sendJson(res, 200, await getMarketTrends());
      } catch (error) {
        sendJson(res, 503, { error: error.message || "Market trends unavailable" });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/market-view/run") {
      const body = await readJsonBody(req);
      sendJson(res, 200, await runMarketView({ model: body.model }));
      return;
    }

    if (req.method === "GET" && req.url === "/api/market-view/snapshots") {
      const persistence = {
        enabled: isSupabaseSnapshotStoreConfigured(),
        ok: false,
        error: null,
      };
      if (!persistence.enabled) {
        sendJson(res, 200, { snapshots: await listSnapshots(), persistence });
        return;
      }
      try {
        const snapshots = await listMarketViewSnapshots();
        persistence.ok = true;
        sendJson(res, 200, { snapshots, persistence });
      } catch (error) {
        persistence.error = error.message;
        sendJson(res, 200, { snapshots: await listSnapshots(), persistence });
      }
      return;
    }

    const assetMatch = url.pathname.match(/^\/api\/market-view\/snapshots\/([^/]+)\/assets\/([^/]+)$/);
    if (req.method === "GET" && assetMatch) {
      const [, id, file] = assetMatch.map(decodeURIComponent);
      await serveSnapshotAsset(res, { id, file });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/market-view/snapshots/")) {
      const id = decodeURIComponent(req.url.replace("/api/market-view/snapshots/", ""));
      if (isSupabaseSnapshotStoreConfigured() && /^[0-9a-f-]{36}$/i.test(id)) {
        const snapshot = await readMarketViewSnapshot(id);
        if (!snapshot) {
          sendJson(res, 404, { error: "Snapshot not found." });
          return;
        }
        sendJson(res, 200, {
          ...snapshot,
          comparisonSnapshot: await readLatestMarketViewSnapshot({ before: snapshot.createdAt }),
        });
        return;
      }
      sendJson(res, 200, await readSnapshotWithComparison(id));
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res, { publicDir: PUBLIC_DIR });
      return;
    }

    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(LOCAL_PORT, "127.0.0.1", () => {
  console.log(`Market View web app running at http://localhost:${LOCAL_PORT}`);
});
