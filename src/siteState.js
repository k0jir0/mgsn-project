import { BURN_PROGRAM } from "./demoData.js";

const SCENARIO_KEY = "mgsn-scenario-v2";
const CACHE_PREFIX = "mgsn-view-cache:";

const DEFAULT_SCENARIO_STATE = Object.freeze({
  controlsOpen: false,
  portfolioHoldings: 1_000_000,
  portfolioAvgCost: 0.000014,
  simulatedBurnAmount: 100_000,
});

function hasWindow() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function reviveJson(_, value) {
  if (value && typeof value === "object" && value.__bigint__ != null) {
    return BigInt(value.__bigint__);
  }
  return value;
}

function replaceJson(_, value) {
  if (typeof value === "bigint") {
    return { __bigint__: value.toString() };
  }
  return value;
}

function optionalNumber(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function scenarioFrom(input = {}) {
  return {
    controlsOpen: !!input.controlsOpen,
    portfolioHoldings: Math.max(0, optionalNumber(input.portfolioHoldings, DEFAULT_SCENARIO_STATE.portfolioHoldings)),
    portfolioAvgCost: Math.max(0, optionalNumber(input.portfolioAvgCost, DEFAULT_SCENARIO_STATE.portfolioAvgCost)),
    simulatedBurnAmount: Math.max(0, optionalNumber(input.simulatedBurnAmount, DEFAULT_SCENARIO_STATE.simulatedBurnAmount)),
  };
}

function sourceChip(kind, label) {
  return `<span class="studio-chip studio-chip--${kind}">${label}</span>`;
}

export function formatUpdatedAt(updatedAt) {
  if (updatedAt == null) return "--";
  try {
    const millis = typeof updatedAt === "bigint"
      ? Number(updatedAt / 1_000_000n)
      : Math.floor(Number(updatedAt) / 1_000_000);
    return new Date(millis).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    });
  } catch {
    return "--";
  }
}

export function loadScenarioState() {
  if (!hasWindow()) return { ...DEFAULT_SCENARIO_STATE };

  try {
    const raw = window.localStorage.getItem(SCENARIO_KEY);
    if (!raw) return { ...DEFAULT_SCENARIO_STATE };
    return scenarioFrom(JSON.parse(raw, reviveJson));
  } catch {
    return { ...DEFAULT_SCENARIO_STATE };
  }
}

export function saveScenarioState(nextState) {
  const normalized = scenarioFrom(nextState);
  if (hasWindow()) {
    try {
      window.localStorage.setItem(SCENARIO_KEY, JSON.stringify(normalized, replaceJson));
    } catch {
      // Ignore storage failures.
    }
  }
  return normalized;
}

export function clearScenarioState() {
  return saveScenarioState(DEFAULT_SCENARIO_STATE);
}

function clearAllViewCaches() {
  if (!hasWindow()) return;

  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(CACHE_PREFIX))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Ignore storage failures.
  }
}

