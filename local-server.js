#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

await loadEnvFile(resolve(".env"));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = resolve("public");
const RUNS_DIR = resolve("runs", "market-view");
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

async function loadEnvFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        rejectBody(new Error("Request body too large."));
      }
    });
    req.on("end", () => {
      if (!body) return resolveBody({});
      try {
        resolveBody(JSON.parse(body));
      } catch {
        rejectBody(new Error("Invalid JSON body."));
      }
    });
    req.on("error", rejectBody);
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function runMarketView({ model }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing. Add it to .env before running the workflow.");
  }

  await mkdir(RUNS_DIR, { recursive: true });
  const outputDir = join(RUNS_DIR, `web-${timestamp()}`);
  const args = [
    "scripts/generate-market-view-report-openrouter.js",
    "--live",
    "--model",
    model || DEFAULT_MODEL,
    "--output-dir",
    outputDir,
  ];

  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));
  if (exitCode !== 0) {
    throw new Error(stderr || stdout || `Workflow exited with code ${exitCode}`);
  }

  const report = await readFile(join(outputDir, "report.md"), "utf8");
  const normalized = JSON.parse(await readFile(join(outputDir, "normalized-input.json"), "utf8"));
  const analysis = JSON.parse(await readFile(join(outputDir, "analysis.json"), "utf8"));

  return {
    model: model || DEFAULT_MODEL,
    snapshotId: basename(outputDir),
    outputDir,
    report,
    normalized,
    analysis,
  };
}

async function listSnapshots() {
  await mkdir(RUNS_DIR, { recursive: true });
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const snapshots = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const reportPath = join(RUNS_DIR, entry.name, "report.md");
    try {
      const reportStat = await stat(reportPath);
      const firstLines = (await readFile(reportPath, "utf8")).split(/\r?\n/).slice(0, 3);
      snapshots.push({
        id: entry.name,
        createdAt: reportStat.mtime.toISOString(),
        title: firstLines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "") || "Market View Snapshot",
        subtitle: firstLines.find((line) => line.startsWith("Date:")) || reportStat.mtime.toISOString(),
      });
    } catch {
      // Ignore incomplete runs.
    }
  }

  return snapshots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20);
}

async function readSnapshot(id) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error("Invalid snapshot id.");
  const snapshotDir = join(RUNS_DIR, id);
  const report = await readFile(join(snapshotDir, "report.md"), "utf8");
  let analysis = null;
  let normalized = null;

  try {
    analysis = JSON.parse(await readFile(join(snapshotDir, "analysis.json"), "utf8"));
  } catch {
    analysis = null;
  }

  try {
    normalized = JSON.parse(await readFile(join(snapshotDir, "normalized-input.json"), "utf8"));
  } catch {
    normalized = null;
  }

  return { id, report, analysis, normalized };
}

async function serveSnapshotAsset(req, res, url) {
  const match = url.pathname.match(/^\/api\/market-view\/snapshots\/([^/]+)\/assets\/([^/]+)$/);
  if (!match) return false;
  const [, id, file] = match.map(decodeURIComponent);
  if (!/^[A-Za-z0-9_.-]+$/.test(id) || !/^[A-Za-z0-9_.-]+$/.test(file)) {
    throw new Error("Invalid snapshot asset path.");
  }

  const assetPath = resolve(RUNS_DIR, id, "assets", file);
  const assetRoot = resolve(RUNS_DIR, id, "assets");
  if (!assetPath.startsWith(assetRoot)) throw new Error("Invalid snapshot asset path.");

  const fileStat = await stat(assetPath);
  if (!fileStat.isFile()) throw new Error("Snapshot asset not found.");
  res.writeHead(200, {
    "Content-Type": contentTypes[extname(assetPath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(assetPath).pipe(res);
  return true;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = rawPath.replace(/^\/+/, "");
  const filePath = resolve(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
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
      const result = await runMarketView({ model: body.model });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && req.url === "/api/market-view/snapshots") {
      sendJson(res, 200, { snapshots: await listSnapshots() });
      return;
    }

    if (req.method === "GET" && url.pathname.match(/^\/api\/market-view\/snapshots\/[^/]+\/assets\/[^/]+$/)) {
      await serveSnapshotAsset(req, res, url);
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/market-view/snapshots/")) {
      const id = decodeURIComponent(req.url.replace("/api/market-view/snapshots/", ""));
      sendJson(res, 200, await readSnapshot(id));
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Market View web app running at http://localhost:${PORT}`);
});
