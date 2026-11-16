import {
  buildPositionSizeIndex,
  deltaClass,
  deltaLabel,
  findLatestPriorSnapshot,
  numericPositionValue,
  sortTableRowsByPositionValue,
} from "./position-tools.js";
import { ensureHyperdashDirectionalRead } from "./cohort-render.js";

const runButton = document.querySelector("#run");
const copyButton = document.querySelector("#copy");
const statusLine = document.querySelector("#status");
const reportEl = document.querySelector("#report");
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

function browserSnapshotMatchesServer(snapshot, serverIds) {
  return serverIds.has(snapshot.serverSnapshotId) || serverIds.has(snapshot.id.replace(/^browser-/, ""));
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
  const reportWithCohortRead = ensureHyperdashDirectionalRead(markdown, normalized);
  currentMarkdown = reportWithCohortRead;
  reportEl.innerHTML = renderMarkdown(reportWithCohortRead);
  highlightImportantHyperdashCohorts(normalized);
  collapsePositionDetails();
  renderTraderPositionMixes(normalized);
  enhanceOpenOrderTables();
  enhanceTraderPositionTables(normalized, comparisonSnapshot?.normalized || null);
}

function highlightImportantHyperdashCohorts(normalized) {
  const table = Array.from(reportEl.querySelectorAll("table"))
    .find((element) => Array.from(element.querySelectorAll("thead th")).some((cell) => cell.textContent.trim() === "Cohort"));
  const cohorts = normalized?.hyperdash_cohorts || [];
  if (!table || !cohorts.length) return;

  table.classList.add("cohort-table");
  const ordered = [...cohorts]
    .sort((a, b) => Number(b.values_available) - Number(a.values_available) || b.net_share_pct - a.net_share_pct);
  Array.from(table.querySelectorAll("tbody tr")).forEach((row, index) => {
    const cohort = ordered[index];
    if (!cohort?.is_significant) return;
    row.classList.add("cohort-significant", `cohort-significant-${cohort.direction}`);
    if (cohort.is_extreme) row.classList.add("cohort-extreme", `cohort-extreme-${cohort.direction}`);
    const strength = cohort.is_extreme ? "extreme" : "significant";
    row.setAttribute("aria-label", `${cohort.cohort}: ${strength} ${cohort.direction} positioning, ${cohort.net_share_pct}% net share`);
  });
}

function collapseTraderSection({ headingText, statsPrefix, summaryLabel, detailsClass }) {
  const heading = Array.from(reportEl.querySelectorAll("h2"))
    .find((element) => element.textContent.trim() === headingText);
  if (!heading) return;

  const traderHeadings = [];
  for (let node = heading.nextElementSibling; node && node.tagName !== "H2"; node = node.nextElementSibling) {
    if (node.tagName === "H3") traderHeadings.push(node);
  }

  for (const traderHeading of traderHeadings) {
    let accountStats = traderHeading.nextElementSibling;
    if (accountStats?.tagName !== "P" || !accountStats.textContent.startsWith(statsPrefix)) accountStats = null;
    accountStats?.classList.add("account-stats");

    let firstPositionNode = accountStats ? accountStats.nextSibling : traderHeading.nextSibling;
    let endNode = firstPositionNode;
    const tables = [];
    while (endNode && !(endNode.nodeType === Node.ELEMENT_NODE && endNode.tagName === "H3")) {
      if (endNode.nodeType === Node.ELEMENT_NODE && endNode.tagName === "TABLE") tables.push(endNode);
      endNode = endNode.nextSibling;
    }
    if (!tables.length) continue;

    const details = document.createElement("details");
    details.className = `position-details ${detailsClass}`;
    const summary = document.createElement("summary");
    summary.textContent = summaryLabel(tables);
    details.appendChild(summary);

    let node = firstPositionNode;
    while (node && node !== endNode) {
      const next = node.nextSibling;
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "TABLE") {
        const scrollContainer = document.createElement("div");
        scrollContainer.className = "table-scroll";
        scrollContainer.appendChild(node);
        details.appendChild(scrollContainer);
      } else {
        details.appendChild(node);
      }
      node = next;
    }
    traderHeading.parentNode.insertBefore(details, endNode);
  }
}

