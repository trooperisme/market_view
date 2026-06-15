import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { PNG } from "pngjs";
import { COINSENSE_VAULT_URL, FIRECRAWL_API_URL, HYPERDASH_TREND_LAYOUT } from "../config.js";

const execFileAsync = promisify(execFile);

export function cropPng(buffer, crop) {
  const source = PNG.sync.read(buffer);
  const x = Math.max(0, Math.min(source.width - 1, crop.x));
  const y = Math.max(0, Math.min(source.height - 1, crop.y));
  const width = Math.max(1, Math.min(source.width - x, crop.width));
  const height = Math.max(1, Math.min(source.height - y, crop.height));
  const target = new PNG({ width, height });

  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * source.width + x) * 4;
    const sourceEnd = sourceStart + width * 4;
    const targetStart = row * width * 4;
    source.data.copy(target.data, targetStart, sourceStart, sourceEnd);
  }

  return PNG.sync.write(target);
}

export function cropCoinsenseVaultSummary(buffer) {
  const source = PNG.sync.read(buffer);
  const crop = {
    x: Math.round(source.width * 0.118),
    y: Math.round(source.height * 0.245),
    width: Math.round(source.width * 0.858),
    height: Math.round(source.height * 0.47),
  };

  return cropPng(buffer, crop);
}

async function scrapeCoinsenseScreenshot(scrapeOutputPath) {
  if (process.env.FIRECRAWL_API_KEY) {
    const response = await fetch(`${FIRECRAWL_API_URL}/v2/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: COINSENSE_VAULT_URL,
        formats: ["markdown", "screenshot"],
        waitFor: 7000,
        maxAge: 0,
      }),
    });
    const body = await response.json();
    await writeFile(scrapeOutputPath, JSON.stringify(body, null, 2));
    if (!response.ok) throw new Error(`Firecrawl API scrape failed: ${response.status} ${JSON.stringify(body)}`);
    return body.screenshot || body.data?.screenshot;
  }

  await execFileAsync("firecrawl", [
    "scrape",
    COINSENSE_VAULT_URL,
    "--format",
    "markdown,screenshot",
    "--wait-for",
    "7000",
    "--pretty",
    "--max-age",
    "0",
    "-o",
    scrapeOutputPath,
  ], {
    cwd: process.cwd(),
    maxBuffer: 25 * 1024 * 1024,
    env: process.env,
  });

  const scrape = JSON.parse(await readFile(scrapeOutputPath, "utf8"));
  return scrape.screenshot || scrape.data?.screenshot;
}

export async function captureCoinsenseImage(outputDir, { embedImage = false, screenshotUrl = null } = {}) {
  const assetsDir = join(outputDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  const scrapeOutputPath = join(outputDir, "coinsense-screenshot-scrape.json");

  try {
    const sourceScreenshotUrl = screenshotUrl || await scrapeCoinsenseScreenshot(scrapeOutputPath);
    if (!sourceScreenshotUrl) throw new Error("Firecrawl scrape returned no screenshot URL.");
    const response = await fetch(sourceScreenshotUrl);
    if (!response.ok) throw new Error(`Screenshot download failed: ${response.status}`);
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const croppedImageBuffer = cropCoinsenseVaultSummary(imageBuffer);
    await writeFile(join(assetsDir, "coinsense-vault.png"), croppedImageBuffer);
    return {
      path: embedImage ? `data:image/png;base64,${croppedImageBuffer.toString("base64")}` : "assets/coinsense-vault.png",
      source: COINSENSE_VAULT_URL,
      status: "ok",
    };
  } catch (error) {
    await writeFile(join(outputDir, "coinsense-image-error.txt"), error.message);
    return {
      path: null,
      source: COINSENSE_VAULT_URL,
      status: "unavailable",
      error: error.message,
    };
  }
}

export function cropHyperdashTrendImages(buffer) {
  const source = PNG.sync.read(buffer);
  const scaleX = source.width / 1920;
  const scaleY = source.height / 1080;

  return HYPERDASH_TREND_LAYOUT.map((item) => ({
    slug: item.slug,
    image: cropPng(buffer, {
      x: Math.round(item.x * scaleX),
      y: Math.round(item.y * scaleY),
      width: Math.round(item.width * scaleX),
      height: Math.round(item.height * scaleY),
    }),
  }));
}

export async function captureHyperdashTrendImages(outputDir, screenshotUrl, { embedImages = false } = {}) {
  if (!screenshotUrl) return new Map();

  const assetsDir = join(outputDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  try {
    const response = await fetch(screenshotUrl);
    if (!response.ok) throw new Error(`Hyperdash screenshot download failed: ${response.status}`);
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const crops = cropHyperdashTrendImages(imageBuffer);
    const trendMap = new Map();

    for (const crop of crops) {
      const fileName = `hyperdash-trend-${crop.slug}.png`;
      await writeFile(join(assetsDir, fileName), crop.image);
      trendMap.set(crop.slug, embedImages
        ? `data:image/png;base64,${crop.image.toString("base64")}`
        : `assets/${fileName}`);
    }

    return trendMap;
  } catch (error) {
    await writeFile(join(outputDir, "hyperdash-trend-error.txt"), error.message);
    return new Map();
  }
}
