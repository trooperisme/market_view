import {
  buildPositionSizeIndex,
  deltaClass,
  deltaLabel,
  findLatestPriorSnapshot,
  numericPositionValue,
  sortTableRowsByPositionValue,
} from "./position-tools.js";

const runButton = document.querySelector("#run");
const copyButton = document.querySelector("#copy");
const statusLine = document.querySelector("#status");
const reportEl = document.querySelector("#report");
const modelSelect = document.querySelector("#model");
const snapshotsEl = document.querySelector("#snapshots");

let currentMarkdown = "";
let currentSnapshotId = null;
let currentNormalized = null;
const BROWSER_SNAPSHOT_PREFIX = "market-view:snapshot:";
const MAX_BROWSER_SNAPSHOTS = 8;
const MAX_BROWSER_SNAPSHOT_BYTES = 2_000_000;

function setStatus(message) {
  statusLine.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[\[img:([^\]]+)]]/g, (_, src) => `<img class="trend-mini" src="${escapeHtml(resolveReportAsset(src))}" alt="Trend graph" loading="lazy" />`)
    .replace(/\bLong ↑\b/g, '<span class="side-badge side-badge-long">Long ↑</span>')
    .replace(/\bShort ↓\b/g, '<span class="side-badge side-badge-short">Short ↓</span>');
}

function resolveReportAsset(src) {
  if (/^(https?:|data:|\/)/i.test(src)) return src;
  if (!currentSnapshotId) return src;
  return `/api/market-view/snapshots/${encodeURIComponent(currentSnapshotId)}/assets/${encodeURIComponent(src.replace(/^assets\//, ""))}`;
}

function browserSnapshotKey(id) {
  return `${BROWSER_SNAPSHOT_PREFIX}${id}`;
}

function collectBrowserSnapshots() {
  const snapshots = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(BROWSER_SNAPSHOT_PREFIX)) continue;
    try {
      snapshots.push(JSON.parse(localStorage.getItem(key)));
    } catch {
      localStorage.removeItem(key);
    }
  }

  return snapshots
    .filter((snapshot) => snapshot?.id && snapshot?.report)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function readBrowserSnapshots() {
  return collectBrowserSnapshots().slice(0, 20);
}

function pruneBrowserSnapshots(keep = MAX_BROWSER_SNAPSHOTS) {
  for (const snapshot of collectBrowserSnapshots().slice(keep)) {
    localStorage.removeItem(browserSnapshotKey(snapshot.id));
  }
}

function isStorageQuotaError(error) {
  return error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014;
}

