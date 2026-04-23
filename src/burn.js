import "./styles.css";
import "./burnHub.css";
import Chart from "chart.js/auto";
import { BURN_PROGRAM, TOKEN_CANISTERS } from "./demoData.js";
import { getAuthState, login, logout, subscribeAuth } from "./auth.js";
import {
  buildBurnHubNavHTML,
  buildBurnScenario,
  deriveBurnMetrics,
  escapeHtml,
  executeBurnTransfer,
  fetchBurnSuiteData,
  formatCompactNumber,
  formatInteger,
  formatMoney,
  formatPercent,
  parseBurnAmountInput,
  shortenAddress,
  txExplorerUrl,
} from "./burnSuite.js";
import { buildPlatformHeaderHTML } from "./siteChrome.js";
import {
  attachScenarioStudio,
  buildBurnSourceChips,
  buildScenarioHeaderHTML,
  getBurnScenarioAmount,
  loadScenarioState,
  readViewCache,
  writeViewCache,
} from "./siteState.js";

const APP = document.querySelector("#app");
const CACHE_KEY = "burn-page-live-v2";
const BURN_DECIMALS = 8;
const ICPSWAP_SWAP_URL =
  `https://app.icpswap.com/swap?input=${TOKEN_CANISTERS.ICP}&output=${TOKEN_CANISTERS.MGSN}`;

if (!APP) {
  throw new Error("Missing #app root");
}

Chart.register({
  id: "burn-crosshair",
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
    context.strokeStyle = "rgba(251, 146, 60, 0.22)";
    context.setLineDash([4, 4]);
    context.stroke();
    context.restore();
  },
});

let milestoneChart = null;
let velocityChart = null;
let liveRefreshInFlight = false;
let pageState = null;
const uiState = {
  auth: null,
  burnAmountInput: "",
  busyAction: "",
  lastActionMessage: "",
  lastActionTone: "bio",
  lastTxIndex: null,
};

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
    wallet: null,
  };
}

function e8sToTokens(raw, decimals = BURN_DECIMALS) {
  if (raw == null) {
    return null;
  }

  const numeric = typeof raw === "bigint" ? Number(raw) : Number(raw);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric / 10 ** decimals;
}

function formatTokenDisplay(raw, digits = 4) {
  const numeric = e8sToTokens(raw);
  if (numeric == null) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(numeric);
}

function trimTokenInput(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }

  return numeric.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function getWalletMaxBurn(wallet) {
  if (!wallet?.balanceE8s || wallet.feeE8s == null) {
    return 0;
  }

  const maxBurn = wallet.balanceE8s - wallet.feeE8s;
  return maxBurn > 0n ? e8sToTokens(maxBurn) ?? 0 : 0;
}

function currentConsoleAmount(state) {
  if (uiState.burnAmountInput) {
    return uiState.burnAmountInput;
  }

  const walletMax = getWalletMaxBurn(state.wallet);
  if (walletMax > 0) {
    return trimTokenInput(Math.min(walletMax, getBurnScenarioAmount()));
  }

  return trimTokenInput(getBurnScenarioAmount());
}

function renderBurnFeedRow(entry) {
  const source = entry?.source?.label ?? "Community";
  const txUrl = txExplorerUrl(entry?.txId);
  return `
    <div class="burn-feed-row">
      <div class="burn-feed-main">
        <span class="burn-feed-title">${escapeHtml(formatCompactNumber(entry?.mgsnBurned))} MGSN</span>
        <span class="burn-feed-meta">${escapeHtml(shortenAddress(entry?.address))} · ${escapeHtml(source)} · ${escapeHtml(entry?.note ?? "Burn event")}</span>
      </div>
      <span class="burn-chip ${entry?.source?.key === "buyback" ? "warn" : entry?.source?.key === "treasury" ? "bio" : "live"}">${escapeHtml(source)}</span>
      <span class="burn-feed-meta">${escapeHtml(entry?.date ?? "Unavailable")}</span>
      ${txUrl ? `<a class="burn-anchor-link" href="${txUrl}" target="_blank" rel="noopener noreferrer">View TX</a>` : `<span class="burn-feed-meta">TX unavailable</span>`}
    </div>`;
}

function renderProofCard(label, value, copy, tone = "bio") {
  return `
    <article class="burn-panel">
      <span class="burn-panel-label">${escapeHtml(label)}</span>
      <span class="burn-panel-value">${escapeHtml(value)}</span>
      <p class="burn-panel-copy">${escapeHtml(copy)}</p>
      <span class="burn-chip ${tone}">${escapeHtml(label)}</span>
    </article>`;
}

