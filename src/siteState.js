import {
  BURN_PROGRAM,
  BUYBACK_PROGRAM,
  STAKING_PROGRAM,
  demoDashboard,
} from "./demoData.js";

const SCENARIO_KEY = "mgsn-scenario-v2";
const CACHE_PREFIX = "mgsn-view-cache:";

const DEFAULT_SCENARIO_STATE = Object.freeze({
  demoMode: false,
  priceMgsnUsd: null,
  priceBobUsd: null,
  priceIcpUsd: null,
  monthlyVolumeUsd: null,
  poolLiquidityUsd: null,
  portfolioHoldings: 1_000_000,
  portfolioAvgCost: 0.000014,
  simulatedBuybackUsd: 1_800,
  simulatedBuybackCount: 4,
  simulatedStakedMgsn: 125_000_000,
  simulatedBurnAmount: 5_000_000,
});

const SHOWCASE_SCENARIO_STATE = Object.freeze({
  demoMode: true,
  priceMgsnUsd: 0.000022,
  priceBobUsd: 0.315,
  priceIcpUsd: 4.85,
  monthlyVolumeUsd: 860_000,
  poolLiquidityUsd: 190_000,
  portfolioHoldings: 5_000_000,
  portfolioAvgCost: 0.0000132,
  simulatedBuybackUsd: 1_800,
  simulatedBuybackCount: 4,
  simulatedStakedMgsn: 125_000_000,
  simulatedBurnAmount: 5_000_000,
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

function positiveWholeNumber(value, fallback) {
  const num = optionalNumber(value, fallback);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.round(num));
}

function scenarioFrom(input = {}) {
  return {
    demoMode: !!input.demoMode,
    priceMgsnUsd: optionalNumber(input.priceMgsnUsd),
    priceBobUsd: optionalNumber(input.priceBobUsd),
    priceIcpUsd: optionalNumber(input.priceIcpUsd),
    monthlyVolumeUsd: optionalNumber(input.monthlyVolumeUsd),
    poolLiquidityUsd: optionalNumber(input.poolLiquidityUsd),
    portfolioHoldings: Math.max(0, optionalNumber(input.portfolioHoldings, DEFAULT_SCENARIO_STATE.portfolioHoldings)),
    portfolioAvgCost: Math.max(0, optionalNumber(input.portfolioAvgCost, DEFAULT_SCENARIO_STATE.portfolioAvgCost)),
    simulatedBuybackUsd: Math.max(0, optionalNumber(input.simulatedBuybackUsd, DEFAULT_SCENARIO_STATE.simulatedBuybackUsd)),
    simulatedBuybackCount: positiveWholeNumber(input.simulatedBuybackCount, DEFAULT_SCENARIO_STATE.simulatedBuybackCount),
    simulatedStakedMgsn: Math.max(0, optionalNumber(input.simulatedStakedMgsn, DEFAULT_SCENARIO_STATE.simulatedStakedMgsn)),
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

export function loadShowcaseScenario() {
  return saveScenarioState(SHOWCASE_SCENARIO_STATE);
}

export function clearScenarioState() {
  return saveScenarioState(DEFAULT_SCENARIO_STATE);
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
      : hydration === "cached"
        ? sourceChip("cache", "Cached first paint")
        : hydration === "fallback"
          ? sourceChip("fallback", "Fallback snapshot")
          : sourceChip("demo", "Scenario showcase");

  const renderedChips = [hydrationChip, ...chips].join("");
  const updatedLabel = updatedAt != null
    ? `<span class="studio-status-time">As of ${formatUpdatedAt(updatedAt)}</span>`
    : "";

  return `
    <div class="studio-status-row">
      <div class="studio-status-chips">${renderedChips}</div>
      ${updatedLabel}
    </div>`;
}

export function buildScenarioStudioHTML({
  heading = "Scenario Studio",
  description = "Shared demo controls saved across all MGSN pages.",
  note = "Use live mode for real canister data, or enable the showcase to demonstrate the full tokenomics stack.",
} = {}) {
  const state = loadScenarioState();
  return `
    <section class="studio-section" data-studio-root>
      <div class="studio-shell">
        <div class="studio-head">
          <div>
            <p class="studio-eyebrow">Shared Demo Controls</p>
            <h3 class="studio-title">${heading}</h3>
            <p class="studio-copy">${description}</p>
          </div>
          <div class="studio-head-chips">
            ${state.demoMode ? sourceChip("demo", "Showcase active") : sourceChip("live", "Live mode")}
            ${sourceChip("projected", "Overrides are clearly labeled")}
          </div>
        </div>
        <div class="studio-grid" data-studio-form>
          <label class="studio-field studio-field--toggle">
            <span class="studio-label">Demo showcase</span>
            <input type="checkbox" data-studio-field="demoMode"${state.demoMode ? " checked" : ""}>
            <span class="studio-help">Turns on simulated buyback and staking records while keeping burn data live.</span>
          </label>
          <label class="studio-field">
            <span class="studio-label">MGSN / USD</span>
            <input class="studio-input" type="number" min="0" step="0.000001" data-studio-field="priceMgsnUsd" value="${state.priceMgsnUsd ?? ""}">
          </label>
          <label class="studio-field">
            <span class="studio-label">BOB / USD</span>
            <input class="studio-input" type="number" min="0" step="0.0001" data-studio-field="priceBobUsd" value="${state.priceBobUsd ?? ""}">
          </label>
          <label class="studio-field">
            <span class="studio-label">ICP / USD</span>
            <input class="studio-input" type="number" min="0" step="0.01" data-studio-field="priceIcpUsd" value="${state.priceIcpUsd ?? ""}">
          </label>
          <label class="studio-field">
            <span class="studio-label">30d MGSN volume (USD)</span>
            <input class="studio-input" type="number" min="0" step="1000" data-studio-field="monthlyVolumeUsd" value="${state.monthlyVolumeUsd ?? ""}">
          </label>
          <label class="studio-field">
            <span class="studio-label">Pool liquidity (USD)</span>
            <input class="studio-input" type="number" min="0" step="1000" data-studio-field="poolLiquidityUsd" value="${state.poolLiquidityUsd ?? ""}">
          </label>
          <label class="studio-field">
            <span class="studio-label">Portfolio holdings</span>
            <input class="studio-input" type="number" min="0" step="100000" data-studio-field="portfolioHoldings" value="${state.portfolioHoldings}">
          </label>
          <label class="studio-field">
            <span class="studio-label">Portfolio avg cost</span>
            <input class="studio-input" type="number" min="0" step="0.000001" data-studio-field="portfolioAvgCost" value="${state.portfolioAvgCost}">
          </label>
          <label class="studio-field">
            <span class="studio-label">Demo buyback / month (USD)</span>
            <input class="studio-input" type="number" min="0" step="100" data-studio-field="simulatedBuybackUsd" value="${state.simulatedBuybackUsd}">
          </label>
          <label class="studio-field">
            <span class="studio-label">Demo buyback count</span>
            <input class="studio-input" type="number" min="1" step="1" data-studio-field="simulatedBuybackCount" value="${state.simulatedBuybackCount}">
          </label>
          <label class="studio-field">
            <span class="studio-label">Demo staked MGSN</span>
            <input class="studio-input" type="number" min="0" step="1000000" data-studio-field="simulatedStakedMgsn" value="${state.simulatedStakedMgsn}">
          </label>
          <label class="studio-field">
            <span class="studio-label">Default burn sim amount</span>
            <input class="studio-input" type="number" min="0" step="10000" data-studio-field="simulatedBurnAmount" value="${state.simulatedBurnAmount}">
          </label>
        </div>
        <div class="studio-actions">
          <button class="studio-btn studio-btn--primary" type="button" data-studio-action="apply">Apply Scenario</button>
          <button class="studio-btn" type="button" data-studio-action="showcase">Load Showcase</button>
          <button class="studio-btn" type="button" data-studio-action="live">Use Live Data</button>
          <button class="studio-btn" type="button" data-studio-action="reset">Reset Inputs</button>
        </div>
        <p class="studio-note">${note}</p>
      </div>
    </section>`;
}

const SCENARIO_HEADER_CONTENT = Object.freeze({
  dashboard: {
    heading: "Dashboard Demo Controls",
    description: "Scenario Studio persists across the whole site, so chart, strategy, buyback, staking, and burn assumptions stay in sync.",
    note: "Use the showcase preset to demonstrate the full product loop, or keep live mode enabled to inspect current ICPSwap and ledger-backed data.",
  },
  strategy: {
    heading: "Strategy Demo Controls",
    description: "Keep live chart history, but synchronize the signal engine, LP assumptions, and portfolio defaults with the same shared scenario state used everywhere else.",
    note: "Scenario Studio persists across the dashboard, strategy, buyback, staking, and burn pages so one showcase story stays internally consistent.",
  },
  buyback: {
    heading: "Buyback Demo Controls",
    description: "Use one shared showcase state to demonstrate launch-day buyback activity before the public vault address is published.",
    note: "Live ICPSwap volume still powers the calculator whenever it is available. Demo mode only simulates the execution history and hero totals.",
  },
  staking: {
    heading: "Staking Demo Controls",
    description: "Switch between live reward assumptions and a simulated staking book so the lock-tier experience is fully demonstrable.",
    note: "Until the public staking canister is published, Scenario Studio provides a clearly labeled simulated position book instead of pretending that empty arrays are live staking activity.",
  },
  burn: {
    heading: "Burn Demo Controls",
    description: "Keep the burn history live while synchronizing the burn simulator with the same cross-page scenario state.",
    note: "The burn leaderboard and totals remain ledger-indexed. Scenario Studio only controls the calculator defaults and any optional price overrides.",
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

  studioRoot.querySelector('[data-studio-action="apply"]')?.addEventListener("click", () => {
    onApply?.(saveScenarioState(collectScenarioState(studioRoot)));
  });

  studioRoot.querySelector('[data-studio-action="showcase"]')?.addEventListener("click", () => {
    onApply?.(loadShowcaseScenario());
  });

  studioRoot.querySelector('[data-studio-action="live"]')?.addEventListener("click", () => {
    const current = loadScenarioState();
    onApply?.(
      saveScenarioState({
        ...current,
        demoMode: false,
        priceMgsnUsd: null,
        priceBobUsd: null,
        priceIcpUsd: null,
        monthlyVolumeUsd: null,
        poolLiquidityUsd: null,
      })
    );
  });

  studioRoot.querySelector('[data-studio-action="reset"]')?.addEventListener("click", () => {
    onApply?.(clearScenarioState());
  });
}

export function applyScenarioToDashboard(dashboard, scenario = loadScenarioState()) {
  const next = {
    ...dashboard,
    timeline: (dashboard.timeline ?? []).map((point) => ({ ...point })),
    marketStats: { ...(dashboard.marketStats ?? {}) },
  };

  const livePoint = next.timeline.at(-1);
  if (livePoint) {
    if (scenario.priceIcpUsd != null) livePoint.icpPrice = scenario.priceIcpUsd;
    if (scenario.priceBobUsd != null) livePoint.bobPrice = scenario.priceBobUsd;
    if (scenario.priceMgsnUsd != null) livePoint.mgsnPrice = scenario.priceMgsnUsd;
    if (scenario.monthlyVolumeUsd != null) livePoint.mgsnVolume = scenario.monthlyVolumeUsd / 30;
  }

  if (scenario.priceIcpUsd != null) next.marketStats.icpSpotLive = true;
  if (scenario.monthlyVolumeUsd != null) next.marketStats.mgsnVol30d = scenario.monthlyVolumeUsd;
  if (scenario.poolLiquidityUsd != null) next.marketStats.totalLiquidityUsd = scenario.poolLiquidityUsd;
  if (scenario.demoMode) {
    next.heroNote = "Scenario Studio showcase active. Projected buyback and staking states are being demonstrated alongside live burn data.";
  }
  return next;
}

export function applyScenarioToPrices(prices = {}, scenario = loadScenarioState()) {
  return {
    ...prices,
    icpUsd: scenario.priceIcpUsd ?? prices.icpUsd ?? demoDashboard.timeline.at(-1)?.icpPrice ?? null,
    bobUsd: scenario.priceBobUsd ?? prices.bobUsd ?? demoDashboard.timeline.at(-1)?.bobPrice ?? null,
    mgsnUsd: scenario.priceMgsnUsd ?? prices.mgsnUsd ?? demoDashboard.timeline.at(-1)?.mgsnPrice ?? null,
  };
}

export function applyScenarioToPoolStats(poolStats = {}, scenario = loadScenarioState()) {
  const next = { ...poolStats };
  if (scenario.monthlyVolumeUsd != null) {
    next.mgsnVol30d = scenario.monthlyVolumeUsd;
    next.mgsnVol24h = scenario.monthlyVolumeUsd / 30;
  }
  if (scenario.poolLiquidityUsd != null) {
    next.mgsnLiq = scenario.poolLiquidityUsd;
  }
  return next;
}

function isoDateMonthsAgo(monthsAgo) {
  const dt = new Date();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() - monthsAgo);
  return dt.toISOString().slice(0, 10);
}

function compactAddress(seed) {
  return `demo${String(seed).padStart(2, "0")}-showcase-addr`;
}

export function buildSimulatedBuybackState(
  currentSupply = demoDashboard.mgsnSupply,
  mgsnUsd = demoDashboard.timeline.at(-1)?.mgsnPrice ?? 0.000014,
  scenario = loadScenarioState()
) {
  if (!scenario.demoMode) return null;

  const count = Math.max(1, scenario.simulatedBuybackCount);
  const usdPerBuyback = Math.max(0, scenario.simulatedBuybackUsd);
  const tokenPrice = Math.max(mgsnUsd, 0.0000001);
  const log = Array.from({ length: count }, (_, index) => ({
    date: isoDateMonthsAgo(count - index),
    usdSpent: usdPerBuyback,
    mgsnAcquired: usdPerBuyback / tokenPrice,
    txId: "",
    note: index === count - 1 ? "Scenario Studio showcase execution" : "Projected monthly buyback",
  }));
  const totalBurned = log.reduce((sum, item) => sum + item.mgsnAcquired, 0);

  return {
    status: "simulated",
    currentSupply: Math.max(currentSupply - totalBurned, 0),
    log,
    note: "Scenario Studio showcase: simulated buyback executions so the full launch UI can be demonstrated before the public vault address is published.",
  };
}

export function buildSimulatedStakingState(
  currentSupply = demoDashboard.mgsnSupply,
  scenario = loadScenarioState()
) {
  if (!scenario.demoMode) return null;

  const totalLocked = Math.max(0, scenario.simulatedStakedMgsn);
  const weights = [0.12, 0.18, 0.28, 0.42];
  const positions = STAKING_PROGRAM.tiers.map((tier, index) => {
    const amount = totalLocked * weights[index];
    const lockedDate = isoDateMonthsAgo(index + 1);
    const unlock = new Date(`${lockedDate}T00:00:00Z`);
    unlock.setUTCDate(unlock.getUTCDate() + tier.days);
    return {
      address: compactAddress(index + 1),
      mgsnLocked: amount,
      tier: tier.label,
      lockedDate,
      unlockDate: unlock.toISOString().slice(0, 10),
    };
  });

  return {
    status: "simulated",
    currentSupply,
    totalLocked,
    positions,
    note: "Scenario Studio showcase: simulated staking positions demonstrate the live UI while the public staking canister is still pending.",
  };
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

export function buildDashboardSourceChips(dashboard, scenario, hydration) {
  const chips = [];
  if (dashboard.marketStats?.historyStartLabel) {
    chips.push(sourceChip("live", "ICPSwap history"));
  } else {
    chips.push(sourceChip("fallback", "Fallback history"));
  }
  if (scenario.demoMode) chips.push(sourceChip("demo", "Demo showcase"));
  if (scenario.monthlyVolumeUsd != null || scenario.poolLiquidityUsd != null) {
    chips.push(sourceChip("projected", "Scenario overrides"));
  }
  return buildDataStatusHTML({
    hydration,
    updatedAt: dashboard.updatedAt,
    chips,
  });
}

export function buildBuybackSourceChips(buybackState, scenario, hydration) {
  const chips = [];
  if (buybackState?.status === "simulated") chips.push(sourceChip("demo", "Simulated buyback log"));
  else if (buybackState?.status === "unconfigured") chips.push(sourceChip("projected", "Vault not published"));
  else chips.push(sourceChip("live", "On-chain ledger scan"));
  if (scenario.monthlyVolumeUsd != null || scenario.poolLiquidityUsd != null) {
    chips.push(sourceChip("projected", "Scenario overrides"));
  }
  return buildDataStatusHTML({
    hydration,
    updatedAt: BigInt(Date.now()) * 1_000_000n,
    chips,
  });
}

export function buildStakingSourceChips(stakingState, scenario, hydration) {
  const chips = [];
  if (stakingState?.status === "simulated") chips.push(sourceChip("demo", "Simulated staking book"));
  else if (stakingState?.status === "pending_interface") chips.push(sourceChip("projected", "Interface pending"));
  else if (stakingState?.status === "unconfigured") chips.push(sourceChip("projected", "Canister not published"));
  else chips.push(sourceChip("live", "On-chain staking state"));
  if (scenario.monthlyVolumeUsd != null || scenario.poolLiquidityUsd != null) {
    chips.push(sourceChip("projected", "Scenario overrides"));
  }
  return buildDataStatusHTML({
    hydration,
    updatedAt: BigInt(Date.now()) * 1_000_000n,
    chips,
  });
}

export function buildBurnSourceChips(metrics, scenario, hydration) {
  const chips = [sourceChip("live", "Ledger-indexed burns"), sourceChip("projected", "Modeled impact calculator")];
  if (scenario.simulatedBurnAmount > 0) chips.push(sourceChip("demo", "Scenario burn input"));
  return buildDataStatusHTML({
    hydration,
    updatedAt: BigInt(Date.now()) * 1_000_000n,
    chips,
  });
}

export const STUDIO_CONSTANTS = {
  BUYBACK_PROGRAM,
  STAKING_PROGRAM,
  BURN_PROGRAM,
};
