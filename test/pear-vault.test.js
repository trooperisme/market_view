import test from "node:test";
import assert from "node:assert/strict";
import { parsePearVaultAllocation } from "../src/market-view/pear-vault.js";
import { buildPearPositionRows } from "../public/pear-vault-view.js";
import { computeTrader } from "../src/market-view/compute.js";
import { renderReport } from "../src/market-view/report.js";

function vault(legs, { id = "pair-1", allocation = null } = {}) {
  return {
    name: "moritzpike vault",
    display_name: "moritzpike vault",
    pair_source_url: "https://vaults.pear.garden/0x69f2ed780a4cec49e552dbcd35a60f41368bc362",
    pair_positions_status: "available",
    positions: [],
    pair_positions: legs.map((leg) => ({ position_group: "BTC / MSTR", position_group_id: id, status: "open", ...leg })),
    vault_allocation: allocation,
  };
}

test("uses vault agent allocation for the visible ratio without adding pair legs to market exposure", () => {
  const allocation = parsePearVaultAllocation({ assetPositions: [
    { position: { szi: "2", positionValue: "152645.05" } },
    { position: { szi: "-4", positionValue: "117720.05" } },
  ] });
  assert.equal(allocation.total_usd, 270365.1);
  assert.equal(Math.round(allocation.long_pct), 56);
  assert.equal(Math.round(allocation.short_pct), 44);
  const trader = computeTrader(vault([
    { asset_id: "0", ticker: "BTC", side: "long", active_qty: 1, current_mark: 100, displayed_size_usd: 100 },
    { asset_id: "1", ticker: "MSTR", side: "short", active_qty: 1, current_mark: 100, displayed_size_usd: 100 },
  ], { allocation }));
  assert.equal(trader.long_exposure, 0);
  assert.equal(trader.short_exposure, 0);
  const report = renderReport({ traders: [trader], hyperdash_cohorts: [] }, { overall_summary: "" });
  assert.match(report, /Position mix: Long 56\.5% · Short 43\.5%/);
  assert.match(report, /\| Long \| Short \| Gross notional \|/);
  assert.doesNotMatch(report, /\| Position Group \| Ticker \| Side \| Status \| Active Qty \|/);
});

test("sorts Moritzpike pairs by gross notional and compares leg quantities at current marks", () => {
  const previous = vault([
    { asset_id: "0", ticker: "BTC", side: "long", active_qty: 10, current_mark: 50, displayed_size_usd: 500 },
    { asset_id: "1", ticker: "MSTR", side: "short", active_qty: 10, current_mark: 50, displayed_size_usd: 500 },
  ]);
  const current = vault([
    { asset_id: "0", ticker: "BTC", side: "long", active_qty: 15, current_mark: 100, displayed_size_usd: 1500 },
    { asset_id: "1", ticker: "MSTR", side: "short", active_qty: 10, current_mark: 100, displayed_size_usd: 1000 },
    { asset_id: "2", ticker: "HYPE", side: "long", active_qty: 10, current_mark: 10, displayed_size_usd: 100, position_group_id: "new-pair", position_group: "HYPE / ADA" },
  ]);
  const rows = buildPearPositionRows(current, previous);
  assert.deepEqual(rows.map((row) => row.id), ["pair-1", "new-pair"]);
  assert.equal(rows[0].notional, 2500);
  assert.equal(rows[0].delta.label, "+25.0%");
  assert.equal(rows[1].delta.label, "New");
  assert.equal(buildPearPositionRows(current)[0].delta.label, "—");
});

test("labels an altered basket when a previous leg cannot be valued at the current mark", () => {
  const previous = vault([{ asset_id: "1", ticker: "ADA", side: "short", active_qty: 10, current_mark: 1, displayed_size_usd: 10 }]);
  const current = vault([{ asset_id: "2", ticker: "XRP", side: "short", active_qty: 10, current_mark: 1, displayed_size_usd: 10 }]);
  assert.equal(buildPearPositionRows(current, previous)[0].delta.label, "Changed legs");
});