function renderSourceCard(bucket) {
  const value = bucket.totalBurned > 0
    ? `${formatCompactNumber(bucket.totalBurned)} MGSN`
    : bucket.status === "unpublished"
      ? "Awaiting public source"
      : "No classified burns yet";

  return `
    <article class="burn-source-card">
      <span class="burn-source-label">${escapeHtml(bucket.label)}</span>
      <span class="burn-source-value">${escapeHtml(value)}</span>
      <p class="burn-source-copy">${escapeHtml(bucket.note)}</p>
      <div class="burn-row">
        <span class="burn-chip ${bucket.status === "live" ? "live" : "warn"}">${bucket.txCount} tx</span>
        <span class="burn-chip bio">${bucket.status === "live" ? "classified" : "pending"}</span>
      </div>
    </article>`;
}

function renderLeaderboardRows(leaderboard) {
  if (!leaderboard.length) {
    return `<div class="burn-empty">No burns have been indexed yet. The first burn to hit the ledger will take the top slot.</div>`;
  }

  return `
    <div class="burn-table-body">
      ${leaderboard.map((row) => `
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

function renderPodium(leaderboard) {
  const podium = leaderboard.slice(0, 3);
  if (!podium.length) {
    return `<div class="burn-empty">The Hall of Flame is waiting for the first verified burner.</div>`;
  }

  return `
    <div class="burn-podium-grid">
      ${podium.map((row) => `
        <article class="burn-podium-card">
          <span class="burn-podium-rank">Rank #${row.rank}</span>
          <div class="burn-podium-name">${escapeHtml(shortenAddress(row.address, 10, 8))}</div>
          <div class="burn-podium-amount">${escapeHtml(formatCompactNumber(row.totalBurned))} MGSN</div>
          <div class="burn-podium-meta">${escapeHtml(row.pctOfSupply != null ? formatPercent(row.pctOfSupply, 3) : "Unavailable")} of original supply</div>
          <div class="burn-podium-meta">${row.txCount} burn${row.txCount === 1 ? "" : "s"} · last ${escapeHtml(row.lastDate || "Unavailable")}</div>
        </article>`).join("")}
    </div>`;
}

function buildState(raw, hydrationMode) {
  const fallback = fallbackPublicData();
  const merged = {
    ...fallback,
    ...raw,
  };
  const principal = merged.wallet?.principal ?? uiState.auth?.principal ?? null;
  const metrics = deriveBurnMetrics({
    burnState: merged.burnState,
    mgsnUsd: merged.prices?.mgsnUsd ?? null,
    principal,
    treasuryAccount: merged.treasuryAccount,
    trenchState: merged.trenchState,
  });
  const consoleAmount = currentConsoleAmount(merged);
  const scenario = buildBurnScenario(metrics, Number(consoleAmount || 0));

  return {
    ...merged,
    metrics,
    hydrationMode,
    consoleAmount,
    scenario,
  };
}

function renderConsole(state) {
  const wallet = state.wallet;
  const authenticated = !!uiState.auth?.authenticated && !!wallet;
  const walletMaxBurn = getWalletMaxBurn(wallet);
  const burnAddress = state.metrics?.burnState?.burnAddress ?? "aaaaa-aa";
  const lastTxUrl = uiState.lastTxIndex != null ? txExplorerUrl(uiState.lastTxIndex.toString()) : "";

  return `
    <aside class="burn-console">
      <div class="burn-console-head">
        <div>
          <h2 class="burn-console-title">Burn Console</h2>
          <p class="burn-console-subtitle">Direct MGSN burn rail for your default Internet Identity account. External wallets can still burn manually to the canonical blackhole.</p>
        </div>
        <span class="burn-auth-chip${authenticated ? " live" : ""}">
          ${authenticated ? "II connected" : "Manual rail fallback"}
        </span>
      </div>
      <div class="burn-mini-grid">
        <div class="burn-mini-card">
          <span class="burn-mini-label">Wallet balance</span>
          <span class="burn-mini-value">${wallet ? `${formatTokenDisplay(wallet.balanceE8s)} MGSN` : "Connect II"}</span>
          <p class="burn-mini-copy">${wallet ? `${formatTokenDisplay(wallet.feeE8s, 8)} MGSN network fee` : "Balance and fee load after authentication."}</p>
        </div>
        <div class="burn-mini-card">
          <span class="burn-mini-label">Burn address</span>
          <span class="burn-mini-value">${escapeHtml(shortenAddress(burnAddress, 10, 6))}</span>
          <p class="burn-mini-copy">Canonical ICP blackhole: <span class="burn-inline-code">${escapeHtml(burnAddress)}</span></p>
        </div>
      </div>
      <label class="burn-row" for="burn-amount">
        <input id="burn-amount" class="burn-input" type="number" min="0" step="0.00000001" value="${escapeHtml(state.consoleAmount)}" placeholder="100000" />
      </label>
      <div class="burn-balance-rail">
        <span>Max burnable: ${wallet ? `${formatTokenDisplay(wallet.balanceE8s - wallet.feeE8s > 0n ? wallet.balanceE8s - wallet.feeE8s : 0n)} MGSN` : "Connect II"}</span>
        <span>${state.scenario?.pctOfSupply != null ? `${formatPercent(state.scenario.pctOfSupply, 6)} of original supply` : "Scenario ready"}</span>
      </div>
      <div class="burn-action-row">
        <button class="burn-btn burn-btn-secondary" type="button" data-burn-preset="0.1"${walletMaxBurn <= 0 ? " disabled" : ""}>10%</button>
        <button class="burn-btn burn-btn-secondary" type="button" data-burn-preset="0.25"${walletMaxBurn <= 0 ? " disabled" : ""}>25%</button>
        <button class="burn-btn burn-btn-secondary" type="button" data-burn-preset="0.5"${walletMaxBurn <= 0 ? " disabled" : ""}>50%</button>
        <button class="burn-btn burn-btn-ghost" type="button" data-burn-preset="max"${walletMaxBurn <= 0 ? " disabled" : ""}>Max</button>
      </div>
      <div class="burn-action-row">
        ${uiState.auth?.authenticated
          ? `<button id="burn-submit" class="burn-btn burn-btn-primary" type="button"${uiState.busyAction === "burn" ? " disabled" : ""}>${uiState.busyAction === "burn" ? "Burning..." : "Burn Now"}</button>
             <button id="burn-logout" class="burn-btn burn-btn-secondary" type="button"${uiState.busyAction === "auth" ? " disabled" : ""}>Disconnect</button>`
          : `<button id="burn-login" class="burn-btn burn-btn-primary" type="button"${uiState.busyAction === "auth" ? " disabled" : ""}>Connect Internet Identity</button>`}
        <a class="burn-btn burn-btn-secondary" href="${ICPSWAP_SWAP_URL}" target="_blank" rel="noopener noreferrer">Buy MGSN</a>
        <button id="burn-copy-address" class="burn-btn burn-btn-secondary" type="button">Copy burn address</button>
      </div>
      <div class="burn-row">
        <span class="burn-chip bio">${escapeHtml(uiState.auth?.authenticated ? shortenAddress(uiState.auth.principal, 10, 8) : "Direct manual burn still supported")}</span>
        <span class="burn-chip warn">${state.scenario?.nextPctBurned != null ? `after burn: ${formatPercent(state.scenario.nextPctBurned, 4)} retired` : "supply impact ready"}</span>
      </div>
      ${uiState.lastActionMessage
        ? `<div class="burn-mini-card">
            <span class="burn-mini-label">Latest action</span>
            <span class="burn-mini-value">${escapeHtml(uiState.lastActionMessage)}</span>
            <p class="burn-mini-copy">${lastTxUrl ? `<a class="burn-anchor-link" href="${lastTxUrl}" target="_blank" rel="noopener noreferrer">View transaction</a>` : "Ledger response stored in this session."}</p>
          </div>`
        : ""}
    </aside>`;
}

function renderPersonalSection(state) {
  const user = state.metrics.user;

  if (!uiState.auth?.authenticated) {
    return `
      <section class="burn-section">
        <h2 class="burn-section-title">Personal burner card</h2>
        <p class="burn-section-copy">Connect Internet Identity to see your wallet balance, personal burn history, live rank, and how much MGSN separates you from the next slot on the board.</p>
        <article class="burn-card">
          <p class="burn-empty-copy">No wallet connected yet. Manual burns still count once they land on the ledger, but the live personal card only tracks the connected II principal.</p>
        </article>
      </section>`;
  }

  return `
    <section class="burn-section">
      <h2 class="burn-section-title">Personal burner card</h2>
      <p class="burn-section-copy">Your burn rail, rank position, and next pressure target, derived from the same ledger feed that powers the public board.</p>
      <div class="burn-proof-grid">
        ${renderProofCard("Connected principal", shortenAddress(user.principal, 10, 8), "This is the II principal currently powering the native burn console.", "live")}
        ${renderProofCard("Your total burned", user.totalBurned > 0 ? `${formatCompactNumber(user.totalBurned)} MGSN` : "No burns yet", user.totalBurned > 0 ? `You currently account for ${user.shareOfBurned != null ? formatPercent(user.shareOfBurned, 2) : "Unavailable"} of all verified burns.` : "The first burn from this principal will immediately register on the live board.", "bio")}
        ${renderProofCard("Your rank", user.rank != null ? `#${user.rank}` : "Unranked", user.rank != null ? "Ranks update from the public ledger archive." : "Burn once to enter the live table.", "warn")}
        ${renderProofCard("Last burn", user.lastBurn ? `${formatCompactNumber(user.lastBurn.mgsnBurned)} MGSN` : "Waiting", user.lastBurn ? `${user.lastBurn.date} · ${user.lastBurn.note}` : "No verified burn from this principal yet.", "bio")}
        ${renderProofCard("To next rank", user.toNextRank != null ? `${formatCompactNumber(user.toNextRank)} MGSN` : "Top slot or no rank yet", user.toNextRank != null ? "Burn at least this much more to overtake the address above you." : "There is no higher rank target yet.", "warn")}
        ${renderProofCard("Wallet balance", state.wallet ? `${formatTokenDisplay(state.wallet.balanceE8s)} MGSN` : "Unavailable", state.wallet ? `${formatTokenDisplay(state.wallet.feeE8s, 8)} MGSN fee per burn transaction.` : "Wallet balance refreshes through the MGSN ledger.", "live")}
      </div>
    </section>`;
}

function buildHtml(state) {
  const metrics = state.metrics;
  const sourceCards = metrics.sourceBuckets.map(renderSourceCard).join("");
  const latestTxUrl = txExplorerUrl(metrics.latestBurn?.txId);
  const largestTxUrl = txExplorerUrl(metrics.largestBurn?.txId);

  return `
    ${buildPlatformHeaderHTML({
      activePage: "burn",
      badgeText: "Supply destruction",
      priceLabel: "MGSN/USD",
      priceValue: state.prices?.mgsnUsd != null ? formatMoney(state.prices.mgsnUsd, 7) : "Unavailable",
      priceId: "burn-price",
      priceClass: state.prices?.mgsnUsd != null ? "live" : "",
    })}

    <div class="burn-shell">
      ${buildScenarioHeaderHTML("burn", buildBurnSourceChips(metrics, loadScenarioState(), state.hydrationMode))}
      ${buildBurnHubNavHTML("burn")}

      <section class="burn-hero">
        <div class="burn-hero-copy">
          <span class="burn-kicker">Ledger-indexed burn rail</span>
          <h1 class="burn-title">Burn MGSN. Keep the proof. Tighten the float.</h1>
          <p class="burn-copy">The most popular MGSN page now works more like a control surface than a poster. You can burn through the native rail, see your own board position, follow live burn receipts, and branch into deeper burn-specific pages without leaving the burn ecosystem.</p>
          <div class="burn-stat-grid">
            <article class="burn-stat">
              <span class="burn-stat-label">Total burned</span>
              <span class="burn-stat-value">${metrics.totalBurned != null ? `${formatCompactNumber(metrics.totalBurned)} MGSN` : "Unavailable"}</span>
              <p class="burn-stat-copy">Direct ledger total across blackhole transfers and native burn ops.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">% retired</span>
              <span class="burn-stat-value">${metrics.burnedPct != null ? formatPercent(metrics.burnedPct, 4) : "Unavailable"}</span>
              <p class="burn-stat-copy">${metrics.nextMilestone ? `${formatCompactNumber(metrics.toNextMilestone)} MGSN to ${metrics.nextMilestone.badge}.` : "All published milestones cleared."}</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">USD destroyed</span>
              <span class="burn-stat-value">${metrics.valueDestroyed != null ? formatMoney(metrics.valueDestroyed) : "Unavailable"}</span>
              <p class="burn-stat-copy">Valued off the live MGSN spot feed when available.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Unique burners</span>
              <span class="burn-stat-value">${formatInteger(metrics.uniqueBurners)}</span>
              <p class="burn-stat-copy">Distinct principals with at least one verified burn.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Remaining supply</span>
              <span class="burn-stat-value">${metrics.currentSupply != null ? `${formatCompactNumber(metrics.currentSupply)} MGSN` : "Unavailable"}</span>
              <p class="burn-stat-copy">Live circulating supply after indexed burns.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Protocol burn status</span>
              <span class="burn-stat-value">${metrics.protocol.lpBurnCheckpoints.length > 0 ? `${metrics.protocol.lpBurnCheckpoints.length} LP receipt${metrics.protocol.lpBurnCheckpoints.length === 1 ? "" : "s"}` : "Staged"}</span>
              <p class="burn-stat-copy">${escapeHtml(metrics.protocol.latestProtocolStatus)}</p>
            </article>
          </div>
        </div>
        ${renderConsole(state)}
      </section>

      ${renderPersonalSection(state)}

      <section class="burn-section">
        <h2 class="burn-section-title">Proof panel</h2>
        <p class="burn-section-copy">Hard numbers first. The speculative price model is still available in Burn Lab, but this page now leads with objective supply, recent receipts, and burn velocity.</p>
        <div class="burn-proof-grid">
          ${renderProofCard("Latest verified burn", metrics.latestBurn ? `${formatCompactNumber(metrics.latestBurn.mgsnBurned)} MGSN` : "Waiting for first burn", metrics.latestBurn ? `${metrics.latestBurn.date} · ${metrics.latestBurn.note}` : "No burn has been indexed yet.", "live")}
          ${renderProofCard("Largest burn", metrics.largestBurn ? `${formatCompactNumber(metrics.largestBurn.mgsnBurned)} MGSN` : "Waiting", metrics.largestBurn ? `${metrics.largestBurn.date} · ${shortenAddress(metrics.largestBurn.address, 10, 8)}` : "The next large burn will set the reference.", "warn")}
          ${renderProofCard("Burned in 24h", `${formatCompactNumber(metrics.burned24h)} MGSN`, "Short-window pressure from the most recent ledger receipts.", "bio")}
          ${renderProofCard("Burned in 7d", `${formatCompactNumber(metrics.burned7d)} MGSN`, "Weekly burn flow directly from indexed transactions.", "live")}
          ${renderProofCard("Burn velocity", metrics.velocityDeltaPct != null ? formatPercent(metrics.velocityDeltaPct, 1) : "No comparison yet", metrics.velocityDeltaPct != null ? "30d burn flow versus the prior 30d window." : "Velocity appears once both windows contain burn activity.", "warn")}
          ${renderProofCard("Latest lock / burn status", metrics.protocol.lpBurnCheckpoints.length > 0 ? "LP burn published" : metrics.protocol.lpLockCheckpoints.length > 0 ? "LP lock published" : "Receipt layer staged", metrics.protocol.lpBurnCheckpoints[0] ? metrics.protocol.latestProtocolStatus : "The protocol burn surface stays honest about what is and is not published.", "bio")}
        </div>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Recent burn tape</h2>
        <p class="burn-section-copy">A fast tape of the most recent verified burns. The dedicated Burn Proof page goes deeper with receipts and day-level flow, but the live tape stays visible right here.</p>
        <div class="burn-feed">
          <div class="burn-feed-list">
            ${metrics.recentBurns.length ? metrics.recentBurns.map(renderBurnFeedRow).join("") : `<div class="burn-empty">No recent burns are available yet.</div>`}
          </div>
        </div>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Source breakdown</h2>
        <p class="burn-section-copy">Burns are now grouped by what we can verify publicly today. Treasury and buyback sources remain zero until those actors actually burn; trench LP burns are tracked separately through published checkpoints.</p>
        <div class="burn-source-grid">
          ${sourceCards}
          <article class="burn-source-card">
            <span class="burn-source-label">LP / trench burns</span>
            <span class="burn-source-value">${metrics.protocol.lpBurnCheckpoints.length > 0 ? `${metrics.protocol.lpBurnCheckpoints.length} receipt${metrics.protocol.lpBurnCheckpoints.length === 1 ? "" : "s"}` : "Awaiting receipts"}</span>
            <p class="burn-source-copy">${escapeHtml(metrics.protocol.latestProtocolStatus)}</p>
            <div class="burn-row">
              <span class="burn-chip bio">${metrics.protocol.liquidityRoutedCheckpoints.length} route note${metrics.protocol.liquidityRoutedCheckpoints.length === 1 ? "" : "s"}</span>
              <span class="burn-chip ${metrics.protocol.lpBurnCheckpoints.length > 0 ? "live" : "warn"}">${metrics.protocol.lpLockCheckpoints.length} lock note${metrics.protocol.lpLockCheckpoints.length === 1 ? "" : "s"}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Milestone pressure</h2>
        <p class="burn-section-copy">Recognition still matters, but this section is tighter now: how far the burn program has progressed, what comes next, and how the current scenario would change the ladder.</p>
        <div class="burn-proof-grid">
          <article class="burn-card">
            <span class="burn-panel-label">Scenario burn</span>
            <span class="burn-panel-value">${state.consoleAmount ? `${escapeHtml(state.consoleAmount)} MGSN` : "0 MGSN"}</span>
            <p class="burn-panel-copy">${state.scenario.pctOfSupply != null ? `${formatPercent(state.scenario.pctOfSupply, 6)} of original supply.` : "Enter an amount in the console to preview its direct supply impact."}</p>
          </article>
          <article class="burn-card">
            <span class="burn-panel-label">After scenario</span>
            <span class="burn-panel-value">${state.scenario.nextPctBurned != null ? formatPercent(state.scenario.nextPctBurned, 4) : "Unavailable"}</span>
            <p class="burn-panel-copy">Projected total retired after the current console amount is burned.</p>
          </article>
          <article class="burn-card">
            <span class="burn-panel-label">Next milestone</span>
            <span class="burn-panel-value">${metrics.nextMilestone ? escapeHtml(metrics.nextMilestone.badge) : "All milestones cleared"}</span>
            <p class="burn-panel-copy">${metrics.nextMilestone ? `${formatCompactNumber(state.scenario.toNextMilestone ?? metrics.toNextMilestone)} MGSN still needed after this scenario.` : "Every published milestone is already satisfied."}</p>
          </article>
        </div>
        <div class="burn-card" style="margin-top:14px">
          <div class="burn-chart-shell"><canvas id="burn-milestone-chart"></canvas></div>
        </div>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Hall of Flame</h2>
        <p class="burn-section-copy">The top burners stay front and center here, while the dedicated Hall of Flame page adds longer tables and 30-day movers.</p>
        ${renderPodium(metrics.leaderboard)}
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Leaderboard</h2>
        <p class="burn-section-copy">Still live, still public, still rebuilt from the MGSN ledger archive. The burn console now feeds directly into the same table once the transaction lands.</p>
        <div class="burn-table-wrap">
          <div class="burn-table-header">
            <span class="burn-table-label">Rank</span>
            <span class="burn-table-label">Address</span>
            <span class="burn-table-label">Total burned</span>
            <span class="burn-table-label">% of supply</span>
            <span class="burn-table-label">Last burn</span>
            <span class="burn-table-label">Identity</span>
          </div>
          ${renderLeaderboardRows(metrics.leaderboard)}
        </div>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Burn ecosystem</h2>
        <p class="burn-section-copy">The burn page is no longer a dead end. These companion pages split receipts, rankings, planning, and protocol burns into dedicated surfaces without losing the live data spine.</p>
        <div class="burn-link-grid">
          <a class="burn-link-card" href="/burn-proof.html">
            <span class="burn-link-kicker">Receipts</span>
            <h3 class="burn-link-title">Burn Proof</h3>
            <p class="burn-link-copy">Raw burn receipts, recent transaction tape, day-by-day burn flow, and explorer-first verification.</p>
          </a>
          <a class="burn-link-card" href="/hall-of-flame.html">
            <span class="burn-link-kicker">Ranking</span>
            <h3 class="burn-link-title">Hall of Flame</h3>
            <p class="burn-link-copy">All-time podium, full leaderboard, and 30-day movers for burners chasing the next slot.</p>
          </a>
          <a class="burn-link-card" href="/burn-lab.html">
            <span class="burn-link-kicker">Planning</span>
            <h3 class="burn-link-title">Burn Lab</h3>
            <p class="burn-link-copy">Hard-math scenario planning: milestone distance, projected rank, and supply impact without the soft marketing layer.</p>
          </a>
          <a class="burn-link-card" href="/protocol-burns.html">
            <span class="burn-link-kicker">System layer</span>
            <h3 class="burn-link-title">Protocol Burns</h3>
            <p class="burn-link-copy">Treasury, buyback, and trench LP burn visibility with explicit source classification and staged receipt status.</p>
          </a>
        </div>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">14-day burn flow</h2>
        <p class="burn-section-copy">A compact view of day-level burn pressure. The proof page expands this with receipt-level context, but the main route now exposes velocity directly.</p>
        <div class="burn-card">
          <div class="burn-chart-shell"><canvas id="burn-velocity-chart"></canvas></div>
        </div>
      </section>

      <section class="burn-section">
        <div class="burn-cta-row burn-card">
          <h2 class="burn-section-title">Stay on the rail</h2>
          <p class="burn-section-copy">Buy, burn, verify, and branch deeper into proof or planning without dropping back into generic token pages.</p>
          <div class="burn-action-row">
            <a class="burn-btn burn-btn-primary" href="${ICPSWAP_SWAP_URL}" target="_blank" rel="noopener noreferrer">Buy MGSN on ICPSwap</a>
            <a class="burn-btn burn-btn-secondary" href="/burn-proof.html">Open Burn Proof</a>
            <a class="burn-btn burn-btn-secondary" href="/burn-lab.html">Open Burn Lab</a>
          </div>
          <div class="burn-row">
            <span class="burn-chip bio">${latestTxUrl ? `<a class="burn-anchor-link" href="${latestTxUrl}" target="_blank" rel="noopener noreferrer">Latest receipt</a>` : "Latest receipt pending"}</span>
            <span class="burn-chip warn">${largestTxUrl ? `<a class="burn-anchor-link" href="${largestTxUrl}" target="_blank" rel="noopener noreferrer">Largest burn proof</a>` : "Largest burn pending"}</span>
          </div>
        </div>
      </section>
    </div>`;
}

function renderMilestoneChart(state) {
  const canvas = document.getElementById("burn-milestone-chart");
  if (!canvas) {
    return;
  }

  const metrics = state.metrics;
  const milestoneLabels = BURN_PROGRAM.milestones.map((milestone) => milestone.badge);
  const milestoneTargets = BURN_PROGRAM.milestones.map((milestone) => milestone.pct);

  if (milestoneChart) {
    milestoneChart.destroy();
  }

  milestoneChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: milestoneLabels,
      datasets: [
        {
          label: "Target %",
          data: milestoneTargets,
          backgroundColor: "rgba(248, 113, 113, 0.12)",
          borderColor: "rgba(248, 113, 113, 0.3)",
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: "Current retired %",
          data: milestoneTargets.map((target) => Math.min(metrics.burnedPct ?? 0, target)),
          backgroundColor: milestoneTargets.map((target) => (metrics.burnedPct ?? 0) >= target ? "rgba(249, 115, 22, 0.88)" : "rgba(249, 115, 22, 0.44)"),
          borderRadius: 6,
        },
        {
          label: "After scenario",
          data: milestoneTargets.map((target) => Math.min(state.scenario.nextPctBurned ?? 0, target)),
          backgroundColor: "rgba(251, 191, 36, 0.32)",
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
              return ` ${context.dataset.label}: ${Number(context.raw).toFixed(3)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#94a3b8",
            font: { family: "'IBM Plex Mono', monospace", size: 11 },
          },
          grid: { color: "rgba(148, 163, 184, 0.08)" },
        },
        y: {
          ticks: {
            color: "#94a3b8",
            callback(value) {
              return `${value}%`;
            },
          },
          grid: { color: "rgba(148, 163, 184, 0.08)" },
        },
      },
    },
  });
}

