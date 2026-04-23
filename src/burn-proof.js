import "./styles.css";
import "./burnHub.css";
import Chart from "chart.js/auto";
import {
  buildBurnHubNavHTML,
  deriveBurnMetrics,
  escapeHtml,
  fetchBurnSuiteData,
  formatCompactNumber,
  formatInteger,
  formatMoney,
  shortenAddress,
  txExplorerUrl,
} from "./burnSuite.js";
import { buildPlatformHeaderHTML } from "./siteChrome.js";
import { buildBurnSourceChips, loadScenarioState, readViewCache, writeViewCache } from "./siteState.js";

const APP = document.querySelector("#app");
const CACHE_KEY = "burn-proof-live-v1";
let proofChart = null;
let refreshInFlight = false;
let pageState = null;

if (!APP) {
  throw new Error("Missing #app root");
}

Chart.register({
  id: "burn-proof-crosshair",
  afterDraw(chart) {
    if (!chart.tooltip?._active?.length) {
      return;
    }

    const context = chart.ctx;
    const x = chart.tooltip._active[0].element.x;
    const { top, bottom } = chart.chartArea;
    context.save();
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.lineWidth = 1;
    context.strokeStyle = "rgba(96, 165, 250, 0.22)";
    context.setLineDash([4, 4]);
    context.stroke();
    context.restore();
  },
});

function fallbackPublicData() {
  return {
    prices: {},
    burnState: {
      status: "unavailable",
      burnAddress: "aaaaa-aa",
      burnAddressBalance: null,
      currentSupply: null,
      originalSupply: null,
      totalBurned: null,
      log: [],
      note: "MGSN burn history is temporarily unavailable.",
    },
    treasuryAccount: null,
    trenchState: null,
  };
}

function buildState(raw, hydrationMode) {
  const merged = {
    ...fallbackPublicData(),
    ...raw,
  };

  return {
    ...merged,
    hydrationMode,
    metrics: deriveBurnMetrics({
      burnState: merged.burnState,
      mgsnUsd: merged.prices?.mgsnUsd ?? null,
      treasuryAccount: merged.treasuryAccount,
      trenchState: merged.trenchState,
    }),
  };
}

function renderReceiptRow(entry) {
  const txUrl = txExplorerUrl(entry?.txId);
  return `
    <div class="burn-feed-row">
      <div class="burn-feed-main">
        <span class="burn-feed-title">${escapeHtml(formatCompactNumber(entry?.mgsnBurned))} MGSN</span>
        <span class="burn-feed-meta">${escapeHtml(entry?.date ?? "Unavailable")} · ${escapeHtml(shortenAddress(entry?.address, 10, 8))} · ${escapeHtml(entry?.note ?? "Burn receipt")}</span>
      </div>
      <span class="burn-chip ${entry?.source?.key === "community" ? "live" : "bio"}">${escapeHtml(entry?.source?.label ?? "Community")}</span>
      <span class="burn-feed-meta">Block ${escapeHtml(entry?.txId ?? "Unavailable")}</span>
      ${txUrl ? `<a class="burn-anchor-link" href="${txUrl}" target="_blank" rel="noopener noreferrer">Explorer</a>` : `<span class="burn-feed-meta">Unavailable</span>`}
    </div>`;
}

