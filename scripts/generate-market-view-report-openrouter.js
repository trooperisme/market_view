#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_INPUT, DEFAULT_MODEL } from "../src/config.js";
import { loadEnvFile } from "../src/env.js";
import { generateMarketViewReport } from "../src/market-view/workflow.js";

await loadEnvFile(resolve(".env"));

function usage() {
  return `
Usage:
  npm run market-view:llm-test
  npm run market-view:llm-test -- --live
  npm run market-view:llm-test -- --input fixtures/market-view/mock-input.json
  npm run market-view:llm-test -- --model nvidia/nemotron-3-ultra-550b-a55b:free

Environment:
  FIRECRAWL_API_KEY is required for live collection unless the local Firecrawl CLI is authenticated.
  OPENROUTER_API_KEY must be set.
  OPENROUTER_MODEL is optional. Default: ${DEFAULT_MODEL}
`.trim();
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    model: DEFAULT_MODEL,
    outputDir: null,
    coinsenseImage: true,
    live: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--input") args.input = argv[++i];
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--output-dir") args.outputDir = argv[++i];
    else if (arg === "--no-coinsense-image") args.coinsenseImage = false;
    else if (arg === "--live") args.live = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const result = await generateMarketViewReport({
    inputPath: args.input,
    model: args.model,
    outputDir: args.outputDir,
    coinsenseImage: args.coinsenseImage,
    live: args.live,
  });
  console.log(result.report);
  console.error(`Saved report artifacts: ${result.outputDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { generateMarketViewReport };
