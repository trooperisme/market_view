function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function groupOpenLegs(positions = []) {
  const groups = new Map();
  for (const leg of positions) {
    if (leg.status !== "open") continue;
    const key = leg.position_group_id || leg.position_group;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(leg);
  }
  return groups;
}

function pairDelta(currentLegs, previousLegs, hasBaseline) {
  if (!hasBaseline) return { label: "—", kind: "unavailable" };
  if (!previousLegs?.length) return { label: "New", kind: "new" };
  const currentMarks = new Map(currentLegs.map((leg) => [`${leg.asset_id}:${leg.side}`, finiteNumber(leg.current_mark)]));
  if (previousLegs.some((leg) => !currentMarks.has(`${leg.asset_id}:${leg.side}`))) {
    return { label: "Changed legs", kind: "changed" };
  }
  const current = currentLegs.reduce((sum, leg) => {
    const quantity = finiteNumber(leg.active_qty);
    const mark = finiteNumber(leg.current_mark);
    return sum + (quantity === null || mark === null ? NaN : Math.abs(quantity * mark));
  }, 0);
  const previousAtCurrentMarks = previousLegs.reduce((sum, leg) => {
    const quantity = finiteNumber(leg.active_qty);
    const mark = currentMarks.get(`${leg.asset_id}:${leg.side}`);
    return sum + (quantity === null || mark === null ? NaN : Math.abs(quantity * mark));
  }, 0);
  if (!Number.isFinite(current) || !Number.isFinite(previousAtCurrentMarks)) {
    return { label: "—", kind: "unavailable" };
  }
  if (!previousAtCurrentMarks) return { label: "New", kind: "new" };
  const percent = (current / previousAtCurrentMarks - 1) * 100;
  if (Math.abs(percent) < 0.05) return { label: "0.0%", kind: "flat" };
  return { label: `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`, kind: percent > 0 ? "up" : "down" };
}