function renderVelocityChart(state) {
  const canvas = document.getElementById("burn-velocity-chart");
  if (!canvas) {
    return;
  }

  if (velocityChart) {
    velocityChart.destroy();
  }

  velocityChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: state.metrics.dailySeries.map((entry) => entry.label),
      datasets: [
        {
          label: "Daily burn flow",
          data: state.metrics.dailySeries.map((entry) => entry.total),
          backgroundColor: "rgba(249, 115, 22, 0.72)",
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

function attachInteractions(state) {
  document.getElementById("burn-login")?.addEventListener("click", async () => {
    uiState.busyAction = "auth";
    renderPage(pageState);
    try {
      uiState.auth = await login();
      uiState.lastActionMessage = "Internet Identity connected. The burn rail is live.";
      uiState.lastActionTone = "live";
      await hydrate(true);
    } catch (error) {
      uiState.lastActionMessage = error?.message || "Authentication failed.";
      uiState.lastActionTone = "warn";
      renderPage(pageState);
    } finally {
      uiState.busyAction = "";
      renderPage(pageState);
    }
  });

  document.getElementById("burn-logout")?.addEventListener("click", async () => {
    uiState.busyAction = "auth";
    renderPage(pageState);
    try {
      uiState.auth = await logout();
      uiState.lastActionMessage = "Internet Identity disconnected. Manual burn routing stays available.";
      uiState.lastActionTone = "bio";
      await hydrate(true);
    } catch (error) {
      uiState.lastActionMessage = error?.message || "Unable to disconnect.";
      uiState.lastActionTone = "warn";
      renderPage(pageState);
    } finally {
      uiState.busyAction = "";
      renderPage(pageState);
    }
  });

  document.getElementById("burn-copy-address")?.addEventListener("click", async () => {
    const burnAddress = state.metrics.burnState?.burnAddress ?? "aaaaa-aa";
    try {
      await navigator.clipboard.writeText(burnAddress);
      uiState.lastActionMessage = `Copied burn address ${burnAddress}.`;
      uiState.lastActionTone = "bio";
      renderPage(pageState);
    } catch {
      uiState.lastActionMessage = "Unable to copy the burn address.";
      uiState.lastActionTone = "warn";
      renderPage(pageState);
    }
  });

  document.getElementById("burn-amount")?.addEventListener("input", (event) => {
    uiState.burnAmountInput = event.currentTarget.value;
    pageState = buildState({
      prices: state.prices,
      burnState: state.burnState,
      treasuryAccount: state.treasuryAccount,
      trenchState: state.trenchState,
      wallet: state.wallet,
    }, state.hydrationMode);
    renderPage(pageState);
  });

  document.querySelectorAll("[data-burn-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const walletMax = getWalletMaxBurn(state.wallet);
      if (walletMax <= 0) {
        return;
      }

      const preset = button.dataset.burnPreset;
      const nextAmount = preset === "max" ? walletMax : walletMax * Number(preset);
      uiState.burnAmountInput = trimTokenInput(nextAmount);
      pageState = buildState({
        prices: state.prices,
        burnState: state.burnState,
        treasuryAccount: state.treasuryAccount,
        trenchState: state.trenchState,
        wallet: state.wallet,
      }, state.hydrationMode);
      renderPage(pageState);
    });
  });

  document.getElementById("burn-submit")?.addEventListener("click", async () => {
    if (!uiState.auth?.authenticated || !uiState.auth.identity) {
      uiState.lastActionMessage = "Connect Internet Identity before using the native burn rail.";
      uiState.lastActionTone = "warn";
      renderPage(pageState);
      return;
    }

    uiState.busyAction = "burn";
    renderPage(pageState);

    try {
      const amountE8s = parseBurnAmountInput(uiState.burnAmountInput || state.consoleAmount, BURN_DECIMALS);
      const result = await executeBurnTransfer({
        identity: uiState.auth.identity,
        amountE8s,
      });

      uiState.lastTxIndex = result.txIndex.toString();
      uiState.lastActionMessage = `Burn submitted at block ${result.txIndex.toString()}.`;
      uiState.lastActionTone = "live";
      uiState.burnAmountInput = "";
      await hydrate(true);
    } catch (error) {
      uiState.lastActionMessage = error?.message || "The burn failed.";
      uiState.lastActionTone = "warn";
      renderPage(pageState);
    } finally {
      uiState.busyAction = "";
      renderPage(pageState);
    }
  });

  attachScenarioStudio(APP, async (action) => {
    if (action?.type === "refresh" || action?.type === "clear-cache") {
      if (action.type === "clear-cache") {
        window.localStorage.removeItem(`mgsn-view-cache:${CACHE_KEY}`);
      }
      await hydrate(true);
      return;
    }

    pageState = buildState({
      prices: state.prices,
      burnState: state.burnState,
      treasuryAccount: state.treasuryAccount,
      trenchState: state.trenchState,
      wallet: state.wallet,
    }, state.hydrationMode);
    renderPage(pageState);
  });
}