function saveBrowserSnapshot(payload) {
  const createdAt = new Date().toISOString();
  const id = `browser-${payload.snapshotId || createdAt.replace(/[:.]/g, "-")}`;
  const reportDate = payload.report.split(/\r?\n/).find((line) => line.startsWith("Date:")) || createdAt;
  const snapshot = {
    id,
    serverSnapshotId: payload.snapshotId || null,
    createdAt,
    title: "Market View Snapshot",
    subtitle: reportDate,
    report: payload.report,
    normalized: payload.normalized || null,
  };
  const serialized = JSON.stringify(snapshot);

  pruneBrowserSnapshots(MAX_BROWSER_SNAPSHOTS - 1);

  if (new Blob([serialized]).size > MAX_BROWSER_SNAPSHOT_BYTES) {
    return { saved: false, reason: "too_large" };
  }

  try {
    localStorage.setItem(browserSnapshotKey(id), serialized);
    return { saved: true, snapshot };
  } catch (error) {
    if (!isStorageQuotaError(error)) throw error;
    pruneBrowserSnapshots(0);
    try {
      localStorage.setItem(browserSnapshotKey(id), serialized);
      return { saved: true, snapshot };
    } catch (retryError) {
      if (!isStorageQuotaError(retryError)) throw retryError;
      return { saved: false, reason: "quota" };
    }
  }
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let table = null;
  let listOpen = false;

  function closeList() {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  }

  function closeTable() {
    if (!table) return;
    html.push("<table>");
    html.push("<thead><tr>");
    for (const cell of table.header) html.push(`<th>${inlineMarkdown(cell)}</th>`);
    html.push("</tr></thead><tbody>");
    for (const row of table.rows) {
      html.push("<tr>");
      for (const cell of row) html.push(`<td>${inlineMarkdown(cell)}</td>`);
      html.push("</tr>");
    }
    html.push("</tbody></table>");
    table = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      closeList();
      const cells = trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
      const isDivider = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
      if (isDivider) continue;
      if (!table) table = { header: cells, rows: [] };
      else table.rows.push(cells);
      continue;
    }

    closeTable();

    if (!trimmed) {
      closeList();
      continue;
    }

    if (trimmed.startsWith("# ")) {
      closeList();
      html.push(`<h1>${inlineMarkdown(trimmed.slice(2))}</h1>`);
    } else if (/^!\[[^\]]*]\([^)]+\)$/.test(trimmed)) {
      closeList();
      const [, alt, src] = trimmed.match(/^!\[([^\]]*)]\(([^)]+)\)$/);
      html.push(`<figure class="report-image"><img src="${escapeHtml(resolveReportAsset(src))}" alt="${escapeHtml(alt)}" loading="lazy" /><figcaption>${escapeHtml(alt)}</figcaption></figure>`);
    } else if (trimmed.startsWith("## ")) {
      closeList();
      html.push(`<h2>${inlineMarkdown(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("### ")) {
      closeList();
      html.push(`<h3>${inlineMarkdown(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith("- ")) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(trimmed.slice(2))}</li>`);
    } else {
      closeList();
      html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
    }
  }

  closeTable();
  closeList();
  return html.join("");
}

function renderReportView(markdown, normalized, comparisonSnapshot = null) {
  reportEl.innerHTML = renderMarkdown(markdown);
  enhanceTraderPositionTables(normalized, comparisonSnapshot?.normalized || null);
}

function enhanceTraderPositionTables(normalized, comparisonNormalized) {
  const traders = normalized?.traders || [];
  if (!traders.length) return;

  const previousSizes = comparisonNormalized ? buildPositionSizeIndex(comparisonNormalized) : null;
  const tables = Array.from(reportEl.querySelectorAll("table"));
  let tableIndex = 0;

  for (const trader of traders) {
    const positions = trader.positions || [];
    if (!positions.length) continue;

    const table = tables[tableIndex];
    tableIndex += 1;
    if (!table) continue;

    const headerCells = Array.from(table.querySelectorAll("thead th"));
    const positionValueIndex = headerCells.findIndex((cell) => cell.textContent.trim() === "Position Value");
    if (positionValueIndex === -1) continue;

    table.classList.add("position-table");
    const deltaHeader = document.createElement("th");
    deltaHeader.textContent = "Delta %";
    headerCells[headerCells.length - 1].after(deltaHeader);

    const sortButton = document.createElement("button");
    sortButton.type = "button";
    sortButton.className = "table-sort-button";
    sortButton.dataset.sortDirection = "none";
    sortButton.innerHTML = "<span>Position Value</span><span class=\"sort-caret\" aria-hidden=\"true\">↕</span>";
    sortButton.setAttribute("aria-label", "Sort positions by position value");
    headerCells[positionValueIndex].textContent = "";
    headerCells[positionValueIndex].appendChild(sortButton);

    const rows = Array.from(table.querySelectorAll("tbody tr"));
    rows.forEach((row, rowIndex) => {
      const position = positions[rowIndex];
      const cells = Array.from(row.children);
      const positionValue = numericPositionValue(position?.position_value_usd);
      row.dataset.positionValue = String(positionValue);

      const deltaCell = document.createElement("td");
      const priorSize = previousSizes?.get([
        trader.display_name || trader.name || "",
        position?.source || trader.source || "",
        position?.symbol || "",
        String(position?.side || "").toLowerCase(),
      ].join("||"));
      const label = previousSizes ? deltaLabel(position?.size, priorSize) : "-";
      deltaCell.textContent = label;
      deltaCell.className = `delta-cell ${deltaClass(label)}`;
      cells[cells.length - 1].after(deltaCell);
    });

    sortButton.addEventListener("click", () => {
      const nextDirection = sortButton.dataset.sortDirection === "asc" ? "desc" : "asc";
      sortButton.dataset.sortDirection = nextDirection;
      sortButton.querySelector(".sort-caret").textContent = nextDirection === "asc" ? "↑" : "↓";
      sortTableRowsByPositionValue(table.querySelector("tbody"), nextDirection);
    });
  }
}

async function runWorkflow() {
  runButton.disabled = true;
  copyButton.disabled = true;
  reportEl.innerHTML = "<p class=\"empty-state\">Running Market View...</p>";
  setStatus("Calling OpenRouter and generating trader quick reads.");

  try {
    const response = await fetch("/api/market-view/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelSelect.value }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Workflow failed.");

    currentMarkdown = payload.report;
    currentSnapshotId = payload.snapshotId;
    currentNormalized = payload.normalized || null;
    const comparisonSnapshot = collectBrowserSnapshots().find((snapshot) => snapshot.normalized) || null;
    renderReportView(currentMarkdown, currentNormalized, comparisonSnapshot);
    const browserSnapshot = saveBrowserSnapshot(payload);
    if (browserSnapshot.saved) setStatus(`Done. Generated with ${payload.model}.`);
    else setStatus(`Done. Generated with ${payload.model}. Browser snapshot not saved (${browserSnapshot.reason}).`);
    await loadSnapshots();
  } catch (error) {
    currentMarkdown = "";
    currentSnapshotId = null;
    currentNormalized = null;
    reportEl.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    setStatus("Workflow failed.");
  } finally {
    runButton.disabled = false;
    copyButton.disabled = false;
  }
}

async function loadSnapshots() {
  try {
    const response = await fetch("/api/market-view/snapshots");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load snapshots.");
    const browserSnapshots = readBrowserSnapshots();
    const serverSnapshots = payload.snapshots || [];
    renderSnapshots([...browserSnapshots, ...serverSnapshots]);
  } catch (error) {
    const browserSnapshots = readBrowserSnapshots();
    if (browserSnapshots.length) renderSnapshots(browserSnapshots);
    else snapshotsEl.innerHTML = `<button type="button" disabled>${escapeHtml(error.message)}</button>`;
  }
}

function renderSnapshots(snapshots) {
  if (!snapshots.length) {
    snapshotsEl.innerHTML = "<button type=\"button\" disabled>No saved snapshots yet</button>";
    return;
  }

  snapshotsEl.innerHTML = snapshots
    .map((snapshot) => {
      const date = new Date(snapshot.createdAt);
      const label = Number.isNaN(date.valueOf()) ? snapshot.id : date.toLocaleString([], {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      return `<button type="button" data-snapshot="${escapeHtml(snapshot.id)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(snapshot.subtitle.replace(/^Date:\\s*/, ""))}</strong></button>`;
    })
    .join("");
}

