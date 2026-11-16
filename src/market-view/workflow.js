import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { DEFAULT_INPUT, DEFAULT_MODEL, marketViewRunDir } from "../config.js";
import { buildComputedInput } from "./compute.js";
import { collectMarketViewInput } from "./collectors.js";
import { callNvidia, fallbackAnalysis } from "./llm.js";
import { renderReport } from "./report.js";

export async function generateMarketViewReport({
  inputPath = DEFAULT_INPUT,
  inputData = null,
  live = false,
  model = DEFAULT_MODEL,
  outputDir = null,
  includeOpenOrders = true,
  sourceConcurrency = 5,
  scrapeMaxAttempts = 4,
  llmTimeoutMs,
  llmBackupTimeoutMs,
} = {}) {
  const resolvedOutputDir = resolve(outputDir || marketViewRunDir());
  await mkdir(resolvedOutputDir, { recursive: true });
  const rawInput = inputData || (live
    ? await collectMarketViewInput({
      outputDir: resolvedOutputDir,
      includeOpenOrders,
      sourceConcurrency,
      scrapeMaxAttempts,
    })
    : JSON.parse(await readFile(resolve(inputPath), "utf8")));
  const input = buildComputedInput(rawInput);
  await writeFile(join(resolvedOutputDir, "normalized-input.json"), JSON.stringify(input, null, 2));

  let result;
  let summaryFallback = false;
  try {
    result = await callNvidia({ model, input, timeoutMs: llmTimeoutMs, backupTimeoutMs: llmBackupTimeoutMs });
    model = result.model;
    await writeFile(join(resolvedOutputDir, "nvidia-response.json"), JSON.stringify(result.raw, null, 2));
  } catch (error) {
    summaryFallback = true;
    result = {
      raw: { fallback: true, error: error.message },
      parsed: fallbackAnalysis(input, error.message),
    };
    await writeFile(join(resolvedOutputDir, "nvidia-error.txt"), error.message);
  }
  await writeFile(join(resolvedOutputDir, "analysis.json"), JSON.stringify(result.parsed, null, 2));

  const report = renderReport(input, result.parsed);
  await writeFile(join(resolvedOutputDir, "report.md"), report);
  return {
    model,
    snapshotId: basename(resolvedOutputDir),
    outputDir: resolvedOutputDir,
    report,
    normalized: input,
    analysis: result.parsed,
    summaryFallback,
  };
}
