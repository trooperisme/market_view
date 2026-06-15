import { OPENROUTER_TIMEOUT_MS } from "../config.js";
import { numericValue, pct } from "./format.js";
import { fallbackHyperdashConclusion } from "./report.js";

export function buildPrompt(input) {
  return `
You are writing concise market-view commentary for a crypto trader.

Use only the provided JSON. Do not invent unavailable data. Keep language direct and actionable.

Return strict JSON only with this schema:
{
  "quick_reads": [
    { "trader": "exact display_name", "text": "1-2 sentence quick read" }
  ],
  "final_analysis": {
    "hyperdash_cohort_conclusion": "2-3 sentence comparison of profitable vs unprofitable cohorts",
    "crypto_signals": ["2-4 concise bullets"],
    "macro_signals": ["2-4 concise bullets"],
    "coinsense_summary": ["1-2 concise bullets"]
  }
}

Rules:
- Every trader in input.traders must have one quick read.
- Mention directional bias with arrows where natural: bullish ↑, bearish ↓, neutral →, mixed →.
- Distinguish crypto positioning from macro/commodity positioning.
- For CoinSense, emphasize the largest position and overall long/short ratio.
- For Hyperdash, compare profitable cohorts versus unprofitable cohorts using input.hyperdash_comparison.
- Do not write markdown in JSON values.

INPUT JSON:
${JSON.stringify(input, null, 2)}
`.trim();
}

export function describeLargestPositions(trader, limit = 3) {
  const positions = [...(trader.positions || [])]
    .sort((a, b) => numericValue(b.position_value_usd) - numericValue(a.position_value_usd))
    .slice(0, limit);
  if (!positions.length) return "no active positions";
  return positions.map((position) => `${position.symbol} ${position.side}`).join(", ");
}

export function fallbackAnalysis(input, reason = "OpenRouter unavailable") {
  const quickReads = (input.traders || []).map((trader) => ({
    trader: trader.display_name,
    text: `${trader.bias}; ${pct(trader.long_pct)} long versus ${pct(trader.short_pct)} short. Largest exposure: ${describeLargestPositions(trader)}.`,
  }));
  const coinsensePositions = input.coinsense?.positions || [];
  const largestCoinsense = coinsensePositions[0]
    ? `${coinsensePositions[0].coin} ${coinsensePositions[0].side} (${coinsensePositions[0].position_value})`
    : "no active CoinSense position";

  return {
    quick_reads: quickReads,
    final_analysis: {
      hyperdash_cohort_conclusion: fallbackHyperdashConclusion(input.hyperdash_comparison),
      crypto_signals: [
        `Fallback analysis used because ${reason}.`,
        "Read the trader tables directly for the highest-confidence signal.",
      ],
      macro_signals: [
        "Macro signal is derived from positions tagged as commodity or macro symbols in the trader tables.",
      ],
      coinsense_summary: [
        `CoinSense ratio: ${input.coinsense?.longs_ratio || "Unavailable"} long versus ${input.coinsense?.shorts_ratio || "Unavailable"} short.`,
        `Largest listed CoinSense position: ${largestCoinsense}.`,
      ],
    },
  };
}

export function stripJsonFence(text) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

export async function callOpenRouter({ model, input }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to your shell environment or .env runtime.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost",
      "X-Title": "Crypto Workflow Market View Test",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: buildPrompt(input),
        },
      ],
      temperature: 0.2,
    }),
  }).finally(() => clearTimeout(timeout));

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`OpenRouter request failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`OpenRouter returned no message content: ${JSON.stringify(body)}`);
  }

  return {
    raw: body,
    parsed: JSON.parse(stripJsonFence(content)),
  };
}
