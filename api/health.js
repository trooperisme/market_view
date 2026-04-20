const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    model: DEFAULT_MODEL,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    hasFirecrawlKey: Boolean(process.env.FIRECRAWL_API_KEY),
    runtime: "vercel",
  });
}
