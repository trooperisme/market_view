export function numericValue(value) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

export function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function pct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

export function sideArrow(side) {
  if (side === "long") return "↑";
  if (side === "short") return "↓";
  return "→";
}

export function sideLabel(side) {
  const normalized = String(side || "").toLowerCase();
  if (normalized === "long") return "Long ↑";
  if (normalized === "short") return "Short ↓";
  return "Unknown →";
}
