// Editorial prototype built from the saved Market View snapshot captured on 22 Sep 2026.
// Source: runs/market-view/nvidia-run-2026-09-22T07-49-27-475Z/live-input.json
// This page makes no API calls and hides tracked profile identities.

const snapshot = {
  capturedAt: "22 Sep 2026, 07:53 UTC",
  freshness: "Fresh collection requested",
  sourceErrors: 0,
  trackedProfiles: 11,
  activeProfiles: 9,
  nonOptionPositions: 48,
  signal: "UP",
  confidence: "Medium",
};

const cohortGroups = [
  {
    key: "profitable",
    label: "Profitable cohorts",
    longPct: 75.1,
    shortPct: 24.9,
    net: "+$3.88B net long",
    netShare: "+50.1% net share",
    read: "Strong long lean",
  },
  {
    key: "loss",
    label: "Loss-making cohorts",
    longPct: 40.9,
    shortPct: 59.1,
    net: "-$748.21M net short",
    netShare: "-18.3% net share",
    read: "Moderate short lean",
  },
];

const cohortDetails = {
  profitable: [
    { label: "Extremely profitable", long: "$3.54B", short: "$1.09B", net: "+$2.45B", share: "52.9%", strength: "Extreme long" },
    { label: "Very profitable", long: "$1.29B", short: "$514.48M", net: "+$779.33M", share: "43.1%", strength: "Extreme long" },
    { label: "Profitable", long: "$976.46M", short: "$324.65M", net: "+$651.81M", share: "50.1%", strength: "Extreme long" },
  ],
  loss: [
    { label: "Unprofitable", long: "$488.18M", short: "$509.95M", net: "-$21.77M", share: "2.2%", strength: "Small short" },
    { label: "Very unprofitable", long: "$387.88M", short: "$521.80M", net: "-$133.92M", share: "14.7%", strength: "Small short" },
    { label: "Rekt", long: "$796.55M", short: "$1.39B", net: "-$592.52M", share: "27.1%", strength: "Significant short" },
  ],
};

const exposures = [
  { asset: "ETH", long: 1232797.05, short: 0, profiles: 5, display: "$1.23M long" },
  { asset: "BTC", long: 550632.47, short: 128286.22, profiles: 4, display: "$550.6K long / $128.3K short" },
  { asset: "HYPE", long: 426066.11, short: 0, profiles: 2, display: "$426.1K long" },
  { asset: "NEAR", long: 335877.82, short: 0, profiles: 2, display: "$335.9K long" },
  { asset: "XRP", long: 332102.71, short: 0, profiles: 1, display: "$332.1K long" },
  { asset: "PONS", long: 0, short: 278925.56, profiles: 1, display: "$278.9K short" },
  { asset: "ZEC", long: 99540.18, short: 99719.9, profiles: 3, display: "Roughly balanced" },
];

const tradfi = [
  { asset: "BB", value: "$275.4K", side: "Long" },
  { asset: "NVDA", value: "$105.8K", side: "Long" },
  { asset: "INTC", value: "$72.9K", side: "Long" },
  { asset: "JPY", value: "$56.6K", side: "Long" },
  { asset: "AAPL", value: "$54.8K", side: "Long" },
  { asset: "GOOGL", value: "$50.0K", side: "Long" },
  { asset: "SOXL", value: "$38.8K", side: "Long" },
  { asset: "GOLD", value: "$25.9K", side: "Long" },
];

const optionHighlights = [
  { instrument: "BTC $96K Call", expiry: "30 Oct", value: "$5,585.66", pnl: "+$3,732.66" },
  { instrument: "HYPE $74 Call", expiry: "25 Sep", value: "$3,068.45", pnl: "+$2,963.94" },
  { instrument: "HYPE $75 Call", expiry: "25 Sep", value: "$1,946.96", pnl: "+$1,883.96" },
];

const thesisDrafts = {
  long: {
    label: "Lean long",
    title: "Follow the profitable cohort split.",
    body: "Profitable cohorts are 75.1% long, loss-making cohorts are 59.1% short, and the tracked book is 88.9% long. ETH is the broadest shared exposure across five tracked profiles.",
    invalidation: "Reassess if profitable net share falls below 25% or ETH participation narrows sharply.",
  },
  neutral: {
    label: "Stay neutral",
    title: "Wait for the conflict to resolve.",
    body: "The cohort heuristic points UP, but a $700.41K BTC sell ladder remains pending. These sources describe different populations and cannot be merged into one score.",
    invalidation: "Take a directional view only when the next snapshot shows the same cohort split with broader participation or a clear reversal.",
  },
  short: {
    label: "Conditional short",
    title: "Short only after the strong cohort weakens.",
    body: "The current data does not support a primary short thesis. A short setup begins if profitable cohorts lose their long edge while pending sell intent remains defensive.",
    invalidation: "Abandon the short if profitable net share stays above 25% and the tracked long book broadens beyond its current concentration.",
  },
};

