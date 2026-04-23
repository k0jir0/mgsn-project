import "./styles.css";
import "./burnHub.css";
import { TOKEN_CANISTERS } from "./demoData.js";
import { fetchICPSwapPrices, fetchLiveSpotPrices } from "./liveData.js";
import { fetchBurnProgramData } from "./onChainData.js";
import {
  buildBurnScenario,
  deriveBurnMetrics,
  escapeHtml,
  formatCompactNumber,
  formatMoney,
  formatPercent,
} from "./burnSuite.js";
import { buildPlatformHeaderHTML } from "./siteChrome.js";
import {
  attachScenarioStudio,
  buildKeepBurnSourceChips,
  buildScenarioHeaderHTML,
  loadScenarioState,
  readViewCache,
  saveScenarioState,
  writeViewCache,
} from "./siteState.js";

const APP = document.querySelector("#app");
const CACHE_KEY = "keep-burn-live-v1";
const DEFAULT_ICP_AMOUNT = "5";
const ICP_PRESETS = Object.freeze([1, 5, 25, 100]);
const PLAN_OPTIONS = Object.freeze([
  {
    key: "gentle",
    label: "Gentle",
    keepPct: 80,
    burnPct: 20,
    description: "Keep most of the buy in your wallet and retire a smaller slice of supply.",
    benefit: "The easiest entry point if you want exposure first and pressure second.",
  },
  {
    key: "balanced",
    label: "Balanced",
    keepPct: 50,
    burnPct: 50,
    description: "Split the purchase evenly between your wallet and permanent supply retirement.",
    benefit: "The clearest mix of personal upside and visible burn pressure.",
  },
  {
    key: "bold",
    label: "Bold",
    keepPct: 25,
    burnPct: 75,
    description: "Lean harder into burn pressure while still keeping some MGSN exposure.",
    benefit: "The strongest immediate supply effect without turning the whole plan into a pure donation.",
  },
]);
const ICPSWAP_SWAP_URL =
  `https://app.icpswap.com/swap?input=${TOKEN_CANISTERS.ICP}&output=${TOKEN_CANISTERS.MGSN}`;

let refreshInFlight = false;
let pageState = null;

const uiState = {
  icpAmountInput: DEFAULT_ICP_AMOUNT,
  planKey: "balanced",
  feedbackMessage: "Pick an ICP amount and a split. The page updates the keep and burn plan instantly.",
  feedbackTone: "bio",
};

if (!APP) {
  throw new Error("Missing #app root");
}

function fallbackPublicData() {
  return {
    prices: {},
    icpUsd: null,
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
    updatedAt: null,
  };
}

function selectedPlan() {
  return PLAN_OPTIONS.find((option) => option.key === uiState.planKey) ?? PLAN_OPTIONS[1];
}

