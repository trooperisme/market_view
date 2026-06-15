import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { RUNS_DIR } from "../config.js";
import { contentTypes } from "../http.js";

export async function listSnapshots({ runsDir = RUNS_DIR } = {}) {
  await mkdir(runsDir, { recursive: true });
  const entries = await readdir(runsDir, { withFileTypes: true });
  const snapshots = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const reportPath = join(runsDir, entry.name, "report.md");
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

export async function readSnapshot(id, { runsDir = RUNS_DIR } = {}) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error("Invalid snapshot id.");
  const snapshotDir = join(runsDir, id);
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

export async function serveSnapshotAsset(res, { id, file, runsDir = RUNS_DIR }) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id) || !/^[A-Za-z0-9_.-]+$/.test(file)) {
    throw new Error("Invalid snapshot asset path.");
  }

  const assetPath = resolve(runsDir, id, "assets", file);
  const assetRoot = resolve(runsDir, id, "assets");
  if (!assetPath.startsWith(assetRoot)) throw new Error("Invalid snapshot asset path.");

  const fileStat = await stat(assetPath);
  if (!fileStat.isFile()) throw new Error("Snapshot asset not found.");
  res.writeHead(200, {
    "Content-Type": contentTypes[extname(assetPath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(assetPath).pipe(res);
}
