import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { categoryFor } from "./parsers.js";

const PEAR_GATEWAY = "https://pro-gateway.pearprotocol.io";

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positionGroupLabel(legs, symbols) {
  const ticker = (leg) => symbols.get(String(leg.asset)) || `asset:${leg.asset}`;
  if (legs.length <= 4) return legs.map(ticker).join(" / ");
  const sideLabel = (side) => {
    const selected = legs.filter((leg) => leg.side === side);
    return selected.length === 1 ? ticker(selected[0]) : `${selected.length}-asset ${side.toLowerCase()} basket`;
  };
  return `${sideLabel("LONG")} / ${sideLabel("SHORT")}`;
}

export function pearVaultAddress(url) {
  const address = new URL(url).pathname.match(/^\/(0x[a-fA-F0-9]{40})\/?$/)?.[1];
  if (!address) throw new Error(`Invalid Pear vault URL: ${url}`);
  return address.toLowerCase();
}

export function parsePearVaultPositions(payload, instruments, prices) {
  if (!Array.isArray(payload?.positions) || !Array.isArray(instruments?.instruments) || !prices?.mark) {
    throw new Error("Incomplete Pear vault positions, instruments, or prices response");
  }
  const symbols = new Map(instruments.instruments
    .filter((instrument) => instrument.connector === "hyperliquid")
    .map((instrument) => [String(instrument.id), String(instrument.base).replace(/^xyz:/, "")]));

  return payload.positions.flatMap((position) => {
    if (position.status !== "OPEN" || !Array.isArray(position.legs)) return [];
    const activeLegs = position.legs.filter((leg) => numberOrNull(leg.remaining?.quantity) !== 0);
    if (!activeLegs.length) return [];
    const group = positionGroupLabel(position.legs, symbols);
    return position.legs.map((leg) => {
      const ticker = symbols.get(String(leg.asset)) || `asset:${leg.asset}`;
      const side = String(leg.side || "").toLowerCase();
      const quantity = numberOrNull(leg.remaining?.quantity);
      if (!["long", "short"].includes(side) || quantity === null) {
        throw new Error(`Invalid Pear vault leg in position ${position.positionId || "unknown"}`);
      }
      const entry = numberOrNull(leg.remaining?.entryVwap);
      const mark = numberOrNull(prices.mark[String(leg.asset)]);
      const open = quantity !== 0;
      return {
        position_group: group,
        position_group_id: position.positionId,
        asset_id: String(leg.asset),
        ticker,
        symbol: ticker,
        side,
        status: open ? "open" : "closed",
        active_qty: Math.abs(quantity),
        entry_vwap: entry,
        displayed_size_usd: open && mark !== null ? Math.abs(quantity * mark) : null,
        current_mark: open ? mark : null,
        current_upnl_usd: open && entry !== null && mark !== null
          ? (side === "long" ? 1 : -1) * Math.abs(quantity) * (mark - entry)
          : null,
        pnl_basis: "price_only_estimate_excludes_fees_funding",
        opened_at: position.openedAt || null,
        updated_at: position.updatedAt || null,
        source: "Pear Vault",
        category: categoryFor(ticker),
      };
    });
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Pear vault request failed: ${response.status} ${url}`);
  return response.json();
}

export async function collectPearVault(url, { outputDir } = {}) {
  const address = pearVaultAddress(url);
  const positions = [];
  let cursor;
  const seenCursors = new Set();
  for (let page = 0; page < 20; page += 1) {
    const endpoint = new URL(`${PEAR_GATEWAY}/vaults/${address}/positions/open`);
    endpoint.searchParams.set("limit", "200");
    if (cursor) endpoint.searchParams.set("cursor", cursor);
    const payload = await fetchJson(endpoint);
    if (!Array.isArray(payload.positions)) throw new Error("Pear vault returned no positions array");
    if (payload.vaultAddress && payload.vaultAddress.toLowerCase() !== address) {
      throw new Error("Pear vault response address does not match requested vault");
    }
    positions.push(...payload.positions);
    cursor = payload.nextCursor;
    if (!cursor) break;
    if (seenCursors.has(cursor)) throw new Error("Pear vault repeated a pagination cursor");
    seenCursors.add(cursor);
    if (page === 19) throw new Error("Pear vault positions exceeded 20 pages");
  }
  const [instruments, prices] = await Promise.all([
    fetchJson(`${PEAR_GATEWAY}/instruments?connector=hyperliquid`),
    fetchJson(`${PEAR_GATEWAY}/prices?connector=hyperliquid`),
  ]);
  const pairPositions = parsePearVaultPositions({ positions }, instruments, prices);
  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "pear-moritzpike-vault.json"), JSON.stringify({
      fetched_at: new Date().toISOString(),
      vault_address: address,
      positions,
      instruments: instruments.instruments.filter((instrument) =>
        positions.some((position) => position.legs?.some((leg) => String(leg.asset) === String(instrument.id)))),
      marks: Object.fromEntries(positions.flatMap((position) => position.legs || [])
        .map((leg) => [String(leg.asset), prices.mark[String(leg.asset)] ?? null])),
    }, null, 2));
  }
  return { pairPositions, positionCount: positions.filter((position) => position.status === "OPEN").length };
}