function parseIcpInput(value) {
  if (value == null || value === "") {
    return 0;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function formatTokenAmount(value, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatIcpAmount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function explainPlan(planOption) {
  if (planOption.key === "gentle") {
    return "Your ICP still becomes market demand for MGSN, but most of what you buy stays with you. That makes the plan beginner-friendly and less emotionally costly.";
  }

  if (planOption.key === "bold") {
    return "Most of the purchase goes straight into permanent retirement. That makes this the strongest immediate burn-pressure option on the page.";
  }

  return "Half stays in your wallet and half leaves circulation forever. It is the simplest balance between supporting the pair and still having skin in the game.";
}

function restoreUiState(cached) {
  const cachedIcpAmount = cached?.plannerState?.icpAmountInput;
  const cachedPlanKey = cached?.plannerState?.planKey;

  if (typeof cachedIcpAmount === "string") {
    uiState.icpAmountInput = cachedIcpAmount;
  }

  if (PLAN_OPTIONS.some((option) => option.key === cachedPlanKey)) {
    uiState.planKey = cachedPlanKey;
  }
}

function buildPlan({ icpAmount, icpUsd, mgsnUsd, metrics, planOption }) {
  const usdCommitted =
    typeof icpUsd === "number" && Number.isFinite(icpUsd)
      ? icpAmount * icpUsd
      : null;
  const mgsnPerIcp =
    typeof icpUsd === "number" && Number.isFinite(icpUsd) && typeof mgsnUsd === "number" && Number.isFinite(mgsnUsd) && mgsnUsd > 0
      ? icpUsd / mgsnUsd
      : null;
  const mgsnBought =
    typeof usdCommitted === "number" && typeof mgsnUsd === "number" && Number.isFinite(mgsnUsd) && mgsnUsd > 0
      ? usdCommitted / mgsnUsd
      : null;
  const keptMgsn = typeof mgsnBought === "number" ? mgsnBought * (planOption.keepPct / 100) : null;
  const burnedMgsn = typeof mgsnBought === "number" ? mgsnBought * (planOption.burnPct / 100) : null;
  const keptUsd = typeof keptMgsn === "number" && typeof mgsnUsd === "number" ? keptMgsn * mgsnUsd : null;
  const burnedUsd = typeof burnedMgsn === "number" && typeof mgsnUsd === "number" ? burnedMgsn * mgsnUsd : null;
  const burnScenario = typeof burnedMgsn === "number" ? buildBurnScenario(metrics, burnedMgsn) : null;

  return {
    icpAmount,
    mgsnPerIcp,
    usdCommitted,
    mgsnBought,
    keptMgsn,
    burnedMgsn,
    keptUsd,
    burnedUsd,
    burnScenario,
    planOption,
    explanation: explainPlan(planOption),
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
  });
  const plan = buildPlan({
    icpAmount: parseIcpInput(uiState.icpAmountInput),
    icpUsd: merged.icpUsd,
    mgsnUsd: merged.prices?.mgsnUsd ?? null,
    metrics,
    planOption: selectedPlan(),
  });

  return {
    ...merged,
    hydrationMode,
    metrics,
    plan,
    updatedAt: merged.updatedAt ?? BigInt(Date.now()) * 1_000_000n,
  };
}

function buildStats(plan, metrics) {
  return [
    {
      label: "ICP committed",
      value: `${formatIcpAmount(plan.icpAmount)} ICP`,
      copy: "This is the ICP you plan to send through the MGSN pair.",
    },
    {
      label: "Estimated MGSN bought",
      value: plan.mgsnBought != null ? `${formatTokenAmount(plan.mgsnBought)} MGSN` : "Unavailable",
      copy: "Calculated from the live ICP/USD and MGSN/USD feeds, before swap slippage.",
    },
    {
      label: "You keep",
      value: plan.keptMgsn != null ? `${formatTokenAmount(plan.keptMgsn)} MGSN` : "Unavailable",
      copy: plan.keptUsd != null ? `${formatMoney(plan.keptUsd)} of the buy stays with you.` : "Your retained portion stays in your wallet.",
    },
    {
      label: "You burn",
      value: plan.burnedMgsn != null ? `${formatTokenAmount(plan.burnedMgsn)} MGSN` : "Unavailable",
      copy: plan.burnedUsd != null ? `${formatMoney(plan.burnedUsd)} gets retired permanently.` : "Your burn portion leaves circulation forever.",
    },
    {
      label: "After your burn",
      value: plan.burnScenario?.nextPctBurned != null ? formatPercent(plan.burnScenario.nextPctBurned, 4) : "Unavailable",
      copy: "Projected total retired supply after this plan is executed.",
    },
    {
      label: "To next milestone",
      value:
        plan.burnScenario?.toNextMilestone != null
          ? `${formatCompactNumber(plan.burnScenario.toNextMilestone)} MGSN`
          : metrics.nextMilestone
            ? "Milestone cleared"
            : "All cleared",
      copy: metrics.nextMilestone ? `${metrics.nextMilestone.badge} is the next published badge.` : "Every current burn milestone is already cleared.",
    },
  ];
}

function planSummaryText(state) {
  const { plan } = state;
  const retiredText =
    plan.burnScenario?.nextPctBurned != null
      ? `After the burn, total retired supply would reach ${formatPercent(plan.burnScenario.nextPctBurned, 4)}.`
      : "The total retired-supply estimate is unavailable right now.";

  return `Keep/Burn plan: use ${formatIcpAmount(plan.icpAmount)} ICP to buy about ${formatTokenAmount(plan.mgsnBought ?? 0)} MGSN. Keep ${formatTokenAmount(plan.keptMgsn ?? 0)} MGSN and burn ${formatTokenAmount(plan.burnedMgsn ?? 0)} MGSN. ${retiredText}`;
}

function buildHtml(state) {
  const statusHtml = buildKeepBurnSourceChips(state, loadScenarioState(), state.hydrationMode);
  const stats = buildStats(state.plan, state.metrics);
  const rateLabel =
    state.plan.mgsnPerIcp != null
      ? `~${formatTokenAmount(state.plan.mgsnPerIcp)} MGSN per 1 ICP at current spot prices`
      : "Live ICP/MGSN conversion is temporarily unavailable";
  const summaryRows = [
    {
      label: "Plan type",
      value: `${state.plan.planOption.label} · Keep ${state.plan.planOption.keepPct}% · Burn ${state.plan.planOption.burnPct}%`,
    },
    {
      label: "ICP to use",
      value: `${formatIcpAmount(state.plan.icpAmount)} ICP`,
    },
    {
      label: "Estimated spend",
      value: state.plan.usdCommitted != null ? formatMoney(state.plan.usdCommitted) : "Unavailable",
    },
    {
      label: "Burn page preload",
      value: state.plan.burnedMgsn != null ? `${formatTokenAmount(state.plan.burnedMgsn)} MGSN` : "Unavailable",
    },
  ];

  return `
    ${buildPlatformHeaderHTML({
      activePage: "keepBurn",
      badgeText: "Guided support plan",
      priceLabel: "ICP/USD",
      priceValue: state.icpUsd != null ? formatMoney(state.icpUsd, 2) : "Unavailable",
      priceClass: state.icpUsd != null ? "live" : "",
    })}

    <div class="burn-shell">
      ${buildScenarioHeaderHTML("keepBurn", statusHtml)}

      <section class="burn-hero">
        <div class="burn-hero-copy" aria-live="polite">
          <span class="burn-kicker">One buy. Two outcomes.</span>
          <h1 class="burn-title">Keep some. Burn some. Support the MGSN/ICP pair.</h1>
          <p class="burn-copy">This page turns a simple ICP amount into a friendlier support plan. Your ICP creates market demand for MGSN, the keep side leaves you with upside exposure, and the burn side retires supply permanently.</p>
          <div class="burn-row">
            <span class="burn-chip live">No wallet required to plan</span>
            <span class="burn-chip bio">Buy first on ICPSwap, then burn from the MGSN rail</span>
          </div>
          <div class="burn-stat-grid">
            ${stats.map((stat) => `
              <article class="burn-stat">
                <span class="burn-stat-label">${escapeHtml(stat.label)}</span>
                <span class="burn-stat-value">${escapeHtml(stat.value)}</span>
                <p class="burn-stat-copy">${escapeHtml(stat.copy)}</p>
              </article>`).join("")}
          </div>
        </div>

        <aside class="burn-console" aria-labelledby="keep-burn-controls-title">
          <div class="burn-console-head">
            <div>
              <h2 class="burn-console-title" id="keep-burn-controls-title">Build your plan</h2>
              <p class="burn-console-subtitle">Start with ICP. The page handles the estimate, the split, and the burn-page preload for you.</p>
            </div>
            <span class="burn-auth-chip live">User-friendly mode</span>
          </div>

          <label class="burn-row" for="keep-burn-icp-input">
            <input
              id="keep-burn-icp-input"
              class="burn-input"
              type="number"
              min="0"
              step="0.1"
              inputmode="decimal"
              value="${escapeHtml(uiState.icpAmountInput)}"
              aria-describedby="keep-burn-rate"
            />
          </label>

          <div class="burn-action-row" aria-label="ICP quick amounts">
            ${ICP_PRESETS.map((amount) => `
              <button class="burn-btn burn-btn-secondary" type="button" data-icp-preset="${amount}">${amount} ICP</button>`).join("")}
          </div>

          <fieldset class="kb-preset-group">
            <legend class="kb-preset-legend">Choose your split</legend>
            <div class="kb-preset-grid">
              ${PLAN_OPTIONS.map((option) => `
                <label class="kb-preset-option">
                  <input class="kb-preset-input" type="radio" name="keep-burn-plan" value="${option.key}"${option.key === uiState.planKey ? " checked" : ""} />
                  <span class="kb-preset-card">
                    <span class="kb-preset-title">${escapeHtml(option.label)}</span>
                    <span class="kb-preset-copy">${escapeHtml(option.description)}</span>
                    <span class="kb-split-rail" aria-hidden="true">
                      <span class="kb-split-keep" style="width:${option.keepPct}%"></span>
                      <span class="kb-split-burn" style="width:${option.burnPct}%"></span>
                    </span>
                    <span class="kb-preset-meta">Keep ${option.keepPct}% · Burn ${option.burnPct}%</span>
                  </span>
                </label>`).join("")}
            </div>
          </fieldset>

          <div class="burn-balance-rail" id="keep-burn-rate">
            <span>${escapeHtml(rateLabel)}</span>
            <span>${state.plan.planOption.benefit}</span>
          </div>

          <div class="burn-action-row">
            <a class="burn-btn burn-btn-primary" href="${ICPSWAP_SWAP_URL}" target="_blank" rel="noopener noreferrer">Buy MGSN on ICPSwap</a>
            <button id="keep-burn-open-burn" class="burn-btn burn-btn-secondary" type="button"${state.plan.burnedMgsn == null ? " disabled" : ""}>Load burn amount into Burn page</button>
            <button id="keep-burn-copy-plan" class="burn-btn burn-btn-secondary" type="button">Copy plan</button>
          </div>

          <div class="kb-feedback ${uiState.feedbackTone}" role="status" aria-live="polite">${escapeHtml(uiState.feedbackMessage)}</div>
        </aside>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Why this helps</h2>
        <p class="burn-section-copy">The page stays plain on purpose. The actual mechanism is simple: buy pressure comes from ICP entering the pair, your keep side leaves you exposed to MGSN, and the burn side reduces liquid supply forever.</p>
        <div class="burn-proof-grid">
          <article class="burn-card">
            <span class="burn-panel-label">Buy pressure</span>
            <span class="burn-panel-value">ICP -> MGSN</span>
            <p class="burn-panel-copy">Your ICP has to cross the market to acquire MGSN. That creates real demand in the MGSN/ICP pair.</p>
          </article>
          <article class="burn-card">
            <span class="burn-panel-label">You still keep upside</span>
            <span class="burn-panel-value">${state.plan.keptMgsn != null ? `${formatCompactNumber(state.plan.keptMgsn)} kept` : "Unavailable"}</span>
            <p class="burn-panel-copy">This is not a pure sacrifice page. The keep side means the user still participates if MGSN gets stronger later.</p>
          </article>
          <article class="burn-card">
            <span class="burn-panel-label">Permanent supply pressure</span>
            <span class="burn-panel-value">${state.plan.burnedMgsn != null ? `${formatCompactNumber(state.plan.burnedMgsn)} burned` : "Unavailable"}</span>
            <p class="burn-panel-copy">The burn side permanently removes MGSN from circulation using the same live burn rail the site already tracks.</p>
          </article>
        </div>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Your plain-English summary</h2>
        <p class="burn-section-copy">This section is meant to be readable by someone who does not want to parse tokenomics dashboards.</p>
        <div class="kb-support-grid">
          <article class="burn-card">
            <p class="kb-inline-note">${escapeHtml(state.plan.explanation)}</p>
            <p class="kb-inline-note" style="margin-top:12px">The estimate ignores swap slippage and trading fees. It is here to guide action, not to pretend exact execution.</p>
          </article>
          <article class="burn-card">
            <div class="kb-summary-list">
              ${summaryRows.map((row) => `
                <div class="kb-summary-row">
                  <span class="kb-summary-label">${escapeHtml(row.label)}</span>
                  <span class="kb-summary-value">${escapeHtml(row.value)}</span>
                </div>`).join("")}
            </div>
          </article>
        </div>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Do it in three steps</h2>
        <p class="burn-section-copy">The handoff stays simple. Buy MGSN, keep the amount this page tells you to keep, and push the burn portion into the existing burn rail.</p>
        <ol class="kb-step-list">
          <li class="kb-step-card">
            <span class="kb-step-index">01</span>
            <h3 class="kb-step-title">Buy MGSN with ICP</h3>
            <p class="kb-step-copy">Use the ICPSwap button to acquire the estimated amount of MGSN from the live pair.</p>
          </li>
          <li class="kb-step-card">
            <span class="kb-step-index">02</span>
            <h3 class="kb-step-title">Keep your share</h3>
            <p class="kb-step-copy">Leave the keep portion in your wallet so the action does not feel like a pure one-way burn campaign.</p>
          </li>
          <li class="kb-step-card">
            <span class="kb-step-index">03</span>
            <h3 class="kb-step-title">Burn the rest</h3>
            <p class="kb-step-copy">Use the preload button to carry the burn amount into the MGSN burn page and complete the retirement from there.</p>
          </li>
        </ol>
      </section>
    </div>`;
}

function buildCacheValue(state) {
  return {
    prices: state.prices,
    icpUsd: state.icpUsd,
    burnState: state.burnState,
    updatedAt: state.updatedAt,
    plannerState: {
      icpAmountInput: uiState.icpAmountInput,
      planKey: uiState.planKey,
    },
  };
}

function syncControlsFromUiState() {
  const icpInput = document.getElementById("keep-burn-icp-input");
  if (icpInput && icpInput.value !== uiState.icpAmountInput) {
    icpInput.value = uiState.icpAmountInput;
  }

  document.querySelectorAll('input[name="keep-burn-plan"]').forEach((input) => {
    input.checked = input.value === uiState.planKey;
  });
}

function rerenderFrom(state) {
  const nextState = buildState(buildCacheValue(state), state.hydrationMode);
  writeViewCache(CACHE_KEY, buildCacheValue(nextState));
  renderPage(nextState);
}

function renderPage(state) {
  pageState = state;
  APP.innerHTML = buildHtml(state);
  syncControlsFromUiState();

  document.getElementById("keep-burn-icp-input")?.addEventListener("input", (event) => {
    uiState.icpAmountInput = event.currentTarget.value;
    rerenderFrom(state);
  });

  document.querySelectorAll("[data-icp-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      uiState.icpAmountInput = button.dataset.icpPreset ?? DEFAULT_ICP_AMOUNT;
      rerenderFrom(state);
    });
  });

  document.querySelectorAll('input[name="keep-burn-plan"]').forEach((input) => {
    input.addEventListener("change", () => {
      uiState.planKey = input.value;
      rerenderFrom(state);
    });
  });

  document.getElementById("keep-burn-open-burn")?.addEventListener("click", () => {
    if (state.plan.burnedMgsn == null) {
      return;
    }

    saveScenarioState({
      ...loadScenarioState(),
      simulatedBurnAmount: Math.max(0, Math.round(state.plan.burnedMgsn)),
    });
    window.location.assign("/burn.html");
  });

  document.getElementById("keep-burn-copy-plan")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(planSummaryText(state));
      uiState.feedbackMessage = "Copied the current keep/burn plan to your clipboard.";
      uiState.feedbackTone = "live";
    } catch {
      uiState.feedbackMessage = "Unable to copy the plan from this browser session.";
      uiState.feedbackTone = "warn";
    }

    rerenderFrom(state);
  });

  attachScenarioStudio(APP, async (action) => {
    if (action?.type === "refresh" || action?.type === "clear-cache") {
      await hydrate(true);
      return;
    }

    rerenderFrom(state);
  });
}