function formatCells(longPct) {
  const longCells = Math.round(longPct / 5);
  return Array.from({ length: 20 }, (_, index) => `<span class="sentiment-cell ${index < longCells ? "is-long" : "is-short"}"></span>`).join("");
}

function sentimentRow(group) {
  return `<div class="sentiment-row"><div class="sentiment-label"><strong>${group.label}</strong><span>${group.read}</span></div><div class="sentiment-cells" aria-label="${group.longPct}% long and ${group.shortPct}% short">${formatCells(group.longPct)}</div><div class="sentiment-numbers"><strong>${group.longPct}% long</strong><span>${group.shortPct}% short</span></div></div>`;
}

function cohortColumn(group, rows) {
  return `<section class="cohort-column cohort-${group}"><header><h3>${group === "profitable" ? "Profitable cohorts" : "Loss-making cohorts"}</h3><span>${group === "profitable" ? "Leaning long" : "Leaning short"}</span></header><div class="cohort-rows">${rows.map((row) => `<article class="cohort-detail"><div><strong>${row.label}</strong><small>${row.strength}</small></div><dl><div><dt>Long</dt><dd>${row.long}</dd></div><div><dt>Short</dt><dd>${row.short}</dd></div><div><dt>Net</dt><dd>${row.net}</dd></div><div><dt>Net share</dt><dd>${row.share}</dd></div></dl></article>`).join("")}</div></section>`;
}

function exposureRow(item) {
  const max = 1232797.05;
  const longWidth = Math.max(0, (item.long / max) * 100).toFixed(1);
  const shortWidth = Math.max(0, (item.short / max) * 100).toFixed(1);
  return `<article class="exposure-row"><div class="exposure-name"><strong>${item.asset}</strong><span>${item.profiles} tracked ${item.profiles === 1 ? "profile" : "profiles"}</span></div><div class="diverging-bars"><div class="short-zone"><span class="short-bar" style="--bar:${shortWidth}%"></span></div><div class="long-zone"><span class="long-bar" style="--bar:${longWidth}%"></span></div></div><div class="exposure-value">${item.display}</div></article>`;
}

function thesisMarkup(choice = "long") {
  const draft = thesisDrafts[choice];
  return `<div class="thesis-output"><span class="thesis-read">${draft.label}</span><h3>${draft.title}</h3><p>${draft.body}</p><div class="invalidation"><strong>What changes the view</strong><p>${draft.invalidation}</p></div></div>`;
}