function collapsePositionDetails() {
  collapseTraderSection({
    headingText: "Largest positions by trader",
    statsPrefix: "Account stats:",
    summaryLabel: (tables) => {
      const positionTable = tables.find((table) => Array.from(table.querySelectorAll("thead th"))
        .some((cell) => ["Position Value", "Mkt Val"].includes(cell.textContent.trim())));
      const orderTable = tables.find((table) => Array.from(table.querySelectorAll("thead th"))
        .every((cell) => ["Token", "Side", "Price", "Value", "Size"].includes(cell.textContent.trim())));
      const parts = [];
      if (positionTable) {
        const count = positionTable.querySelectorAll("tbody tr").length;
        parts.push(`${count} position${count === 1 ? "" : "s"}`);
      }
      if (orderTable) {
        const count = orderTable.querySelectorAll("tbody tr").length;
        parts.push(`${count} open order group${count === 1 ? "" : "s"}`);
      }
      return `View ${parts.join(" · ") || "entity activity"}`;
    },
    detailsClass: "trader-position-details",
  });
}

function traderPositionMix(trader) {
  const positions = trader?.positions || [];
  const longExposure = Number.isFinite(Number(trader?.long_exposure))
    ? Number(trader.long_exposure)
    : positions.filter((position) => position.side === "long")
      .reduce((sum, position) => sum + numericPositionValue(position.position_value_usd), 0);
  const shortExposure = Number.isFinite(Number(trader?.short_exposure))
    ? Number(trader.short_exposure)
    : positions.filter((position) => position.side === "short")
      .reduce((sum, position) => sum + numericPositionValue(position.position_value_usd), 0);
  const total = longExposure + shortExposure;
  if (!total) return null;
  const longPct = (longExposure / total) * 100;
  const shortPct = (shortExposure / total) * 100;
  return { longPct, shortPct };
}

function createTraderPositionMix(trader) {
  const visual = document.createElement("div");
  visual.className = "trader-position-mix";
  const mix = traderPositionMix(trader);
  if (!mix) {
    visual.classList.add("trader-position-mix-unavailable");
    visual.textContent = "Position mix unavailable — no active positions.";
    return visual;
  }

  const header = document.createElement("div");
  header.className = "trader-position-mix-header";
  const label = document.createElement("span");
  label.textContent = "Position mix";
  const values = document.createElement("strong");
  values.textContent = `Long ${mix.longPct.toFixed(1)}% · Short ${mix.shortPct.toFixed(1)}%`;
  header.append(label, values);

  const bar = document.createElement("div");
  bar.className = "trader-position-bar";
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", `Long ${mix.longPct.toFixed(1)}%, Short ${mix.shortPct.toFixed(1)}%`);
  const long = document.createElement("span");
  long.className = "trader-position-bar-long";
  long.style.flexBasis = `${mix.longPct}%`;
  const short = document.createElement("span");
  short.className = "trader-position-bar-short";
  short.style.flexBasis = `${mix.shortPct}%`;
  bar.append(long, short);

  visual.append(header, bar);
  return visual;
}

function renderTraderPositionMixes(normalized) {
  const traders = normalized?.traders || [];
  if (!traders.length) return;
  const section = Array.from(reportEl.querySelectorAll("h2"))
    .find((element) => element.textContent.trim() === "Largest positions by trader");
  if (!section) return;
  const headings = [];
  for (let node = section.nextElementSibling; node && node.tagName !== "H2"; node = node.nextElementSibling) {
    if (node.tagName === "H3") headings.push(node);
  }

  headings.forEach((heading, index) => {
    const trader = traders[index];
    if (!trader) return;
    let anchor = heading.nextElementSibling;
    if (anchor?.classList.contains("account-stats")) anchor = anchor.nextElementSibling;

    for (let node = heading.nextElementSibling; node && node.tagName !== "H2" && node.tagName !== "H3"; node = node.nextElementSibling) {
      if (node.tagName === "P" && node.textContent.trim().startsWith("Position mix:")) node.remove();
      if (node.classList?.contains("trader-position-details")) {
        node.querySelectorAll("p").forEach((paragraph) => {
          if (paragraph.textContent.trim().startsWith("Position mix:")) paragraph.remove();
        });
      }
    }

    anchor = heading.nextElementSibling;
    if (anchor?.classList.contains("account-stats")) anchor = anchor.nextElementSibling;

    const visual = createTraderPositionMix(trader);
    heading.parentNode.insertBefore(visual, anchor);
  });
}

