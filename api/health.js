import { requireApiAuth } from "../lib/auth.js";

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireApiAuth(req, res)) return;

  res.status(200).json({
    ok: true,
    model: DEFAULT_MODEL,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    hasFirecrawlKey: Boolean(process.env.FIRECRAWL_API_KEY),
    runtime: "vercel",
  });
}
