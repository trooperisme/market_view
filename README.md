# Market View

Market View is a crypto trader pre-market workflow that turns normalized trader, vault, and cohort data into a structured market context report.

The workflow is designed as:

```text
Firecrawl source capture
-> deterministic parsers
-> normalized JSON
-> exposure math and bias labels
-> short NVIDIA NIM market summary with a data-only fallback
-> markdown report
```

The implementation keeps adapters thin:

- `src/market-view/` contains collection, parsing, computation, LLM, assets, report rendering, snapshots, and workflow orchestration.
- `scripts/` contains CLI entrypoints only.
- `api/` contains Vercel handlers.
- `local-server.js` contains local HTTP routing only.

## Setup

Create `.env` from the example:

```bash
cp .env.example .env
```

Set:

```env
FIRECRAWL_API_KEY=your_key_here
NVIDIA_API_KEY=your_nvidia_key_here
NVIDIA_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
NVIDIA_BACKUP_MODELS=z-ai/glm-5.3-flash,z-ai/glm-5.3
MARKET_VIEW_USER=admin
MARKET_VIEW_PASSWORD=your_password_here
CRON_SECRET=random_secret_for_the_daily_market_view_job
```

The production deployment registers a Vercel Cron job at `00:00 UTC` (07:00
GMT+7) for `/api/market-view/daily`. It performs a fresh scan with open-limit
orders enabled, deduplicates completed scheduled snapshots per Vietnam date,
and marks the run failed if persistence cannot be confirmed.

## Run

```bash
npm run market-view:llm-test
```

Run with live Firecrawl collection:

```bash
npm run market-view:llm-test -- --live
```

Run the web app locally:

```bash
npm run dev
```

The primary NVIDIA model is selected in server configuration. If it is unavailable, Market View tries one randomly selected NVIDIA backup, then produces a short data-based summary.

Use a specific NVIDIA model for a one-off CLI run:

```bash
npm run market-view:llm-test -- --model nvidia/nemotron-3.5-lightning-30b-a3b
```

The generated report is printed to stdout and saved under:

```text
runs/market-view/nvidia-run-.../report.md
```

## Output

The report includes:

- a short overall read and up to three key points
- the three largest positions for each trader

## Vercel

The Vercel deployment uses `public/` for the frontend and `api/` serverless functions for the workflow button.

Required Vercel environment variables:

```env
FIRECRAWL_API_KEY=your_key_here
NVIDIA_API_KEY=your_nvidia_key_here
NVIDIA_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
NVIDIA_BACKUP_MODELS=z-ai/glm-5.3-flash,z-ai/glm-5.3
MARKET_VIEW_USER=admin
MARKET_VIEW_PASSWORD=your_password_here
```

The browser UI keeps recent snapshots in localStorage for quick review.

## CoinRotator market trends

The Market View dashboard reads the public CoinRotator Market Health page and its BTC analysis data through `/api/market-trends`. The endpoint extracts daily UP/DOWN/HODL breadth history and BTC/USD daily and weekly direction with streak lengths. It rejects incomplete or older than 36-hour source readings and caches a successful result in memory for one hour. No separate API key or CEX SMW endpoint is required.
