import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { PNG } from "pngjs";
import { FIRECRAWL_API_URL, HYPERDASH_TREND_LAYOUT } from "../config.js";

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