async function loadSnapshot(id) {
  setStatus("Loading saved snapshot.");
  try {
    if (id.startsWith("browser-")) {
      const snapshot = JSON.parse(localStorage.getItem(browserSnapshotKey(id)) || "null");
      if (!snapshot) throw new Error("Browser snapshot not found.");
      currentMarkdown = snapshot.report;
      currentSnapshotId = snapshot.serverSnapshotId;
      currentNormalized = snapshot.normalized || null;
      renderReportView(currentMarkdown, currentNormalized, findLatestPriorSnapshot(collectBrowserSnapshots(), snapshot));
      setStatus(`Loaded browser snapshot ${id}.`);
      return;
    }

    const response = await fetch(`/api/market-view/snapshots/${encodeURIComponent(id)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load snapshot.");
    currentMarkdown = payload.report;
    currentSnapshotId = payload.id;
    currentNormalized = payload.normalized || null;
    renderReportView(currentMarkdown, currentNormalized);
    setStatus(`Loaded snapshot ${id}.`);
  } catch (error) {
    setStatus(error.message);
  }
}

async function copyReport() {
  if (!currentMarkdown) {
    setStatus("No report to copy yet.");
    return;
  }
  await navigator.clipboard.writeText(currentMarkdown);
  setStatus("Markdown copied.");
}

runButton.addEventListener("click", runWorkflow);
copyButton.addEventListener("click", copyReport);
snapshotsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-snapshot]");
  if (!button) return;
  loadSnapshot(button.dataset.snapshot);
});

fetch("/api/health")
  .then((response) => response.json())
  .then((health) => {
    if (!health.hasOpenRouterKey) {
      setStatus("OPENROUTER_API_KEY is missing. Add it to .env, then restart the server.");
    }
  })
  .catch(() => {
    setStatus("Could not check backend health.");
  });

loadSnapshots();