async function hydrate(force = false) {
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;

  try {
    const [priceResult, icpResult, burnResult] = await Promise.allSettled([
      fetchICPSwapPrices(force),
      fetchLiveSpotPrices(force),
      fetchBurnProgramData(force),
    ]);

    const nextState = {
      prices: priceResult.status === "fulfilled" ? priceResult.value : {},
      icpUsd: icpResult.status === "fulfilled" ? icpResult.value.icpUsd ?? null : null,
      burnState: burnResult.status === "fulfilled" ? burnResult.value : fallbackPublicData().burnState,
      updatedAt: BigInt(Date.now()) * 1_000_000n,
    };

    const hasLivePayload =
      nextState.icpUsd != null ||
      nextState.prices?.mgsnUsd != null ||
      nextState.burnState?.status === "live" ||
      nextState.burnState?.totalBurned != null;

    if (hasLivePayload) {
      nextState.plannerState = {
        icpAmountInput: uiState.icpAmountInput,
        planKey: uiState.planKey,
      };
      writeViewCache(CACHE_KEY, nextState);
      renderPage(buildState(nextState, "live"));
      return;
    }

    renderPage(
      buildState(
        pageState ? buildCacheValue(pageState) : fallbackPublicData(),
        pageState?.hydrationMode === "cached" ? "cached" : "fallback"
      )
    );
  } finally {
    refreshInFlight = false;
  }
}

async function bootstrap() {
  const cached = readViewCache(CACHE_KEY);
  restoreUiState(cached);
  renderPage(buildState(cached ?? fallbackPublicData(), cached ? "cached" : "loading"));
  await hydrate();
  window.setInterval(() => {
    void hydrate(true);
  }, 60_000);
}

void bootstrap();