const SNAPSHOTS_TABLE = "market_view_snapshots";
const POSITIONS_TABLE = "market_view_positions";

export function normalizeSupabaseUrl(value = process.env.SUPABASE_URL) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^[a-z0-9-]+$/i.test(trimmed)) return `https://${trimmed}.supabase.co`;
  return trimmed;
}

export function isSupabaseSnapshotStoreConfigured() {
  const url = normalizeSupabaseUrl();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const validUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url);
  let hasServiceRole = false;
  if (key.startsWith("sb_secret_")) {
    hasServiceRole = key.length >= 32 && !/placeholder|your[_-]?key|replace[_-]?me/i.test(key);
  } else if (key.startsWith("eyJ") && key.length >= 100 && key.split(".").length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      hasServiceRole = payload.role === "service_role";
    } catch {
      hasServiceRole = false;
    }
  }
  return validUrl && hasServiceRole;
}

function reportSubtitle(report, fallback) {
  return String(report || "").split(/\r?\n/).find((line) => line.startsWith("Date:")) || fallback;
}

function reportTitle(report) {
  return String(report || "").split(/\r?\n/).find((line) => line.startsWith("# "))?.replace(/^#\s+/, "") || "Market View Snapshot";
}

export function snapshotQuality(normalized) {
  const errors = normalized?.source_errors || [];
  const criticalErrors = errors.filter((error) => !String(error.source || "").endsWith("-orders"));
  return {
    status: criticalErrors.length ? "incomplete" : errors.length ? "partial-orders" : "complete",
    sourceErrors: errors.length,
    criticalSourceErrors: criticalErrors.length,
  };
}

function normalizeSnapshot(row, { includeNormalized = true } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    title: row.title || "Market View Snapshot",
    subtitle: row.subtitle || row.created_at,
    model: row.model || null,
    source: row.source || null,
    report: row.report || "",
    normalized: includeNormalized ? row.normalized || null : null,
    quality: snapshotQuality(row.normalized),
    storage: "supabase",
    localRunSnapshotId: row.local_run_snapshot_id || null,
  };
}

function parseNumeric(value) {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function numericPositionSize(value) {
  const match = String(value ?? "").trim().match(/([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[-+]?\.\d+)(?:\s?([KMB])\b)?/i);
  if (!match) return null;

  const parsed = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return null;

  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return parsed * multiplier;
}

function flattenPositions(snapshotId, normalized) {
  const rows = [];
  for (const trader of normalized?.traders || []) {
    const positions = [
      ...(trader.positions || []),
      ...(trader.pair_positions || []).map((position) => ({
        symbol: position.ticker || position.symbol,
        side: position.side,
        size: position.active_qty,
        position_value_usd: position.displayed_size_usd,
        entry: position.entry_vwap,
        unrealized_pnl: position.current_upnl_usd,
        source: position.source || "Pear Protocol",
        category: position.category,
      })),
    ];
    for (const position of positions) {
      rows.push({
        snapshot_id: snapshotId,
        trader: trader.display_name || trader.name || "",
        source: position.source || trader.source || "",
        symbol: position.symbol || "",
        side: String(position.side || "").toLowerCase(),
        size_text: position.size == null ? null : String(position.size),
        size_numeric: numericPositionSize(position.size),
        position_value_usd: parseNumeric(position.position_value_usd),
        entry_text: position.entry == null ? null : String(position.entry),
        unrealized_pnl_text: position.unrealized_pnl == null ? null : String(position.unrealized_pnl),
        leverage: position.leverage == null ? null : String(position.leverage),
        category: position.category == null ? null : String(position.category),
      });
    }
  }
  return rows;
}

async function supabaseRequest(path, { method = "GET", body, headers = {} } = {}) {
  const baseUrl = normalizeSupabaseUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase snapshot store is not configured.");

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText;
    throw new Error(`Supabase ${method} ${path.split("?")[0]} failed (${response.status}): ${message}`);
  }

  return payload;
}

export async function listMarketViewSnapshots({ limit = 20 } = {}) {
  const params = new URLSearchParams({
    select: "id,created_at,title,subtitle,model,source,normalized,local_run_snapshot_id",
    order: "created_at.desc",
    limit: String(limit),
  });
  const rows = await supabaseRequest(`${SNAPSHOTS_TABLE}?${params}`);
  return rows
    .map((row) => normalizeSnapshot(row, { includeNormalized: false }))
    .filter((snapshot) => snapshot.quality.status !== "incomplete");
}

export async function readLatestMarketViewSnapshot({ before, after, source } = {}) {
  const params = new URLSearchParams({
    select: "id,created_at,title,subtitle,model,source,report,normalized,local_run_snapshot_id",
    order: "created_at.desc",
    limit: "20",
  });
  if (before) params.set("created_at", `lt.${before}`);
  if (after) params.set("created_at", `gte.${after}`);
  if (source) params.set("source", `eq.${encodeURIComponent(source)}`);

  const rows = await supabaseRequest(`${SNAPSHOTS_TABLE}?${params}`);
  return rows
    .map((row) => normalizeSnapshot(row))
    .find((snapshot) => snapshot.quality.status !== "incomplete") || null;
}

export async function readMarketViewSnapshot(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid Supabase snapshot id.");
  const params = new URLSearchParams({
    select: "id,created_at,title,subtitle,model,source,report,normalized,local_run_snapshot_id",
    id: `eq.${id}`,
    limit: "1",
  });
  const rows = await supabaseRequest(`${SNAPSHOTS_TABLE}?${params}`);
  return normalizeSnapshot(rows[0]);
}

export async function saveMarketViewSnapshot({ model, report, normalized, localRunSnapshotId, source = "live" }) {
  const now = new Date().toISOString();
  const [row] = await supabaseRequest(SNAPSHOTS_TABLE, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: [{
      model,
      report,
      normalized,
      source,
      title: reportTitle(report),
      subtitle: reportSubtitle(report, now),
      local_run_snapshot_id: localRunSnapshotId || null,
    }],
  });
  const snapshot = normalizeSnapshot(row);
  const positions = flattenPositions(snapshot.id, normalized);

  if (positions.length) {
    await supabaseRequest(POSITIONS_TABLE, {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: positions,
    });
  }

  return snapshot;
}
