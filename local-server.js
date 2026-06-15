#!/usr/bin/env node

import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { DEFAULT_MODEL, LOCAL_PORT, PUBLIC_DIR, RUNS_DIR, timestamp } from "./src/config.js";
import { loadEnvFile } from "./src/env.js";
import { isAuthConfigured, isAuthorizedHeader } from "./src/auth.js";
import { readJsonBody, sendJson, serveStatic } from "./src/http.js";
import { generateMarketViewReport } from "./src/market-view/workflow.js";
import { listSnapshots, readSnapshot, serveSnapshotAsset } from "./src/market-view/snapshots.js";

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

async function runMarketView({ model }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing. Add it to .env before running the workflow.");
  }

  return generateMarketViewReport({
    live: true,
    model: model || DEFAULT_MODEL,
    outputDir: join(RUNS_DIR, `web-${timestamp()}`),
    coinsenseImage: true,
  });
}

const server = createServer(async (req, res) => {
  try {
    if (!requireLocalAuth(req, res)) return;

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        model: DEFAULT_MODEL,
        hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/market-view/run") {
      const body = await readJsonBody(req);
      sendJson(res, 200, await runMarketView({ model: body.model }));
      return;
    }

    if (req.method === "GET" && req.url === "/api/market-view/snapshots") {
      sendJson(res, 200, { snapshots: await listSnapshots() });
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
      sendJson(res, 200, await readSnapshot(id));
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

server.listen(LOCAL_PORT, () => {
  console.log(`Market View web app running at http://localhost:${LOCAL_PORT}`);
});
