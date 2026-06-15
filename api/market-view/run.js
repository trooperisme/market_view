import { join } from "node:path";
import { generateMarketViewReport } from "../../src/market-view/workflow.js";
import { requireApiAuth } from "../../lib/auth.js";
import { DEFAULT_MODEL } from "../../src/config.js";
import { readVercelJsonBody } from "../../src/http.js";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireApiAuth(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is missing in Vercel environment variables.");
    }

    const body = await readVercelJsonBody(req);
    const outputDir = join("/tmp", "market-view", `web-${timestamp()}`);
    const result = await generateMarketViewReport({
      live: true,
      model: body.model || DEFAULT_MODEL,
      outputDir,
      coinsenseImage: true,
      embedImages: true,
    });

    return res.status(200).json({
      model: result.model,
      snapshotId: result.snapshotId,
      report: result.report,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