function enhanceOpenOrderTables() {
  const tables = Array.from(reportEl.querySelectorAll("table"))
    .filter((table) => Array.from(table.querySelectorAll("thead th"))
      .map((cell) => cell.textContent.trim())
      .join("|") === "Token|Side|Price|Value|Size");

  for (const table of tables) {
    table.classList.add("open-order-table");
    for (const row of table.querySelectorAll("tbody tr")) {
      const sideCell = row.cells[1];
      const side = sideCell?.textContent.trim().toLowerCase();
      if (side === "buy" || side === "sell") {
        sideCell.classList.add(`open-order-side-${side}`);
      }

      const token = row.cells[0]?.textContent || "";
      if (!/\(\d+ orders?\)/i.test(token)) continue;
      const sizeCell = row.cells[4];
      if (!sizeCell) continue;
      sizeCell.classList.add("open-order-size");
      const chevron = document.createElement("span");
      chevron.className = "open-order-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "⌄";
      sizeCell.appendChild(chevron);
    }
  }
}

function optionAssetTicker(position, row) {
  return String(position?.symbol || row?.cells?.[0]?.textContent?.split(/\s+/)[0] || "Other")
    .trim()
    .toUpperCase();
}

function addOptionMarketValueSort(table) {
  const headerCells = Array.from(table.querySelectorAll("thead th"));
  const positionValueIndex = headerCells.findIndex((cell) => cell.textContent.trim() === "Mkt Val");
  if (positionValueIndex === -1) return;

  const sortButton = document.createElement("button");
  sortButton.type = "button";
  sortButton.className = "table-sort-button";
  sortButton.dataset.sortDirection = "none";
  sortButton.innerHTML = "<span>Mkt Val</span><span class=\"sort-caret\" aria-hidden=\"true\">↕</span>";
  sortButton.setAttribute("aria-label", "Sort option contracts by market value");
  headerCells[positionValueIndex].textContent = "";
  headerCells[positionValueIndex].appendChild(sortButton);

  sortButton.addEventListener("click", () => {
    const nextDirection = sortButton.dataset.sortDirection === "asc" ? "desc" : "asc";
    sortButton.dataset.sortDirection = nextDirection;
    sortButton.querySelector(".sort-caret").textContent = nextDirection === "asc" ? "↑" : "↓";
    sortTableRowsByPositionValue(table.querySelector("tbody"), nextDirection);
  });
}

function groupOptionTableByAsset(table, orderedPositions) {
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  const groups = new Map();

  rows.forEach((row, rowIndex) => {
    const position = orderedPositions[rowIndex];
    row.dataset.positionValue = String(numericPositionValue(position?.position_value_usd));
    const ticker = optionAssetTicker(position, row);
    if (!groups.has(ticker)) groups.set(ticker, []);
    groups.get(ticker).push(row);
  });

  const assetGroups = document.createElement("div");
  assetGroups.className = "option-asset-groups";

  for (const [ticker, assetRows] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const details = document.createElement("details");
    details.className = "option-asset-details";

    const summary = document.createElement("summary");
    summary.textContent = ticker;
    summary.setAttribute("aria-label", `${ticker}, ${assetRows.length} option contract${assetRows.length === 1 ? "" : "s"}`);
    details.appendChild(summary);

    const scrollContainer = document.createElement("div");
    scrollContainer.className = "table-scroll option-contract-scroll";
    const assetTable = table.cloneNode(false);
    assetTable.classList.add("option-contract-table");
    assetTable.appendChild(table.tHead.cloneNode(true));
    const tbody = document.createElement("tbody");
    assetRows.forEach((row) => tbody.appendChild(row));
    assetTable.appendChild(tbody);
    addOptionMarketValueSort(assetTable);
    scrollContainer.appendChild(assetTable);
    details.appendChild(scrollContainer);
    assetGroups.appendChild(details);
  }

  const tableContainer = table.closest(".table-scroll");
  if (tableContainer) tableContainer.replaceWith(assetGroups);
}