function buildHtml(state) {
  const metrics = state.metrics;

  return `
    ${buildPlatformHeaderHTML({
      activePage: "burn",
      badgeText: "Burn proof",
      priceLabel: "MGSN/USD",
      priceValue: state.prices?.mgsnUsd != null ? formatMoney(state.prices.mgsnUsd, 7) : "Unavailable",
      priceClass: state.prices?.mgsnUsd != null ? "live" : "",
    })}

    <div class="burn-shell">
      ${buildBurnSourceChips(metrics, loadScenarioState(), state.hydrationMode)}
      ${buildBurnHubNavHTML("burn-proof")}

      <section class="burn-hero">
        <div class="burn-hero-copy">
          <span class="burn-kicker">Explorer-first verification</span>
          <h1 class="burn-title">Burn Proof</h1>
          <p class="burn-copy">The receipts surface for the MGSN burn rail. This page stays close to the ledger: latest burns, largest burns, short-window flow, and raw transaction links you can verify outside the site.</p>
          <div class="burn-stat-grid">
            <article class="burn-stat">
              <span class="burn-stat-label">Latest burn</span>
              <span class="burn-stat-value">${metrics.latestBurn ? `${formatCompactNumber(metrics.latestBurn.mgsnBurned)} MGSN` : "Waiting"}</span>
              <p class="burn-stat-copy">${escapeHtml(metrics.latestBurn ? `${metrics.latestBurn.date} · ${metrics.latestBurn.note}` : "No receipt has landed yet.")}</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Largest burn</span>
              <span class="burn-stat-value">${metrics.largestBurn ? `${formatCompactNumber(metrics.largestBurn.mgsnBurned)} MGSN` : "Waiting"}</span>
              <p class="burn-stat-copy">${escapeHtml(metrics.largestBurn ? `${metrics.largestBurn.date} · ${shortenAddress(metrics.largestBurn.address, 10, 8)}` : "Waiting for the first large burn.")}</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">7d flow</span>
              <span class="burn-stat-value">${formatCompactNumber(metrics.burned7d)} MGSN</span>
              <p class="burn-stat-copy">Rolling burn flow over the last seven days.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">30d flow</span>
              <span class="burn-stat-value">${formatCompactNumber(metrics.burned30d)} MGSN</span>
              <p class="burn-stat-copy">Rolling burn flow over the last thirty days.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Unique burners</span>
              <span class="burn-stat-value">${formatInteger(metrics.uniqueBurners)}</span>
              <p class="burn-stat-copy">Distinct principals with at least one verified burn.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Protocol note</span>
              <span class="burn-stat-value">${metrics.protocol.lpBurnCheckpoints.length > 0 ? "Published" : "Staged"}</span>
              <p class="burn-stat-copy">${escapeHtml(metrics.protocol.latestProtocolStatus)}</p>
            </article>
          </div>
        </div>
        <aside class="burn-console">
          <div class="burn-console-head">
            <div>
              <h2 class="burn-console-title">Receipt focus</h2>
              <p class="burn-console-subtitle">No speculation here. This route stays on proof, cadence, and transaction history.</p>
            </div>
            <span class="burn-auth-chip live">Ledger scan</span>
          </div>
          <div class="burn-mini-grid">
            <div class="burn-mini-card">
              <span class="burn-mini-label">Current burn address</span>
              <span class="burn-mini-value">${escapeHtml(shortenAddress(metrics.burnState.burnAddress, 10, 6))}</span>
              <p class="burn-mini-copy"><span class="burn-inline-code">${escapeHtml(metrics.burnState.burnAddress)}</span></p>
            </div>
            <div class="burn-mini-card">
              <span class="burn-mini-label">Burned in 24h</span>
              <span class="burn-mini-value">${formatCompactNumber(metrics.burned24h)} MGSN</span>
              <p class="burn-mini-copy">Short-window pressure from fresh receipts.</p>
            </div>
          </div>
          <div class="burn-action-row">
            <button id="proof-refresh" class="burn-btn burn-btn-primary" type="button"${refreshInFlight ? " disabled" : ""}>${refreshInFlight ? "Refreshing..." : "Refresh feed"}</button>
            <a class="burn-btn burn-btn-secondary" href="/burn.html">Open burn rail</a>
          </div>
        </aside>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">14-day burn flow</h2>
        <p class="burn-section-copy">The day-level burn cadence underneath the receipts. Hover for exact daily totals.</p>
        <div class="burn-card">
          <div class="burn-chart-shell"><canvas id="proof-burn-chart"></canvas></div>
        </div>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Recent receipts</h2>
        <p class="burn-section-copy">The newest ledger-indexed burns, with direct explorer handoff.</p>
        <div class="burn-feed">
          <div class="burn-feed-list">
            ${metrics.recentBurns.length ? metrics.recentBurns.map(renderReceiptRow).join("") : `<div class="burn-empty">No receipts have been indexed yet.</div>`}
          </div>
        </div>
      </section>
    </div>`;
}

function renderChart(state) {
  const canvas = document.getElementById("proof-burn-chart");
  if (!canvas) {
    return;
  }

  if (proofChart) {
    proofChart.destroy();
  }

  proofChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: state.metrics.dailySeries.map((entry) => entry.label),
      datasets: [
        {
          label: "Daily burn flow",
          data: state.metrics.dailySeries.map((entry) => entry.total),
          backgroundColor: "rgba(96, 165, 250, 0.7)",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: {
            color: "#cbd5e1",
            font: { family: "'IBM Plex Mono', monospace", size: 11 },
          },
        },
        tooltip: {
          callbacks: {
            label(context) {
              return ` Burned: ${formatCompactNumber(Number(context.raw))} MGSN`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#94a3b8",
            font: { family: "'IBM Plex Mono', monospace", size: 10 },
          },
          grid: { display: false },
        },
        y: {
          ticks: {
            color: "#94a3b8",
            callback(value) {
              return formatCompactNumber(Number(value));
            },
          },
          grid: { color: "rgba(148, 163, 184, 0.08)" },
        },
      },
    },
  });
}

function renderPage(state) {
  pageState = state;
  APP.innerHTML = buildHtml(state);
  renderChart(state);
  document.getElementById("proof-refresh")?.addEventListener("click", () => {
    void hydrate(true);
  });
}

async function hydrate(force = false) {
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;
  try {
    const liveData = await fetchBurnSuiteData({
      force,
      includeProtocol: true,
    });

    writeViewCache(CACHE_KEY, {
      prices: liveData.prices,
      burnState: liveData.burnState,
      treasuryAccount: liveData.treasuryAccount,
      trenchState: liveData.trenchState,
    });

    renderPage(buildState(liveData, "live"));
  } finally {
    refreshInFlight = false;
  }
}

async function bootstrap() {
  const cached = readViewCache(CACHE_KEY);
  renderPage(buildState(cached ?? fallbackPublicData(), cached ? "cached" : "loading"));
  await hydrate();
  window.setInterval(() => {
    void hydrate(true);
  }, 60_000);
}

void bootstrap();