function renderPage(state) {
  pageState = state;
  APP.innerHTML = buildHtml(state);
  renderMilestoneChart(state);
  renderVelocityChart(state);
  attachInteractions(state);
}

async function hydrate(force = false) {
  if (liveRefreshInFlight) {
    return;
  }

  liveRefreshInFlight = true;
  try {
    const identity = uiState.auth?.authenticated ? uiState.auth.identity : null;
    const liveData = await fetchBurnSuiteData({
      force,
      identity,
      includeProtocol: true,
      includeWallet: !!identity,
    });

    writeViewCache(CACHE_KEY, {
      prices: liveData.prices,
      burnState: liveData.burnState,
      treasuryAccount: liveData.treasuryAccount,
      trenchState: liveData.trenchState,
    });

    renderPage(buildState(liveData, "live"));
  } finally {
    liveRefreshInFlight = false;
  }
}

async function bootstrap() {
  uiState.auth = await getAuthState();

  const cached = readViewCache(CACHE_KEY);
  const initialState = buildState(
    cached
      ? { ...cached, wallet: null }
      : fallbackPublicData(),
    cached ? "cached" : "loading"
  );

  renderPage(initialState);

  subscribeAuth((state) => {
    uiState.auth = state;
    void hydrate(true);
  });

  await hydrate();
  window.setInterval(() => {
    void hydrate(true);
  }, 60_000);
}

void bootstrap();