function enhanceTraderPositionTables(normalized, comparisonNormalized) {
  const traders = normalized?.traders || [];
  if (!traders.length) return;

  const previousSizes = comparisonNormalized ? buildPositionSizeIndex(comparisonNormalized) : null;
  const tables = Array.from(reportEl.querySelectorAll("table"))
    .filter((table) => Array.from(table.querySelectorAll("thead th"))
      .some((cell) => ["Position Value", "Mkt Val"].includes(cell.textContent.trim())));
  let tableIndex = 0;

  for (const trader of traders) {
    const positions = trader.positions || [];
    if (!positions.length) continue;

    const orderedPositions = [...positions]
      .sort((a, b) => Number(b.position_value_usd || 0) - Number(a.position_value_usd || 0));

    const table = tables[tableIndex];
    tableIndex += 1;
    if (!table) continue;

    const headerCells = Array.from(table.querySelectorAll("thead th"));
    const isOptionTable = positions.some((position) => position.instrument_type === "option");
    if (isOptionTable) {
      table.classList.add("position-table");
      groupOptionTableByAsset(table, orderedPositions);
      continue;
    }

    const positionValueIndex = headerCells.findIndex((cell) => cell.textContent.trim() === "Position Value");
    if (positionValueIndex === -1) continue;

    table.classList.add("position-table");
    const deltaHeader = document.createElement("th");
    deltaHeader.textContent = "Position Δ %";
    deltaHeader.title = "Percent change in absolute position size versus the previous snapshot. Formula: (current size − previous size) ÷ previous size. This is not Options Greek delta. New = no matching prior position; — = no comparison baseline or usable size.";
    deltaHeader.setAttribute("aria-label", deltaHeader.title);
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
      const position = orderedPositions[rowIndex];
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
      row.appendChild(deltaCell);
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
  reportEl.innerHTML = "<p class=\"empty-state\">Putting together the latest read…</p>";
  setStatus("Refreshing the market read…");

  try {
    const previousBrowserSnapshot = collectBrowserSnapshots()
      .find((snapshot) => snapshot.normalized?.hyperdash_cohorts?.length) || null;
    const response = await fetch("/api/market-view/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Workflow failed.");

    currentMarkdown = payload.report;
    currentSnapshotId = payload.snapshotId;
    currentNormalized = payload.normalized || null;
    const comparisonSnapshot = payload.comparisonSnapshot || previousBrowserSnapshot;
    renderReportView(currentMarkdown, currentNormalized, comparisonSnapshot);
    saveBrowserSnapshot(payload);
    setStatus(payload.summaryFallback
      ? "Updated. AI summary is unavailable, so this read is based on the position data."
      : "Updated. Your market read is ready.");
    await loadSnapshots();
  } catch (error) {
    currentMarkdown = "";
    currentSnapshotId = null;
    currentNormalized = null;
    reportEl.innerHTML = "<p class=\"empty-state\">This read could not be refreshed. Try again in a moment.</p>";
    setStatus("Couldn't refresh the market read.");
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
    const serverIds = new Set(serverSnapshots.map((snapshot) => snapshot.id));
    const snapshots = [
      ...serverSnapshots,
      ...browserSnapshots.filter((snapshot) => !browserSnapshotMatchesServer(snapshot, serverIds)),
    ];
    renderSnapshots(snapshots);
    if (!currentMarkdown && snapshots.length) await loadSnapshot(snapshots[0].id);
  } catch (error) {
    const browserSnapshots = readBrowserSnapshots();
    if (browserSnapshots.length) {
      renderSnapshots(browserSnapshots);
      if (!currentMarkdown) await loadSnapshot(browserSnapshots[0].id);
    }
    else snapshotsEl.innerHTML = "<button type=\"button\" disabled>Past reads are unavailable</button>";
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
    renderReportView(currentMarkdown, currentNormalized, payload.comparisonSnapshot || null);
    setStatus(`Loaded snapshot ${id}.`);
  } catch (error) {
    setStatus("Couldn't load that past read.");
  }
}

async function copyReport() {
  if (!currentMarkdown) {
    setStatus("No report to copy yet.");
    return;
  }
  await navigator.clipboard.writeText(currentMarkdown);
  setStatus("Market read copied.");
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
    if (!health.hasNvidiaKey) {
      setStatus("AI commentary is offline. A data-based read is still available.");
    }
  })
  .catch(() => {
    setStatus("Could not check backend health.");
  });

loadSnapshots();