function render() {
  document.querySelector("#app").innerHTML = `
    <header class="site-header">
      <a class="brand" href="#top">Market View</a>
      <nav aria-label="Article navigation">
        <a href="#cohorts">Cohorts</a>
        <a href="#exposure">Exposure</a>
        <a href="#counterpoint">Counterpoint</a>
        <a href="#thesis">Build a thesis</a>
      </nav>
      <div class="snapshot-time">${snapshot.capturedAt}</div>
    </header>

    <main id="top">
      <section class="hero">
        <div class="hero-copy">
          <p class="hero-label">Current positioning read</p>
          <h1>Profitable cohorts lean long.</h1>
          <p class="hero-dek">Loss-making cohorts lean short. The current split points UP with medium confidence.</p>
          <div class="hero-verdict"><span>${snapshot.signal}</span><strong>${snapshot.confidence} confidence</strong><small>Current cohort table</small></div>
        </div>
        <div class="sentiment-figure">
          <div class="figure-head"><h2>Positioning split</h2><span>Long / short exposure</span></div>
          ${cohortGroups.map(sentimentRow).join("")}
          <p class="figure-note">The groups are compared separately. Their dollars are not added into one market score.</p>
        </div>
      </section>

      <div class="article-layout">
        <aside class="article-index">
          <strong>Inside this read</strong>
          <a href="#cohorts">Why the signal points up</a>
          <a href="#exposure">Where exposure sits</a>
          <a href="#tradfi">The TradFi sleeve</a>
          <a href="#counterpoint">What pushes back</a>
          <a href="#thesis">Build your thesis</a>
          <div class="index-meta"><span>${snapshot.activeProfiles} active profiles</span><span>${snapshot.nonOptionPositions} positions</span><span>${snapshot.sourceErrors} source errors</span></div>
        </aside>

        <article class="research-letter">
          <section class="story-section" id="cohorts">
            <div class="section-intro">
              <h2>Why the signal points up</h2>
              <p>The strongest cohort is positioned against the weakest cohort. Market View treats that separation as the directional signal.</p>
            </div>
            <div class="signal-equation">
              <div><span>Profitable group</span><strong>75.1% long</strong><small>+$3.88B net long</small></div>
              <div class="equation-mark">+</div>
              <div><span>Loss-making group</span><strong>59.1% short</strong><small>-$748.21M net short</small></div>
              <div class="equation-result"><span>Market View read</span><strong>UP</strong><small>Medium confidence</small></div>
            </div>
            <div class="cohort-grid">
              ${cohortColumn("profitable", cohortDetails.profitable)}
              ${cohortColumn("loss", cohortDetails.loss)}
            </div>
            <p class="method-note">UP is a positioning heuristic. It is not a probability forecast or proof that price must rise.</p>
          </section>

          <section class="story-section" id="exposure">
            <div class="section-intro">
              <h2>The tracked book leans the same way</h2>
              <p>Across non-option positions, $4.35M is long and $548.8K is short. ETH is the broadest shared exposure.</p>
            </div>
            <div class="book-summary"><strong>88.9%</strong><span>of tracked position value is long</span><small>${snapshot.activeProfiles} active profiles across ${snapshot.trackedProfiles} tracked</small></div>
            <div class="exposure-legend"><span>Short</span><span>Long</span></div>
            <div class="exposure-chart">${exposures.map(exposureRow).join("")}</div>
            <p class="method-note">Position value measures the monitored book. It does not represent market-wide open interest, and the same asset can appear in several profiles.</p>
          </section>

          <section class="story-section tradfi-section" id="tradfi">
            <div class="section-intro">
              <h2>The TradFi sleeve is long tech and macro proxies</h2>
              <p>The snapshot includes synthetic equity, index, FX and commodity positions. Every leading TradFi exposure shown here is long.</p>
            </div>
            <div class="tradfi-grid">${tradfi.map((item) => `<article><strong>${item.asset}</strong><span>${item.value}</span><small>${item.side}</small></article>`).join("")}</div>
            <p class="method-note">These instruments show where the tracked profiles express exposure. Market View alone does not explain the macro cause.</p>
          </section>

          <section class="story-section" id="counterpoint">
            <div class="section-intro">
              <h2>Three things keep the read honest</h2>
              <p>The data is bullish in one layer, conflicted in another, and conditional in the order layer.</p>
            </div>
            <div class="counterpoint-layout">
              <div class="counterpoint-secondary">
                <article>
                  <span>Options layer</span>
                  <h3>25 long calls</h3>
                  <p>$22,022.98 market value. About 74% expires on 30 Oct.</p>
                  <div class="option-list">${optionHighlights.map((item) => `<div><strong>${item.instrument}</strong><span>${item.expiry}</span><span>${item.value}</span><b>${item.pnl} UPnL</b></div>`).join("")}</div>
                </article>
                <article>
                  <span>Pending order intent</span>
                  <h3>$700.41K BTC sells</h3>
                  <p>84 orders are grouped between $87,485 and $90,000. The same anonymous book has $223.23K of NEAR buys from $3.50 to $3.80.</p>
                  <small>Open orders are intent. They are not executed flow.</small>
                </article>
              </div>
            </div>
          </section>

          <section class="story-section thesis-builder" id="thesis">
            <div class="section-intro">
              <h2>Turn the evidence into your thesis</h2>
              <p>Choose a stance. The draft keeps supporting evidence, counterevidence and invalidation in one place.</p>
            </div>
            <div class="thesis-controls" role="group" aria-label="Choose a thesis stance">
              ${Object.entries(thesisDrafts).map(([key, value]) => `<button type="button" data-thesis="${key}" class="${key === "long" ? "is-active" : ""}">${value.label}</button>`).join("")}
            </div>
            <div id="thesis-output">${thesisMarkup("long")}</div>
          </section>

          <footer class="data-footer">
            <div><strong>Snapshot scope</strong><span>${snapshot.capturedAt}</span><span>${snapshot.freshness}</span><span>${snapshot.sourceErrors} collection errors recorded</span></div>
            <div><strong>Evidence layers</strong><span>Hyperdash cohort positioning</span><span>Anonymous perp and option positions</span><span>Pending order intent</span></div>
            <div><strong>Interpretation boundary</strong><span>Profile identities hidden</span><span>Different populations stay separate</span><span>No price prediction implied</span></div>
          </footer>
        </article>
      </div>
    </main>
  `;
}

render();

document.querySelector(".thesis-controls").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-thesis]");
  if (!button) return;
  document.querySelectorAll(".thesis-controls button").forEach((item) => item.classList.toggle("is-active", item === button));
  document.querySelector("#thesis-output").innerHTML = thesisMarkup(button.dataset.thesis);
});
