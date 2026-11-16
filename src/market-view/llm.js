import {
  DEFAULT_MODEL,
  NVIDIA_API_URL,
  NVIDIA_BACKUP_MODELS,
  NVIDIA_BACKUP_TIMEOUT_MS,
  NVIDIA_TIMEOUT_MS,
} from "../config.js";
import { numericValue, pct } from "./format.js";
import { fallbackHyperdashConclusion } from "./report.js";

function compactPromptInput(input) {
  const topPositions = (positions = [], limit = 5) => [...positions]
    .sort((a, b) => numericValue(b.position_value_usd) - numericValue(a.position_value_usd))
    .slice(0, limit)
    .map((position) => ({
      name: position.instrument || position.coin || position.symbol,
      direction: position.side,
      value_usd: numericValue(position.position_value_usd),
      pnl: position.unrealized_pnl || undefined,
      category: position.category,
    }));

  const traders = input.traders || [];
  const long = traders.reduce((sum, trader) => sum + numericValue(trader.long_exposure), 0);
  const short = traders.reduce((sum, trader) => sum + numericValue(trader.short_exposure), 0);
  const total = long + short;
  const leadingPositions = topPositions(traders.flatMap((trader) => trader.positions || []), 5);
  const macroPositions = topPositions(traders.flatMap((trader) => trader.positions || []).filter((position) => position.category === "macro"), 2);
  const entityPositioning = traders.map((trader) => {
    const traderLong = numericValue(trader.long_exposure);
    const traderShort = numericValue(trader.short_exposure);
    const traderTotal = traderLong + traderShort;
    return {
      name: trader.display_name || trader.name,
      long_percent: traderTotal ? Number(((traderLong / traderTotal) * 100).toFixed(1)) : 0,
      short_percent: traderTotal ? Number(((traderShort / traderTotal) * 100).toFixed(1)) : 0,
      gross_exposure_usd: Number(traderTotal.toFixed(2)),
      top_positions: topPositions(trader.positions || [], 2),
    };
  });

  return {
    tracked_positioning: {
      long_percent: total ? Number(((long / total) * 100).toFixed(1)) : 0,
      short_percent: total ? Number(((short / total) * 100).toFixed(1)) : 0,
      trader_count: traders.length,
      leading_positions: leadingPositions,
      macro_positions: macroPositions,
      entity_positioning: entityPositioning,
    },
    hyperdash_cohorts: (input.hyperdash_cohorts || []).map((cohort) => ({
      cohort: cohort.cohort || cohort.slug,
      long: cohort.long,
      short: cohort.short,
    })),
    profitable_vs_unprofitable: input.hyperdash_comparison,
  };
}

export function buildPrompt(input) {
  const promptInput = compactPromptInput(input);
  return `
You are writing concise market-view commentary for a crypto trader.

Use only the provided JSON. Do not invent unavailable data. Write for a smart trader who wants a quick, plain-language market read.
Separate observed positioning from interpretation. Keep the answer short enough to scan in a few seconds.

Return strict JSON only with this schema:
{
  "overall_summary": "two or three short sentences describing how the tracked entities are positioned as a group, the clearest consensus or disagreement, and the main caveat",
  "hyperdash_summary": "one short sentence explaining the profitable-versus-loss-making cohort split and the resulting UP/DOWN read",
  "key_points": ["up to 3 short, distinct, evidence-based bullets"]
}

Rules:
- State the overall long/short tilt only as a read of tracked positions, not the whole market.
- Summarize the entity positioning as a group; mention the clearest consensus, concentration, or disagreement when supported.
- Mention profitable/unprofitable cohorts only when they materially confirm or contradict the entity positioning.
- Mention a leading position or macro exposure only when it helps explain the group read.
- Rewrite the Hyperdash cohort split in one short sentence. Keep the profitable-versus-loss-making contrast and directional read; omit formulas, thresholds, and repeated cohort labels.
- Never mention exchanges, websites, scraping, wallet addresses, model names, or raw source labels.
- Avoid jargon and never turn a positioning snapshot into a price prediction.
- Do not write markdown in JSON values.

INPUT JSON:
${JSON.stringify(promptInput)}
`.trim();
}

export function describeLargestPositions(trader, limit = 3) {
  const positions = [...(trader.positions || [])]
    .sort((a, b) => numericValue(b.position_value_usd) - numericValue(a.position_value_usd))
    .slice(0, limit);
  if (!positions.length) return "no active positions";
  return positions.map((position) => `${position.instrument || position.coin || position.symbol} ${position.side}`).join(", ");
}

