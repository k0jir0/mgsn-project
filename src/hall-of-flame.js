import "./styles.css";
import "./burnHub.css";
import {
  buildBurnHubNavHTML,
  buildLeaderboardFromEntries,
  deriveBurnMetrics,
  escapeHtml,
  fetchBurnSuiteData,
  filterEntriesByDays,
  formatCompactNumber,
  formatInteger,
  formatMoney,
  formatPercent,
  shortenAddress,
} from "./burnSuite.js";
import { buildPlatformHeaderHTML } from "./siteChrome.js";
import { buildBurnSourceChips, loadScenarioState, readViewCache, writeViewCache } from "./siteState.js";

const APP = document.querySelector("#app");
const CACHE_KEY = "hall-of-flame-live-v1";
let pageState = null;
let refreshInFlight = false;
const uiState = {
  scope: "all",
};

if (!APP) {
  throw new Error("Missing #app root");
}

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
  const metrics = deriveBurnMetrics({
    burnState: merged.burnState,
    mgsnUsd: merged.prices?.mgsnUsd ?? null,
    treasuryAccount: merged.treasuryAccount,
    trenchState: merged.trenchState,
  });
  const rolling30dEntries = filterEntriesByDays(metrics.burnLog, 30);
  const rolling30dLeaderboard = buildLeaderboardFromEntries(rolling30dEntries, metrics.originalSupply);

  return {
    ...merged,
    hydrationMode,
    metrics,
    rolling30dLeaderboard,
  };
}

function activeBoard(state) {
  return uiState.scope === "30d" ? state.rolling30dLeaderboard : state.metrics.leaderboard;
}

function boardTotals(board) {
  const totalBurned = board.reduce((total, row) => total + row.totalBurned, 0);
  const topThree = board.slice(0, 3).reduce((total, row) => total + row.totalBurned, 0);
  return { totalBurned, topThree };
}

function renderPodium(board) {
  if (!board.length) {
    return `<div class="burn-empty">No burners are ranked in this window yet.</div>`;
  }

  return `
    <div class="burn-podium-grid">
      ${board.slice(0, 3).map((row) => `
        <article class="burn-podium-card">
          <span class="burn-podium-rank">Rank #${row.rank}</span>
          <div class="burn-podium-name">${escapeHtml(shortenAddress(row.address, 10, 8))}</div>
          <div class="burn-podium-amount">${escapeHtml(formatCompactNumber(row.totalBurned))} MGSN</div>
          <div class="burn-podium-meta">${escapeHtml(row.pctOfSupply != null ? formatPercent(row.pctOfSupply, 3) : "Unavailable")} of original supply</div>
          <div class="burn-podium-meta">${row.txCount} burn${row.txCount === 1 ? "" : "s"} · last ${escapeHtml(row.lastDate || "Unavailable")}</div>
        </article>`).join("")}
    </div>`;
}

function renderRows(board) {
  if (!board.length) {
    return `<div class="burn-empty">No burners are ranked in this window yet.</div>`;
  }

  return `
    <div class="burn-table-body">
      ${board.map((row) => `
        <div class="burn-table-row">
          <span class="burn-table-title">#${row.rank}</span>
          <div class="burn-table-main">
            <span class="burn-table-title">${escapeHtml(shortenAddress(row.address, 10, 8))}</span>
            <span class="burn-table-meta">${row.txCount} burn${row.txCount === 1 ? "" : "s"} · largest ${escapeHtml(formatCompactNumber(row.largestBurn))} MGSN</span>
          </div>
          <span class="burn-table-title">${escapeHtml(formatCompactNumber(row.totalBurned))} MGSN</span>
          <span class="burn-table-meta">${escapeHtml(row.pctOfSupply != null ? formatPercent(row.pctOfSupply, 4) : "Unavailable")}</span>
          <span class="burn-table-meta">${escapeHtml(row.lastDate || "Unavailable")}</span>
          <span class="burn-table-meta">${escapeHtml(shortenAddress(row.address))}</span>
        </div>`).join("")}
    </div>`;
}

