import "./styles.css";
import "./burnHub.css";
import { getAuthState, login, logout, subscribeAuth } from "./auth.js";
import {
  buildBurnHubNavHTML,
  buildBurnScenario,
  deriveBurnMetrics,
  escapeHtml,
  fetchBurnSuiteData,
  formatCompactNumber,
  formatMoney,
  formatPercent,
  shortenAddress,
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
const CACHE_KEY = "burn-lab-live-v1";
const BURN_DECIMALS = 8;
let refreshInFlight = false;
let pageState = null;
const uiState = {
  auth: null,
  amountInput: "",
  busyAction: "",
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
    wallet: null,
  };
}

function e8sToTokens(raw) {
  if (raw == null) {
    return 0;
  }

  const numeric = typeof raw === "bigint" ? Number(raw) : Number(raw);
  return Number.isFinite(numeric) ? numeric / 10 ** BURN_DECIMALS : 0;
}

function trimTokenInput(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }
  return numeric.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function walletMaxBurn(wallet) {
  if (!wallet?.balanceE8s || wallet.feeE8s == null) {
    return 0;
  }
  const max = wallet.balanceE8s - wallet.feeE8s;
  return max > 0n ? e8sToTokens(max) : 0;
}

function buildState(raw, hydrationMode) {
  const merged = {
    ...fallbackPublicData(),
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
  const inputAmount = uiState.amountInput || trimTokenInput(Math.min(walletMaxBurn(merged.wallet) || getBurnScenarioAmount(), getBurnScenarioAmount()));
  const scenario = buildBurnScenario(metrics, Number(inputAmount || 0));
  const plannerBase = merged.wallet ? walletMaxBurn(merged.wallet) : Math.max(Number(inputAmount || 0), getBurnScenarioAmount());

  return {
    ...merged,
    hydrationMode,
    metrics,
    inputAmount,
    scenario,
    planner: {
      base: plannerBase,
      burn: plannerBase * 0.5,
      lock: plannerBase * 0.3,
      keep: plannerBase * 0.2,
    },
  };
}

function buildHtml(state) {
  const connected = !!uiState.auth?.authenticated && !!state.wallet;
  const scarcityMultiple =
    state.scenario.nextCurrentSupply != null &&
    state.metrics.currentSupply != null &&
    state.scenario.nextCurrentSupply > 0
      ? state.metrics.currentSupply / state.scenario.nextCurrentSupply
      : null;

  return `
    ${buildPlatformHeaderHTML({
      activePage: "burn",
      badgeText: "Burn lab",
      priceLabel: "MGSN/USD",
      priceValue: state.prices?.mgsnUsd != null ? formatMoney(state.prices.mgsnUsd, 7) : "Unavailable",
      priceClass: state.prices?.mgsnUsd != null ? "live" : "",
    })}

    <div class="burn-shell">
      ${buildScenarioHeaderHTML("burn", buildBurnSourceChips(state.metrics, loadScenarioState(), state.hydrationMode))}
      ${buildBurnHubNavHTML("burn-lab")}

      <section class="burn-hero">
        <div class="burn-hero-copy">
          <span class="burn-kicker">Planner</span>
          <h1 class="burn-title">Burn Lab</h1>
          <p class="burn-copy">A harder planning surface for burners. This page drops the big emotional copy and stays on direct outputs: supply compression, milestone distance, and projected leaderboard movement.</p>
          <div class="burn-stat-grid">
            <article class="burn-stat">
              <span class="burn-stat-label">Scenario amount</span>
              <span class="burn-stat-value">${state.inputAmount || "0"} MGSN</span>
              <p class="burn-stat-copy">The amount currently loaded into the lab.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">% of original supply</span>
              <span class="burn-stat-value">${state.scenario.pctOfSupply != null ? formatPercent(state.scenario.pctOfSupply, 6) : "Unavailable"}</span>
              <p class="burn-stat-copy">Direct supply share removed by the scenario.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">After burn retired</span>
              <span class="burn-stat-value">${state.scenario.nextPctBurned != null ? formatPercent(state.scenario.nextPctBurned, 4) : "Unavailable"}</span>
              <p class="burn-stat-copy">Projected total retired after the scenario amount.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">To next milestone</span>
              <span class="burn-stat-value">${state.scenario.toNextMilestone != null ? `${formatCompactNumber(state.scenario.toNextMilestone)} MGSN` : "Milestone cleared"}</span>
              <p class="burn-stat-copy">${state.metrics.nextMilestone ? `${state.metrics.nextMilestone.badge} is the next published badge.` : "Every published milestone is already cleared."}</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Projected rank</span>
              <span class="burn-stat-value">${state.scenario.projectedRank != null ? `#${state.scenario.projectedRank}` : connected ? "No live rank" : "Connect II"}</span>
              <p class="burn-stat-copy">${state.scenario.rankImprovement != null ? `${state.scenario.rankImprovement > 0 ? `Up ${state.scenario.rankImprovement} slot${state.scenario.rankImprovement === 1 ? "" : "s"}` : "No rank movement yet"}.` : "Rank projection appears when the current II principal already has board context."}</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Supply compression</span>
              <span class="burn-stat-value">${scarcityMultiple != null ? `${scarcityMultiple.toFixed(5)}x` : "Unavailable"}</span>
              <p class="burn-stat-copy">Current supply divided by projected post-burn supply.</p>
            </article>
          </div>
        </div>
        <aside class="burn-console">
          <div class="burn-console-head">
            <div>
              <h2 class="burn-console-title">Lab controls</h2>
              <p class="burn-console-subtitle">Connect II for wallet-aware presets or stay manual for pure planning.</p>
            </div>
            <span class="burn-auth-chip${connected ? " live" : ""}">
              ${connected ? "Wallet aware" : "Manual planning"}
            </span>
          </div>
          <label class="burn-row" for="burn-lab-amount">
            <input id="burn-lab-amount" class="burn-input" type="number" min="0" step="0.00000001" value="${escapeHtml(state.inputAmount)}" />
          </label>
          <div class="burn-balance-rail">
            <span>${connected ? `II principal ${escapeHtml(shortenAddress(uiState.auth.principal, 10, 8))}` : "Manual mode active"}</span>
            <span>${connected ? `Max burnable ${walletMaxBurn(state.wallet).toFixed(4)} MGSN` : "Wallet presets unlock after authentication"}</span>
          </div>
          <div class="burn-action-row">
            <button class="burn-btn burn-btn-secondary" type="button" data-lab-preset="0.1"${walletMaxBurn(state.wallet) <= 0 ? " disabled" : ""}>10%</button>
            <button class="burn-btn burn-btn-secondary" type="button" data-lab-preset="0.25"${walletMaxBurn(state.wallet) <= 0 ? " disabled" : ""}>25%</button>
            <button class="burn-btn burn-btn-secondary" type="button" data-lab-preset="0.5"${walletMaxBurn(state.wallet) <= 0 ? " disabled" : ""}>50%</button>
            <button class="burn-btn burn-btn-ghost" type="button" data-lab-preset="max"${walletMaxBurn(state.wallet) <= 0 ? " disabled" : ""}>Max</button>
          </div>
          <div class="burn-action-row">
            ${uiState.auth?.authenticated
              ? `<button id="lab-logout" class="burn-btn burn-btn-secondary" type="button"${uiState.busyAction === "auth" ? " disabled" : ""}>Disconnect</button>`
              : `<button id="lab-login" class="burn-btn burn-btn-primary" type="button"${uiState.busyAction === "auth" ? " disabled" : ""}>Connect Internet Identity</button>`}
            <button id="lab-refresh" class="burn-btn burn-btn-secondary" type="button"${refreshInFlight ? " disabled" : ""}>${refreshInFlight ? "Refreshing..." : "Refresh data"}</button>
          </div>
        </aside>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Pressure bundle</h2>
        <p class="burn-section-copy">A simple burn / lock / keep split using the current wallet max when available, or the current scenario amount as the planning basis.</p>
        <div class="burn-proof-grid">
          <article class="burn-card">
            <span class="burn-panel-label">50% burn</span>
            <span class="burn-panel-value">${state.planner.burn.toFixed(4)} MGSN</span>
            <p class="burn-panel-copy">Immediate scarcity pressure.</p>
          </article>
          <article class="burn-card">
            <span class="burn-panel-label">30% lock later</span>
            <span class="burn-panel-value">${state.planner.lock.toFixed(4)} MGSN</span>
            <p class="burn-panel-copy">Reserved for the lock rail or a later conviction move.</p>
          </article>
          <article class="burn-card">
            <span class="burn-panel-label">20% keep liquid</span>
            <span class="burn-panel-value">${state.planner.keep.toFixed(4)} MGSN</span>
            <p class="burn-panel-copy">Dry powder for future burns, trenches, or exits.</p>
          </article>
        </div>
      </section>
    </div>`;
}

function renderPage(state) {
  pageState = state;
  APP.innerHTML = buildHtml(state);

  document.getElementById("burn-lab-amount")?.addEventListener("input", (event) => {
    uiState.amountInput = event.currentTarget.value;
    renderPage(buildState({
      prices: state.prices,
      burnState: state.burnState,
      treasuryAccount: state.treasuryAccount,
      trenchState: state.trenchState,
      wallet: state.wallet,
    }, state.hydrationMode));
  });

  document.querySelectorAll("[data-lab-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const max = walletMaxBurn(state.wallet);
      if (max <= 0) {
        return;
      }
      const preset = button.dataset.labPreset;
      uiState.amountInput = trimTokenInput(preset === "max" ? max : max * Number(preset));
      renderPage(buildState({
        prices: state.prices,
        burnState: state.burnState,
        treasuryAccount: state.treasuryAccount,
        trenchState: state.trenchState,
        wallet: state.wallet,
      }, state.hydrationMode));
    });
  });

  document.getElementById("lab-login")?.addEventListener("click", async () => {
    uiState.busyAction = "auth";
    renderPage(pageState);
    try {
      uiState.auth = await login();
      await hydrate(true);
    } finally {
      uiState.busyAction = "";
      renderPage(pageState);
    }
  });

  document.getElementById("lab-logout")?.addEventListener("click", async () => {
    uiState.busyAction = "auth";
    renderPage(pageState);
    try {
      uiState.auth = await logout();
      await hydrate(true);
    } finally {
      uiState.busyAction = "";
      renderPage(pageState);
    }
  });

  document.getElementById("lab-refresh")?.addEventListener("click", () => {
    void hydrate(true);
  });

  attachScenarioStudio(APP, async (action) => {
    if (action?.type === "refresh" || action?.type === "clear-cache") {
      if (action.type === "clear-cache") {
        window.localStorage.removeItem(`mgsn-view-cache:${CACHE_KEY}`);
      }
      await hydrate(true);
      return;
    }

    renderPage(buildState({
      prices: state.prices,
      burnState: state.burnState,
      treasuryAccount: state.treasuryAccount,
      trenchState: state.trenchState,
      wallet: state.wallet,
    }, state.hydrationMode));
  });
}

async function hydrate(force = false) {
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;
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
    refreshInFlight = false;
  }
}

async function bootstrap() {
  uiState.auth = await getAuthState();
  const cached = readViewCache(CACHE_KEY);
  renderPage(buildState(cached ? { ...cached, wallet: null } : fallbackPublicData(), cached ? "cached" : "loading"));
  subscribeAuth((state) => {
    uiState.auth = state;
    void hydrate(true);
  });
  await hydrate();
}

void bootstrap();