function describeEntityPositioning(traders) {
  const positioned = traders.filter((trader) => numericValue(trader.long_exposure) + numericValue(trader.short_exposure) > 0);
  if (!positioned.length) return "Tracked entities have no usable active-position data.";

  const longEntities = positioned.filter((trader) => Number(trader.long_pct) >= 60).length;
  const shortEntities = positioned.filter((trader) => Number(trader.short_pct) >= 60).length;
  const mixedEntities = positioned.length - longEntities - shortEntities;
  const consensus = longEntities > shortEntities
    ? `${longEntities} of ${positioned.length} tracked entities lean long`
    : shortEntities > longEntities
      ? `${shortEntities} of ${positioned.length} tracked entities lean short`
      : `${longEntities} of ${positioned.length} tracked entities lean long and ${shortEntities} lean short`;
  const mixed = mixedEntities ? `; ${mixedEntities} are mixed` : "";
  return `${consensus}${mixed}.`;
}

export function fallbackAnalysis(input) {
  const totals = (input.traders || []).reduce((sum, trader) => ({
    long: sum.long + numericValue(trader.long_exposure),
    short: sum.short + numericValue(trader.short_exposure),
  }), { long: 0, short: 0 });
  const total = totals.long + totals.short;
  const longPct = total ? (totals.long / total) * 100 : 0;
  const shortPct = total ? (totals.short / total) * 100 : 0;
  const tilt = longPct >= 60 ? "long" : shortPct >= 60 ? "short" : "mixed";

  return {
    overall_summary: total
      ? `${describeEntityPositioning(input.traders || [])} Aggregate tracked exposure leans ${tilt}: ${pct(longPct)} long versus ${pct(shortPct)} short. This is a positioning snapshot, not a market-wide direction.`
      : "There is not enough current position data to form a broad market read.",
    hyperdash_summary: input.hyperdash_comparison
      ? fallbackHyperdashConclusion(input.hyperdash_comparison)
      : "Hyperdash cohort data is unavailable for this snapshot.",
    key_points: [
      `Largest tracked positions: ${describeLargestPositions({ positions: (input.traders || []).flatMap((trader) => trader.positions || []) }, 3)}.`,
      (input.traders || []).flatMap((trader) => trader.positions || []).some((position) => position.category === "macro")
        ? `Macro exposure: ${describeLargestPositions({ positions: (input.traders || []).flatMap((trader) => trader.positions || []).filter((position) => position.category === "macro") }, 2)}.`
        : null,
      input.hyperdash_comparison ? fallbackHyperdashConclusion(input.hyperdash_comparison) : null,
    ].filter(Boolean).slice(0, 3),
  };
}

export function stripJsonFence(text) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

async function requestModel({ apiKey, model, input, timeoutMs }) {
  const modelOptions = model.startsWith("nvidia/")
    ? { reasoning_budget: 0, chat_template_kwargs: { enable_thinking: false } }
    : {};
  const response = await fetch(`${NVIDIA_API_URL}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: buildPrompt(input) }],
      max_tokens: 350,
      temperature: 0.1,
      ...modelOptions,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`NVIDIA model request failed (${response.status}): ${body.detail || body.error?.message || "request rejected"}`);
  }
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("NVIDIA model returned no summary text.");

  const parsed = JSON.parse(stripJsonFence(content));
  if (typeof parsed.overall_summary !== "string" || typeof parsed.hyperdash_summary !== "string" || !Array.isArray(parsed.key_points)) {
    throw new Error("NVIDIA model response did not include the required summary fields.");
  }
  return { raw: body, parsed, model };
}

export async function callNvidia({ model = DEFAULT_MODEL, input, timeoutMs = NVIDIA_TIMEOUT_MS, backupTimeoutMs = NVIDIA_BACKUP_TIMEOUT_MS }) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("NVIDIA_API_KEY is not set.");

  const backups = shuffled(NVIDIA_BACKUP_MODELS.filter((backup) => backup !== model));
  const candidates = [
    { model, timeoutMs },
    ...backups.slice(0, 1).map((backup) => ({ model: backup, timeoutMs: backupTimeoutMs })),
  ];
  const errors = [];

  for (const candidate of candidates) {
    try {
      return await requestModel({ apiKey, input, ...candidate });
    } catch (error) {
      errors.push(`${candidate.model}: ${error.message}`);
      if (/\(401\)|\(403\)/.test(error.message)) break;
    }
  }

  throw new Error(errors.join("; ") || "No NVIDIA models are configured.");
}
