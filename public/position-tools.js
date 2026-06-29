export function numericPositionSize(value) {
  const match = String(value ?? "").trim().match(/([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[-+]?\.\d+)(?:\s?([KMB])\b)?/i);
  if (!match) return null;

  const parsed = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return null;

  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return parsed * multiplier;
}

export function numericPositionValue(value) {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

export function positionKey(trader, position) {
  return [
    trader?.display_name || trader?.name || "",
    position?.source || trader?.source || "",
    position?.symbol || "",
    String(position?.side || "").toLowerCase(),
  ].join("||");
}

export function buildPositionSizeIndex(normalized) {
  const index = new Map();
  for (const trader of normalized?.traders || []) {
    for (const position of trader.positions || []) {
      const size = numericPositionSize(position.size);
      if (size === null) continue;
      index.set(positionKey(trader, position), Math.abs(size));
    }
  }
  return index;
}

export function deltaLabel(currentSizeValue, previousSize) {
  const currentSize = numericPositionSize(currentSizeValue);
  if (currentSize === null) return "-";
  if (!Number.isFinite(previousSize) || previousSize <= 0) return "New";

  const delta = ((Math.abs(currentSize) - previousSize) / previousSize) * 100;
  if (!Number.isFinite(delta)) return "New";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

export function deltaClass(label) {
  if (label === "New") return "delta-new";
  if (label.startsWith("+")) return "delta-up";
  if (label.startsWith("-")) return "delta-down";
  return "delta-flat";
}

export function findLatestPriorSnapshot(snapshots, currentSnapshot) {
  if (!currentSnapshot?.createdAt) return snapshots.find((snapshot) => snapshot?.normalized) || null;

  const currentTime = new Date(currentSnapshot.createdAt).getTime();
  return snapshots
    .filter((snapshot) => snapshot?.normalized && snapshot.id !== currentSnapshot.id)
    .filter((snapshot) => {
      const snapshotTime = new Date(snapshot.createdAt).getTime();
      return Number.isFinite(snapshotTime) && snapshotTime < currentTime;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

export function sortTableRowsByPositionValue(tbody, direction) {
  const rows = Array.from(tbody.querySelectorAll("tr"));
  const multiplier = direction === "desc" ? -1 : 1;
  rows
    .sort((a, b) => (Number(a.dataset.positionValue || 0) - Number(b.dataset.positionValue || 0)) * multiplier)
    .forEach((row) => tbody.appendChild(row));
}
