import { requireApiAuth } from "../lib/auth.js";
import { getMarketTrends } from "../src/market-trends.js";

export default async function handler(req, res) {
  if (!requireApiAuth(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.status(200).json(await getMarketTrends());
  } catch (error) {
    return res.status(503).json({ error: error.message || "Market trends unavailable" });
  }
}
