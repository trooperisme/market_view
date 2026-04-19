# Market View

Market View is a crypto trader pre-market workflow that turns normalized trader, vault, and cohort data into a structured market context report.

The workflow is designed as:

```text
Firecrawl source capture
-> deterministic parsers
-> normalized JSON
-> exposure math and bias labels
-> OpenRouter LLM quick reads and final synthesis
-> markdown report
```

This repository currently contains the report-generation test path with mock normalized input. The next production step is replacing `fixtures/market-view/mock-input.json` with live Firecrawl collector output.

## Setup

Create `.env` from the example:

```bash
cp .env.example .env
```

Set:

```env
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openai/gpt-oss-120b:free
```

## Run

```bash
npm run market-view:llm-test
```

Use a specific model:

```bash
npm run market-view:llm-test -- --model openai/gpt-4o
```

The generated report is printed to stdout and saved under:

```text
runs/market-view/openrouter-test-.../report.md
```

## Output

The report includes:

- per-trader position tables
- total long and short exposure
- directional arrows: bullish `↑`, bearish `↓`, neutral or mixed `→`
- per-trader quick reads
- CoinSense vault monitor section
- Hyperdash cohort sentiment table
- final crypto, macro, and vault synthesis
