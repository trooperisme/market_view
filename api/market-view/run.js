import { join } from "node:path";
import { generateMarketViewReport } from "../../scripts/generate-market-view-report-openrouter.js";

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  return await new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) reject(new Error("Request body too large."));
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is missing in Vercel environment variables.");
    }

    const body = await readJsonBody(req);
    const outputDir = join("/tmp", "market-view", `web-${timestamp()}`);
    const result = await generateMarketViewReport({
      live: true,
      model: body.model || DEFAULT_MODEL,
      outputDir,
      coinsenseImage: true,
      embedImages: true,
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