export function readViewCache(key, maxAgeMs = 6 * 60 * 60 * 1000) {
  if (!hasWindow()) return null;

  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw, reviveJson);
    if (!parsed?.storedAt || Date.now() - parsed.storedAt > maxAgeMs) {
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

export function writeViewCache(key, value) {
  if (!hasWindow()) return;

  try {
    window.localStorage.setItem(
      `${CACHE_PREFIX}${key}`,
      JSON.stringify({ storedAt: Date.now(), value }, replaceJson)
    );
  } catch {
    // Ignore storage failures.
  }
}

export function buildDataStatusHTML({
  hydration = "live",
  updatedAt = null,
  chips = [],
} = {}) {
  const hydrationChip =
    hydration === "live"
      ? sourceChip("live", "Live refresh")
      : hydration === "loading"
        ? sourceChip("cache", "Loading live data")
      : hydration === "cached"
        ? sourceChip("cache", "Cached first paint")
        : hydration === "fallback"
          ? sourceChip("fallback", "Live data unavailable")
          : sourceChip("fallback", "Live data unavailable");

  const renderedChips = [hydrationChip, ...chips].join("");
  const updatedLabel = updatedAt != null && hydration !== "loading"
    ? `<span class="studio-status-time">As of ${formatUpdatedAt(updatedAt)}</span>`
    : "";

  return `
    <div class="studio-status-row">
      <div class="studio-status-chips">${renderedChips}</div>
      ${updatedLabel}
    </div>`;
}

export function buildScenarioStudioHTML({
  heading = "Live Controls",
  description = "Open the drawer to refresh live data, clear cached first-paint state, or update local calculator defaults.",
  note = "These inputs only prefill calculators on this browser. Market, pool, buyback, staking, and burn state stay locked to live ICPSwap and on-chain sources.",
} = {}) {
  const state = loadScenarioState();
  const controlsState = state.controlsOpen ? "true" : "false";
  return `
    <section class="studio-section" data-studio-root>
      <div class="studio-shell">
        <button
          class="studio-tab"
          type="button"
          data-studio-action="toggle"
          aria-expanded="${controlsState}"
        >
          <span class="studio-tab-copy">
            <span class="studio-eyebrow">Live-only site controls</span>
            <span class="studio-title">${heading}</span>
            <span class="studio-copy">${description}</span>
          </span>
          <span class="studio-tab-meta">${state.controlsOpen ? "Collapse" : "Open"}</span>
        </button>
        <div class="studio-panel" data-studio-panel${state.controlsOpen ? "" : " hidden"}>
          <div class="studio-head">
            <div>
              <p class="studio-eyebrow">Local calculator defaults</p>
              <p class="studio-copy">${note}</p>
            </div>
            <div class="studio-head-chips">
              ${sourceChip("live", "Live-only data")}
              ${sourceChip("cache", "Refresh available")}
            </div>
          </div>
          <div class="studio-grid" data-studio-form>
            <label class="studio-field">
              <span class="studio-label">Portfolio holdings</span>
              <input class="studio-input" type="number" min="0" step="100000" data-studio-field="portfolioHoldings" value="${state.portfolioHoldings}">
              <span class="studio-help">Prefills the strategy portfolio calculator on this device only.</span>
            </label>
            <label class="studio-field">
              <span class="studio-label">Portfolio avg cost</span>
              <input class="studio-input" type="number" min="0" step="0.000001" data-studio-field="portfolioAvgCost" value="${state.portfolioAvgCost}">
              <span class="studio-help">Used for your personal P&amp;L modeling only.</span>
            </label>
            <label class="studio-field">
              <span class="studio-label">Burn calculator default</span>
              <input class="studio-input" type="number" min="0" step="10000" data-studio-field="simulatedBurnAmount" value="${state.simulatedBurnAmount}">
              <span class="studio-help">Seeds the burn impact calculator without altering live burn totals.</span>
            </label>
            <div class="studio-field studio-field--static">
              <span class="studio-label">Market data policy</span>
              <p class="studio-help">Price, liquidity, volume, buyback, staking, and burn status cannot be overridden here. This drawer only manages refresh behavior and local input defaults.</p>
            </div>
          </div>
          <div class="studio-actions">
            <button class="studio-btn studio-btn--primary" type="button" data-studio-action="save">Save defaults</button>
            <button class="studio-btn" type="button" data-studio-action="refresh">Refresh live data</button>
            <button class="studio-btn" type="button" data-studio-action="clear-cache">Clear cached data</button>
            <button class="studio-btn" type="button" data-studio-action="reset">Reset defaults</button>
          </div>
        </div>
      </div>
    </section>`;
}

const SCENARIO_HEADER_CONTENT = Object.freeze({
  dashboard: {
    heading: "Dashboard Live Controls",
    description: "Refresh the live dashboard feed or clear cached first-paint state without opening developer tools.",
    note: "Use this drawer to refresh market data or adjust your local calculator defaults. Dashboard prices and history stay tied to live ICPSwap and ledger reads.",
  },
  strategy: {
    heading: "Strategy Live Controls",
    description: "Refresh live prices and keep your local portfolio defaults synced into the strategy calculators.",
    note: "These defaults only affect your local calculators. Signal inputs, LP stats, and charts still come from live ICPSwap data.",
  },
  buyback: {
    heading: "Buyback Live Controls",
    description: "Refresh the vault status and pool-derived calculator inputs from the current live sources.",
    note: "Buyback history is limited to verifiable public vault activity and live pool data. This drawer does not create simulated fills.",
  },
  staking: {
    heading: "Staking Live Controls",
    description: "Refresh the live staking status and keep your local calculator defaults available inside the estimator.",
    note: "Reward estimates use live pool activity when available. Position state is shown only when the public staking program exposes real data.",
  },
  burn: {
    heading: "Burn Live Controls",
    description: "Refresh ledger-indexed burn history and adjust the default amount used in the burn impact calculator.",
    note: "The burn leaderboard and totals stay ledger-indexed. Only the calculator default is stored locally here.",
  },
});

export function buildScenarioHeaderHTML(pageKey, statusHtml = "", overrides = {}) {
  const content = {
    ...(SCENARIO_HEADER_CONTENT[pageKey] ?? SCENARIO_HEADER_CONTENT.dashboard),
    ...overrides,
  };

  return `
    <section class="scenario-header" data-scenario-header="${pageKey}">
      ${statusHtml}
      ${buildScenarioStudioHTML(content)}
    </section>`;
}

function collectScenarioState(root) {
  const next = { ...loadScenarioState() };
  root.querySelectorAll("[data-studio-field]").forEach((input) => {
    const field = input.dataset.studioField;
    if (input.type === "checkbox") next[field] = input.checked;
    else next[field] = input.value;
  });
  return scenarioFrom(next);
}

export function attachScenarioStudio(root, onApply) {
  const studioRoot = root.querySelector("[data-studio-root]");
  if (!studioRoot) return;
  const panel = studioRoot.querySelector("[data-studio-panel]");
  const toggleButton = studioRoot.querySelector('[data-studio-action="toggle"]');

  function dispatch(action) {
    onApply?.(action);
  }

  toggleButton?.addEventListener("click", () => {
    const nextState = saveScenarioState({
      ...loadScenarioState(),
      controlsOpen: !loadScenarioState().controlsOpen,
    });
    const expanded = nextState.controlsOpen;
    toggleButton.setAttribute("aria-expanded", expanded ? "true" : "false");
    const meta = toggleButton.querySelector(".studio-tab-meta");
    if (meta) meta.textContent = expanded ? "Collapse" : "Open";
    if (panel) panel.hidden = !expanded;
  });

  studioRoot.querySelector('[data-studio-action="save"]')?.addEventListener("click", () => {
    dispatch({ type: "save", state: saveScenarioState(collectScenarioState(studioRoot)) });
  });

  studioRoot.querySelector('[data-studio-action="refresh"]')?.addEventListener("click", () => {
    dispatch({ type: "refresh", state: loadScenarioState() });
  });

  studioRoot.querySelector('[data-studio-action="clear-cache"]')?.addEventListener("click", () => {
    clearAllViewCaches();
    dispatch({ type: "clear-cache", state: loadScenarioState() });
  });

  studioRoot.querySelector('[data-studio-action="reset"]')?.addEventListener("click", () => {
    dispatch({ type: "reset", state: clearScenarioState() });
  });
}

export function applyScenarioToDashboard(dashboard, scenario = loadScenarioState()) {
  void scenario;
  return {
    ...dashboard,
    timeline: (dashboard?.timeline ?? []).map((point) => ({ ...point })),
    marketStats: { ...(dashboard?.marketStats ?? {}) },
  };
}

export function applyScenarioToPrices(prices = {}, scenario = loadScenarioState()) {
  void scenario;
  return {
    ...prices,
  };
}

export function applyScenarioToPoolStats(poolStats = {}, scenario = loadScenarioState()) {
  void scenario;
  return { ...poolStats };
}

export function buildSimulatedBuybackState(
  currentSupply = null,
  mgsnUsd = null,
  scenario = loadScenarioState()
) {
  void currentSupply;
  void mgsnUsd;
  void scenario;
  return null;
}

export function buildSimulatedStakingState(
  currentSupply = null,
  scenario = loadScenarioState()
) {
  void currentSupply;
  void scenario;
  return null;
}

export function getPortfolioDefaults(scenario = loadScenarioState()) {
  return {
    holdings: scenario.portfolioHoldings,
    avgCost: scenario.portfolioAvgCost,
  };
}

export function getBurnScenarioAmount(scenario = loadScenarioState()) {
  return Math.max(0, scenario.simulatedBurnAmount);
}

export function buildDashboardSourceChips(dashboard, scenario, hydration, options = {}) {
  void scenario;
  const { hasPartialLiveData = false } = options;
  const chips = [];
  if (dashboard.marketStats?.historyStartLabel) {
    chips.push(sourceChip("live", "ICPSwap history"));
  } else if (hydration === "loading") {
    chips.push(sourceChip("cache", "Loading history"));
  } else if (hydration === "cached") {
    if (hasPartialLiveData) {
      chips.push(sourceChip("live", "Spot + pool loaded"));
    }
    chips.push(sourceChip("cache", "Refreshing history"));
  } else if (hasPartialLiveData) {
    chips.push(sourceChip("live", "Spot + pool loaded"));
    chips.push(sourceChip("fallback", "History unavailable"));
  } else {
    chips.push(sourceChip("fallback", "History unavailable"));
  }
  return buildDataStatusHTML({
    hydration,
    updatedAt: dashboard.updatedAt,
    chips,
  });
}

export function buildBuybackSourceChips(buybackState, scenario, hydration) {
  void scenario;
  const chips = [];
  if (buybackState?.status === "unconfigured") chips.push(sourceChip("projected", "Vault not published"));
  else if (buybackState?.status === "unavailable") chips.push(sourceChip("fallback", "Ledger scan unavailable"));
  else chips.push(sourceChip("live", "On-chain ledger scan"));
  if ((buybackState?.log ?? []).some((entry) => entry.usdBasis === "estimated_pool_snapshot")) {
    chips.push(sourceChip("projected", "USD valued from live pool snapshots"));
  }
  return buildDataStatusHTML({
    hydration,
    updatedAt: BigInt(Date.now()) * 1_000_000n,
    chips,
  });
}

export function buildStakingSourceChips(stakingState, scenario, hydration) {
  void scenario;
  const chips = [];
  if (stakingState?.status === "live") chips.push(sourceChip("live", "On-chain staking state"));
  else if (stakingState?.status === "configured") chips.push(sourceChip("projected", "Canister published"));
  else chips.push(sourceChip("fallback", "Live staking state unavailable"));
  return buildDataStatusHTML({
    hydration,
    updatedAt: BigInt(Date.now()) * 1_000_000n,
    chips,
  });
}

export function buildBurnSourceChips(metrics, scenario, hydration) {
  void metrics;
  void scenario;
  const chips = [sourceChip("live", "Ledger-indexed burns"), sourceChip("projected", "Modeled impact calculator")];
  return buildDataStatusHTML({
    hydration,
    updatedAt: BigInt(Date.now()) * 1_000_000n,
    chips,
  });
}

export const STUDIO_CONSTANTS = { BURN_PROGRAM };
