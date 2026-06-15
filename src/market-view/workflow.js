import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { DEFAULT_INPUT, DEFAULT_MODEL, marketViewRunDir } from "../config.js";
import { captureCoinsenseImage, captureHyperdashTrendImages } from "./assets.js";
import { buildComputedInput } from "./compute.js";
import { collectMarketViewInput } from "./collectors.js";
import { callOpenRouter, fallbackAnalysis } from "./llm.js";
import { renderReport } from "./report.js";

export async function generateMarketViewReport({
  inputPath = DEFAULT_INPUT,
  inputData = null,
  live = false,
  model = DEFAULT_MODEL,
  outputDir = null,
  coinsenseImage = true,
  embedImages = false,
} = {}) {
  const resolvedOutputDir = resolve(outputDir || marketViewRunDir());
  await mkdir(resolvedOutputDir, { recursive: true });
  const rawInput = inputData || (live
    ? await collectMarketViewInput({ outputDir: resolvedOutputDir })
    : JSON.parse(await readFile(resolve(inputPath), "utf8")));
  const input = buildComputedInput(rawInput);
  if (coinsenseImage) {
    input.coinsense.chart_image = await captureCoinsenseImage(resolvedOutputDir, {
      embedImage: embedImages,
      screenshotUrl: input.coinsense_screenshot_url,
    });
  }
  const hyperdashTrendMap = await captureHyperdashTrendImages(
    resolvedOutputDir,
    input.hyperdash_screenshot_url,
    { embedImages },
  );
  input.hyperdash_cohorts = (input.hyperdash_cohorts || []).map((cohort) => ({
    ...cohort,
    trend_image: hyperdashTrendMap.has(cohort.slug)
      ? { path: hyperdashTrendMap.get(cohort.slug), source: "Hyperdash screenshot crop" }
      : null,
  }));
  await writeFile(join(resolvedOutputDir, "normalized-input.json"), JSON.stringify(input, null, 2));

  let result;
  try {
    result = await callOpenRouter({ model, input });
    await writeFile(join(resolvedOutputDir, "openrouter-response.json"), JSON.stringify(result.raw, null, 2));
  } catch (error) {
    result = {
      raw: { fallback: true, error: error.message },
      parsed: fallbackAnalysis(input, error.message),
    };
    await writeFile(join(resolvedOutputDir, "openrouter-error.txt"), error.message);
  }
  await writeFile(join(resolvedOutputDir, "analysis.json"), JSON.stringify(result.parsed, null, 2));

  const report = renderReport(input, result.parsed, model);
  await writeFile(join(resolvedOutputDir, "report.md"), report);
  return {
    model,
    snapshotId: basename(resolvedOutputDir),
    outputDir: resolvedOutputDir,
    report,
    normalized: input,
    analysis: result.parsed,
  };
}