function buildHtml(state) {
  const board = activeBoard(state);
  const totals = boardTotals(board);
  const leader = board[0] ?? null;

  return `
    ${buildPlatformHeaderHTML({
      activePage: "burn",
      badgeText: "Hall of Flame",
      priceLabel: "MGSN/USD",
      priceValue: state.prices?.mgsnUsd != null ? formatMoney(state.prices.mgsnUsd, 7) : "Unavailable",
      priceClass: state.prices?.mgsnUsd != null ? "live" : "",
    })}

    <div class="burn-shell">
      ${buildBurnSourceChips(state.metrics, loadScenarioState(), state.hydrationMode)}
      ${buildBurnHubNavHTML("hall-of-flame")}

      <section class="burn-hero">
        <div class="burn-hero-copy">
          <span class="burn-kicker">Leaderboard surface</span>
          <h1 class="burn-title">Hall of Flame</h1>
          <p class="burn-copy">The ranking room for burners chasing public status. Switch between all-time and 30-day windows without leaving the burn suite.</p>
          <div class="burn-stat-grid">
            <article class="burn-stat">
              <span class="burn-stat-label">Window</span>
              <span class="burn-stat-value">${uiState.scope === "30d" ? "30 days" : "All time"}</span>
              <p class="burn-stat-copy">The active leaderboard scope.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Ranked burners</span>
              <span class="burn-stat-value">${formatInteger(board.length)}</span>
              <p class="burn-stat-copy">Addresses with at least one verified burn in this window.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Top-three total</span>
              <span class="burn-stat-value">${formatCompactNumber(totals.topThree)} MGSN</span>
              <p class="burn-stat-copy">Combined pressure from the current podium.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Leader</span>
              <span class="burn-stat-value">${leader ? shortenAddress(leader.address, 10, 8) : "Waiting"}</span>
              <p class="burn-stat-copy">${leader ? `${formatCompactNumber(leader.totalBurned)} MGSN burned.` : "No leader exists yet."}</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Window burn total</span>
              <span class="burn-stat-value">${formatCompactNumber(totals.totalBurned)} MGSN</span>
              <p class="burn-stat-copy">Total burn pressure represented in this leaderboard scope.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Full-suite total</span>
              <span class="burn-stat-value">${state.metrics.totalBurned != null ? `${formatCompactNumber(state.metrics.totalBurned)} MGSN` : "Unavailable"}</span>
              <p class="burn-stat-copy">The all-time burn total remains the anchor for the broader program.</p>
            </article>
          </div>
        </div>
        <aside class="burn-console">
          <div class="burn-console-head">
            <div>
              <h2 class="burn-console-title">Scope controls</h2>
              <p class="burn-console-subtitle">Switch the room between all-time standing and recent momentum.</p>
            </div>
            <span class="burn-auth-chip live">Live board</span>
          </div>
          <div class="burn-action-row">
            <button id="hall-scope-all" class="burn-btn ${uiState.scope === "all" ? "burn-btn-primary" : "burn-btn-secondary"}" type="button">All time</button>
            <button id="hall-scope-30d" class="burn-btn ${uiState.scope === "30d" ? "burn-btn-primary" : "burn-btn-secondary"}" type="button">30-day movers</button>
          </div>
          <div class="burn-action-row">
            <button id="hall-refresh" class="burn-btn burn-btn-secondary" type="button"${refreshInFlight ? " disabled" : ""}>${refreshInFlight ? "Refreshing..." : "Refresh board"}</button>
            <a class="burn-btn burn-btn-secondary" href="/burn.html">Open burn rail</a>
          </div>
        </aside>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Podium</h2>
        <p class="burn-section-copy">The current top burners in the selected scope.</p>
        ${renderPodium(board)}
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Full board</h2>
        <p class="burn-section-copy">Expanded rankings for the active scope.</p>
        <div class="burn-table-wrap">
          <div class="burn-table-header">
            <span class="burn-table-label">Rank</span>
            <span class="burn-table-label">Address</span>
            <span class="burn-table-label">Total burned</span>
            <span class="burn-table-label">% of supply</span>
            <span class="burn-table-label">Last burn</span>
            <span class="burn-table-label">Identity</span>
          </div>
          ${renderRows(board)}
        </div>
      </section>
    </div>`;
}

function renderPage(state) {
  pageState = state;
  APP.innerHTML = buildHtml(state);

  document.getElementById("hall-scope-all")?.addEventListener("click", () => {
    uiState.scope = "all";
    renderPage(pageState);
  });

  document.getElementById("hall-scope-30d")?.addEventListener("click", () => {
    uiState.scope = "30d";
    renderPage(pageState);
  });

  document.getElementById("hall-refresh")?.addEventListener("click", () => {
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