export function buildPearPositionRows(trader, previousTrader = null) {
  const current = groupOpenLegs(trader?.pair_positions);
  const previous = groupOpenLegs(previousTrader?.pair_positions);
  const hasBaseline = Boolean(previousTrader && previousTrader.name === trader?.name
    && previousTrader.pair_source_url === trader?.pair_source_url
    && previousTrader.pair_positions_status === "available");
  return [...current].map(([id, legs]) => {
    const values = legs.map((leg) => finiteNumber(leg.displayed_size_usd));
    const notional = values.every((value) => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;
    return {
      id,
      label: legs[0].position_group || "Pair",
      legs,
      notional,
      delta: pairDelta(legs, previous.get(id), hasBaseline),
    };
  }).sort((a, b) => (b.notional ?? -1) - (a.notional ?? -1));
}

const usd = (value, decimals = 0) => value === null || !Number.isFinite(value)
  ? "—"
  : `$${value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

function price(value) {
  const number = finiteNumber(value);
  if (number === null) return "—";
  return `$${number.toLocaleString("en-US", { maximumFractionDigits: number < 1 ? 8 : 5 })}`;
}

function sideBadge(legs, side) {
  const selected = legs.filter((leg) => leg.side === side);
  if (!selected.length) return null;
  const badge = document.createElement("span");
  badge.className = `pear-side-badge pear-side-${side}`;
  badge.textContent = selected.length === 1
    ? selected[0].ticker
    : `${selected[0].ticker} +${selected.length - 1}`;
  badge.title = `${side.toUpperCase()}: ${selected.map((leg) => leg.ticker).join(", ")}`;
  return badge;
}

function renderLeg(leg, gross) {
  const card = document.createElement("div");
  card.className = `pear-leg pear-leg-${leg.side}`;
  const header = document.createElement("div");
  header.className = "pear-leg-header";
  const name = document.createElement("strong");
  name.textContent = `${leg.side.toUpperCase()} ${leg.ticker}`;
  const size = document.createElement("span");
  const notional = finiteNumber(leg.displayed_size_usd);
  size.textContent = `${usd(notional)}${notional !== null && gross ? ` · ${Math.round(notional / gross * 100)}%` : ""}`;
  header.append(name, size);
  const entry = document.createElement("div");
  entry.className = "pear-leg-prices";
  entry.textContent = `Entry ${price(leg.entry_vwap)} · Mark ${price(leg.current_mark)}`;
  const pnl = document.createElement("div");
  pnl.className = "pear-leg-pnl";
  const pnlValue = finiteNumber(leg.current_upnl_usd);
  pnl.textContent = `Price PnL est. ${pnlValue === null ? "—" : `${pnlValue < 0 ? "-" : "+"}${usd(Math.abs(pnlValue), 2)}`}`;
  if (pnlValue !== null) pnl.classList.add(pnlValue < 0 ? "pear-loss" : "pear-profit");
  card.append(header, entry, pnl);
  return card;
}

function renderPosition(row) {
  const details = document.createElement("details");
  details.className = "pear-position";
  const summary = document.createElement("summary");
  const pair = document.createElement("span");
  pair.className = "pear-pair-badges";
  const long = sideBadge(row.legs, "long");
  const short = sideBadge(row.legs, "short");
  if (long) pair.appendChild(long);
  if (short) pair.appendChild(short);
  const notional = document.createElement("strong");
  notional.className = "pear-position-notional";
  notional.textContent = usd(row.notional);
  const delta = document.createElement("span");
  delta.className = `pear-position-delta pear-delta-${row.delta.kind}`;
  delta.textContent = row.delta.label;
  delta.title = "Change in leg quantities versus the previous snapshot, valued at current marks. Price moves are excluded. New means this position ID was absent before.";
  summary.append(pair, notional, delta);
  const expanded = document.createElement("div");
  expanded.className = "pear-position-expanded";
  const legs = document.createElement("div");
  legs.className = "pear-leg-grid";
  row.legs.forEach((leg) => legs.appendChild(renderLeg(leg, row.notional)));
  const note = document.createElement("p");
  note.className = "pear-position-note";
  note.textContent = "Price PnL is an estimate; it excludes fees, funding and realized PnL.";
  expanded.append(legs, note);
  details.append(summary, expanded);
  return details;
}

export function renderPearVaultPositions(normalized, comparisonNormalized, reportEl) {
  const trader = normalized?.traders?.find((item) => item.name === "moritzpike vault");
  if (!trader) return;
  const prior = comparisonNormalized?.traders?.find((item) => item.name === trader.name) || null;
  const heading = [...reportEl.querySelectorAll("h3")]
    .find((item) => item.textContent.trim().replace(/^\d+\.\s*/, "") === trader.display_name);
  if (!heading) return;
  let details = heading.nextElementSibling;
  while (details && details.tagName !== "H3" && details.tagName !== "H2" && !details.classList.contains("trader-position-details")) {
    details = details.nextElementSibling;
  }
  if (!details?.classList.contains("trader-position-details")) return;

  const rows = buildPearPositionRows(trader, prior);
  details.classList.add("pear-vault-positions");
  const summary = document.createElement("summary");
  summary.textContent = `Open positions (${rows.length})`;
  const content = document.createElement("div");
  content.className = "pear-vault-content";
  const deltaNote = document.createElement("p");
  deltaNote.className = "pear-delta-note";
  deltaNote.textContent = "Size Δ vs previous snapshot · price moves excluded";
  const header = document.createElement("div");
  header.className = "pear-position-list-header";
  const pairLabel = document.createElement("span");
  pairLabel.textContent = "Pair";
  const sort = document.createElement("button");
  sort.type = "button";
  sort.className = "pear-notional-sort";
  sort.textContent = "Notional ↓";
  sort.setAttribute("aria-label", "Sort vault positions by notional, largest first");
  const deltaLabel = document.createElement("span");
  deltaLabel.textContent = "Size Δ";
  deltaLabel.title = "Change in leg quantities versus the previous snapshot, valued at current marks.";
  header.append(pairLabel, sort, deltaLabel);
  const list = document.createElement("div");
  list.className = "pear-position-list";
  const positionNodes = new Map(rows.map((row) => [row.id, renderPosition(row)]));
  const arrange = (direction) => {
    const ordered = direction === "desc" ? rows : [...rows].reverse();
    ordered.forEach((row) => list.appendChild(positionNodes.get(row.id)));
    sort.textContent = `Notional ${direction === "desc" ? "↓" : "↑"}`;
    sort.setAttribute("aria-label", `Sort vault positions by notional, ${direction === "desc" ? "largest" : "smallest"} first`);
  };
  let direction = "desc";
  sort.addEventListener("click", () => { direction = direction === "desc" ? "asc" : "desc"; arrange(direction); });
  arrange(direction);
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.textContent = trader.pair_positions_status === "unavailable"
      ? "Vault positions could not be confirmed."
      : "No open vault positions.";
    list.appendChild(empty);
  }
  content.append(deltaNote, header, list);
  details.replaceChildren(summary, content);
  details.open = true;
}
