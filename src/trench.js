import "./styles.css";
import "./trench.css";

import { createUnavailableDashboard } from "./liveDefaults.js";
import { fetchDashboardData, fetchICPSwapPoolStats, fetchICPSwapPrices } from "./liveData.js";
import { fetchBuybackProgramData, fetchBurnProgramData, fetchStakingProgramData } from "./onChainData.js";
import { buildPlatformHeaderHTML } from "./siteChrome.js";
import { buildDataStatusHTML, readViewCache, writeViewCache } from "./siteState.js";

const app = document.querySelector("#app");

if (!app) {
  throw new Error("Missing #app root");
}

const CACHE_KEY = "trench-page-live-v1";
const CACHE_AGE_MS = 10 * 60 * 1000;

const ROUTES = Object.freeze({
  plan: "#plan",
  proof: "#proof-panel",
  strategy: "/strategy.html",
  build: "/build.html#treasury",
  ops: "/ops.html",
  subscribe: "/subscribe.html",
  staking: "/staking.html",
  burn: "/burn.html",
});

let currentState = createFallbackState("loading");
let isRefreshing = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusChip(kind, label) {
  return `<span class="studio-chip studio-chip--${kind}">${escapeHtml(label)}</span>`;
}

function optionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatUsd(value, digits = 2, fallback = "Awaiting feed") {
  if (optionalNumber(value) == null) {
    return fallback;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatQuote(value) {
  if (optionalNumber(value) == null) {
    return "Awaiting feed";
  }

  const abs = Math.abs(value);
  const digits = abs < 0.001 ? 7 : abs < 1 ? 4 : 2;
  return formatUsd(value, digits);
}

function formatCompactMoney(value, fallback = "Awaiting feed") {
  if (optionalNumber(value) == null) {
    return fallback;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactNumber(value, fallback = "Awaiting feed") {
  if (optionalNumber(value) == null) {
    return fallback;
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(dateLike, fallback = "Awaiting action") {
  if (!dateLike) return fallback;
  const parsed = Date.parse(dateLike);
  if (!Number.isFinite(parsed)) return fallback;
  return new Date(parsed).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function sortByDateDesc(left, right) {
  const leftValue = Number.isFinite(Date.parse(left?.date ?? "")) ? Date.parse(left.date) : -1;
  const rightValue = Number.isFinite(Date.parse(right?.date ?? "")) ? Date.parse(right.date) : -1;
  return rightValue - leftValue;
}

function estimateIcpRouted(totalUsdSpent, icpQuote) {
  if (optionalNumber(totalUsdSpent) == null || optionalNumber(icpQuote) == null || icpQuote <= 0) {
    return null;
  }

  return totalUsdSpent / icpQuote;
}

function defaultBuybackState() {
  return {
    status: "unavailable",
    publicAccount: null,
    currentSupply: null,
    log: [],
    note: "Vault actions are waiting on a public settlement rail.",
  };
}

function defaultBurnState() {
  return {
    status: "unavailable",
    burnAddress: null,
    currentSupply: null,
    totalBurned: null,
    log: [],
    note: "Burn proof feed is offline right now.",
  };
}

function defaultStakingState() {
  return {
    status: "prelaunch",
    canisterId: null,
    currentSupply: null,
    positions: [],
    totalLocked: null,
    totalWeight: null,
    note: "Lock rail not published yet.",
  };
}

function buildRecentActions({ buybackState, burnState, stakingState }) {
  const buybackLog = Array.isArray(buybackState?.log) ? [...buybackState.log] : [];
  const burnLog = Array.isArray(burnState?.log) ? [...burnState.log] : [];
  const actions = [];

  buybackLog.slice(-3).forEach((entry) => {
    actions.push({
      kind: "Vault",
      date: entry.date ?? null,
      title: `Indexed ${formatCompactNumber(entry.mgsnAcquired, "0")} MGSN to the trench vault`,
      meta:
        entry.usdSpent != null
          ? `${formatCompactMoney(entry.usdSpent)} est. routed on ${formatDate(entry.date)}`
          : `Settlement detail pending on ${formatDate(entry.date)}`,
    });
  });

  burnLog.slice(-3).forEach((entry) => {
    actions.push({
      kind: "Burn",
      date: entry.date ?? null,
      title: `Burned ${formatCompactNumber(entry.mgsnBurned, "0")} MGSN`,
      meta: `${entry.note ?? "Ledger-indexed burn"} on ${formatDate(entry.date)}`,
    });
  });

  if (!buybackLog.length) {
    actions.push({
      kind: "Vault",
      date: null,
      title: buybackState?.status === "live" ? "Vault watcher armed" : "Vault watcher waiting",
      meta: buybackState?.note ?? "Publish the public vault route to index trench actions.",
    });
  }

  if (!burnLog.length) {
    actions.push({
      kind: "Burn",
      date: null,
      title: burnState?.status === "live" ? "Burn proof watcher online" : "Burn proof waiting",
      meta: burnState?.note ?? "Burn activity will surface here when indexed.",
    });
  }

  if (stakingState?.status === "configured" || stakingState?.status === "live") {
    actions.push({
      kind: "Lock",
      date: null,
      title: stakingState.status === "live" ? "Lock rail exposed" : "Lock rail published",
      meta: stakingState.note ?? "Waiting on public lock position reads.",
    });
  }

  return actions.sort(sortByDateDesc).slice(0, 4);
}

function derivePageState({
  dashboard = null,
  prices = null,
  poolStats = null,
  buybackState = null,
  burnState = null,
  stakingState = null,
  hydration = "fallback",
} = {}) {
  const normalizedDashboard = dashboard ?? createUnavailableDashboard();
  const normalizedBuyback = buybackState ?? defaultBuybackState();
  const normalizedBurn = burnState ?? defaultBurnState();
  const normalizedStaking = stakingState ?? defaultStakingState();
  const lastPoint = normalizedDashboard.timeline?.at(-1) ?? {};
  const burnLog = Array.isArray(normalizedBurn.log) ? [...normalizedBurn.log].sort(sortByDateDesc) : [];
  const buybackLog = Array.isArray(normalizedBuyback.log) ? [...normalizedBuyback.log].sort(sortByDateDesc) : [];
  const totalBuybackUsd = buybackLog.reduce((sum, entry) => sum + (optionalNumber(entry.usdSpent) ?? 0), 0);
  const mgsnQuote = optionalNumber(prices?.mgsnUsd) ?? optionalNumber(lastPoint.mgsnPrice);
  const bobQuote = optionalNumber(prices?.bobUsd) ?? optionalNumber(lastPoint.bobPrice);
  const icpQuote = optionalNumber(lastPoint.icpPrice);
  const observedLiquidity =
    optionalNumber(poolStats?.mgsnLiq) ??
    optionalNumber(normalizedDashboard.marketStats?.totalLiquidityUsd);
  const latestBurn = burnLog[0] ?? null;
  const estimatedIcpRouted = estimateIcpRouted(totalBuybackUsd, icpQuote);
  const hasIndexedBurnTotals =
    normalizedBurn.status === "live" && optionalNumber(normalizedBurn.totalBurned) != null;
  const hasLiveLockAmount =
    normalizedStaking.status === "live" && optionalNumber(normalizedStaking.totalLocked) != null;

  return {
    hydration,
    updatedAt: normalizedDashboard.updatedAt ?? BigInt(Date.now()) * 1_000_000n,
    dashboard: normalizedDashboard,
    poolStats: poolStats ?? {},
    buybackState: normalizedBuyback,
    burnState: normalizedBurn,
    stakingState: normalizedStaking,
    buybackLog,
    burnLog,
    mgsnQuote,
    bobQuote,
    icpQuote,
    observedLiquidity,
    totalBurnedMgsn: hasIndexedBurnTotals ? normalizedBurn.totalBurned : null,
    totalLockedMgsn: hasLiveLockAmount ? normalizedStaking.totalLocked : null,
    totalLiquidityBurned: null,
    totalLiquidityLocked: null,
    totalIcpRouted: estimatedIcpRouted,
    totalIcpRoutedEstimated: estimatedIcpRouted != null,
    latestBurn,
    recentActions: buildRecentActions({
      buybackState: normalizedBuyback,
      burnState: normalizedBurn,
      stakingState: normalizedStaking,
    }),
    historyRange:
      normalizedDashboard.marketStats?.historyStartLabel && normalizedDashboard.marketStats?.historyEndLabel
        ? `${normalizedDashboard.marketStats.historyStartLabel} to ${normalizedDashboard.marketStats.historyEndLabel}`
        : null,
  };
}

function createFallbackState(hydration = "fallback") {
  return derivePageState({
    dashboard: createUnavailableDashboard(),
    prices: null,
    poolStats: null,
    buybackState: defaultBuybackState(),
    burnState: defaultBurnState(),
    stakingState: defaultStakingState(),
    hydration,
  });
}

function buildStatusHtml(state) {
  const chips = [];

  if (state.mgsnQuote != null) chips.push(statusChip("live", "MGSN quote live"));
  else chips.push(statusChip("fallback", "MGSN quote pending"));

  if (state.bobQuote != null) chips.push(statusChip("live", "BOB quote live"));
  else chips.push(statusChip("fallback", "BOB quote pending"));

  if (state.buybackState.status === "live") {
    chips.push(
      statusChip(
        "live",
        state.buybackLog.length ? "Vault actions indexed" : "Vault watcher online"
      )
    );
  } else if (state.buybackState.status === "unconfigured") {
    chips.push(statusChip("projected", "Vault rail unpublished"));
  } else {
    chips.push(statusChip("fallback", "Vault feed partial"));
  }

  if (state.burnState.status === "live") chips.push(statusChip("live", "Burn proof indexed"));
  else chips.push(statusChip("fallback", "Burn feed partial"));

  if (state.stakingState.status === "live") chips.push(statusChip("live", "Lock proof live"));
  else if (state.stakingState.status === "configured") chips.push(statusChip("projected", "Lock rail published"));
  else chips.push(statusChip("projected", "Lock rail pending"));

  chips.push(statusChip("projected", "LP proof pending"));

  return buildDataStatusHTML({
    hydration: state.hydration,
    updatedAt: state.updatedAt,
    chips,
  });
}

function renderProofMetric({ label, value, copy, tone = "" }) {
  const toneClass = tone ? ` trench-metric-card--${tone}` : "";
  return `
    <article class="trench-metric-card${toneClass}">
      <span class="trench-metric-label">${escapeHtml(label)}</span>
      <div class="trench-metric-value">${escapeHtml(value)}</div>
      <p class="trench-metric-copy">${escapeHtml(copy)}</p>
    </article>`;
}

function renderFlowLink(href, label, ghost = false) {
  const ghostClass = ghost ? " trench-flow-link--ghost" : "";
  return `<a class="trench-flow-link${ghostClass}" href="${href}">${escapeHtml(label)}</a>`;
}

function renderActionRow(action) {
  return `
    <div class="trench-action-row">
      <span class="trench-action-kind">${escapeHtml(action.kind)}</span>
      <div class="trench-action-body">
        <h3 class="trench-action-title">${escapeHtml(action.title)}</h3>
        <p class="trench-action-meta">${escapeHtml(action.meta)}</p>
      </div>
      <span class="trench-action-date">${escapeHtml(formatDate(action.date, "LIVE"))}</span>
    </div>`;
}

function renderStatusRow(kind, title, copy) {
  return `
    <div class="trench-status-row">
      <span class="trench-status-kind">${escapeHtml(kind)}</span>
      <div class="trench-status-body">
        <h3 class="trench-status-title">${escapeHtml(title)}</h3>
        <p class="trench-status-copy">${escapeHtml(copy)}</p>
      </div>
    </div>`;
}

function buildPageHtml(state) {
  const statusHtml = buildStatusHtml(state);
  const headerValue = formatQuote(state.bobQuote);
  const refreshLabel = isRefreshing ? "Refreshing" : "Refresh Feed";
  const proofMetrics = [
    {
      label: "Total liquidity burned",
      value:
        state.totalLiquidityBurned != null
          ? formatCompactMoney(state.totalLiquidityBurned)
          : "Awaiting public LP burn proof",
      copy:
        state.totalBurnedMgsn != null
          ? `${formatCompactNumber(state.totalBurnedMgsn)} MGSN token burn proof is live.`
          : "LP burn proof becomes live when the trench publishes burn receipts.",
      tone: "accent",
    },
    {
      label: "Total liquidity locked",
      value:
        state.totalLiquidityLocked != null
          ? formatCompactMoney(state.totalLiquidityLocked)
          : "Awaiting public LP lock proof",
      copy:
        state.stakingState.status === "configured"
          ? "Lock rail is published. Public position reads are still pending."
          : state.totalLockedMgsn != null
            ? `${formatCompactNumber(state.totalLockedMgsn)} MGSN is locked in the current feed.`
            : "Lock proof goes live when the public rail exposes positions.",
      tone: "bio",
    },
    {
      label: "Total ICP routed",
      value:
        state.totalIcpRouted != null
          ? `~${formatCompactNumber(state.totalIcpRouted)} ICP`
          : "Awaiting paired settlement feed",
      copy:
        state.totalIcpRoutedEstimated
          ? "Estimated from indexed vault fills at live ICP spot."
          : "Exact routed ICP becomes visible when the trench publishes settlement legs.",
      tone: "accent",
    },
    {
      label: "MGSN quote",
      value: formatQuote(state.mgsnQuote),
      copy:
        state.historyRange != null
          ? `Live over ${state.historyRange}.`
          : "Spot quote refreshes when ICPSwap answers.",
      tone: "bio",
    },
    {
      label: "BOB quote",
      value: formatQuote(state.bobQuote),
      copy:
        state.bobQuote != null
          ? "Reserve reference is online."
          : "Reserve quote is waiting on the live feed.",
      tone: "bio",
    },
    {
      label: "Observed phase-one depth",
      value: formatCompactMoney(state.observedLiquidity),
      copy:
        state.observedLiquidity != null
          ? "Current live market depth available to the console."
          : "Depth is quiet until the pool feed returns.",
      tone: "accent",
    },
  ];

  const latestLockStatus =
    state.stakingState.status === "live"
      ? "Lock proof live."
      : state.stakingState.status === "configured"
        ? "Lock rail published. LP position proof pending."
        : "Lock rail not published yet.";
  const latestBurnStatus =
    state.latestBurn != null
      ? `Latest burn: ${formatCompactNumber(state.latestBurn.mgsnBurned)} MGSN on ${formatDate(state.latestBurn.date)}.`
      : state.burnState.status === "live"
        ? "Burn watcher is online. No indexed burns yet."
        : "Burn feed is waiting on the ledger.";
  const routeSignal =
    state.observedLiquidity != null
      ? `${formatCompactMoney(state.observedLiquidity)} depth visible now`
      : "Depth feed syncing";

  return `
    ${buildPlatformHeaderHTML({
      activePage: "trench",
      badgeText: state.hydration === "live" ? "Phase one online" : "Phase one syncing",
      priceLabel: "BOB/USD",
      priceValue: headerValue,
      priceClass: state.bobQuote != null ? "live" : "",
    })}
    <div class="page-body trench-body">
      <main class="main-content trench-main">
        <section class="trench-section trench-hero" id="top">
          <div class="trench-hero-copy">
            <div>
              <p class="trench-hero-kicker">Maurice / MGSN / BOB</p>
              <div class="trench-maurice">Maurice active presence</div>
            </div>
            <div>
              <h1 class="trench-title">Enter the Liquidity Trench</h1>
              <p class="trench-tagline">Maurice has a plan. There is no second BOB.</p>
              <p class="trench-lead">Phase one infrastructure for the larger BOB plan. Dark. Sealed. Expandable. Proof-first.</p>
            </div>
            <div class="trench-cta-row">
              <a class="trench-btn trench-btn--primary" href="${ROUTES.plan}">See the Plan</a>
              <a class="trench-btn trench-btn--secondary" href="${ROUTES.proof}">View Trench Stats</a>
            </div>
            <div class="trench-hero-pills">
              <span class="trench-pill">vault console</span>
              <span class="trench-pill">sealed pressure system</span>
              <span class="trench-pill">proof before deposit</span>
            </div>
          </div>

          <aside class="trench-console" aria-label="Trench command console">
            <div class="trench-console-head">
              <span>Trench Command Console</span>
              <strong>Phase one</strong>
            </div>
            <div class="trench-console-machine">
              <p class="trench-console-label">Maurice signal</p>
              <h2 class="trench-console-title">Underwater vault machine</h2>
              <p class="trench-console-copy">Ingress first. Depth second. Proof always on.</p>
              <div class="trench-console-grid">
                <div class="trench-console-stat">
                  <span class="trench-console-stat-label">MGSN quote</span>
                  <div class="trench-console-stat-value">${escapeHtml(formatQuote(state.mgsnQuote))}</div>
                  <p class="trench-console-stat-copy">Current trench skin</p>
                </div>
                <div class="trench-console-stat">
                  <span class="trench-console-stat-label">BOB quote</span>
                  <div class="trench-console-stat-value">${escapeHtml(formatQuote(state.bobQuote))}</div>
                  <p class="trench-console-stat-copy">Reserve reference</p>
                </div>
                <div class="trench-console-stat">
                  <span class="trench-console-stat-label">Depth</span>
                  <div class="trench-console-stat-value">${escapeHtml(formatCompactMoney(state.observedLiquidity))}</div>
                  <p class="trench-console-stat-copy">Visible market pressure</p>
                </div>
                <div class="trench-console-stat">
                  <span class="trench-console-stat-label">Proof bus</span>
                  <div class="trench-console-stat-value">${escapeHtml(state.recentActions.length ? `${state.recentActions.length} live` : "standby")}</div>
                  <p class="trench-console-stat-copy">Recent trench actions</p>
                </div>
              </div>
              <div class="trench-console-status">
                <span>pressure</span>
                <strong>${escapeHtml(routeSignal)}</strong>
              </div>
            </div>
          </aside>
        </section>

        <section class="trench-section" id="thesis">
          <div class="trench-section-head">
            <div>
              <p class="trench-eyebrow">Maurice Thesis</p>
              <h2 class="trench-section-title">Maurice is not selling noise. Maurice is building the intake rail.</h2>
              <p class="trench-section-copy">This page is phase one infrastructure inside the larger BOB plan.</p>
            </div>
          </div>
          <div class="trench-thesis-grid">
            <article class="trench-thesis-card">
              <span class="trench-card-kicker">01 / ingress</span>
              <h3 class="trench-card-title">ICP enters first.</h3>
              <p class="trench-card-copy">The trench starts with clean intake, not instant deposit theater.</p>
            </article>
            <article class="trench-thesis-card">
              <span class="trench-card-kicker">02 / reserve</span>
              <h3 class="trench-card-title">BOB is the larger gravity well.</h3>
              <p class="trench-card-copy">MGSN is the machine skin. BOB is the deeper strategic anchor.</p>
            </article>
            <article class="trench-thesis-card">
              <span class="trench-card-kicker">03 / proof</span>
              <h3 class="trench-card-title">Every step must leave a trace.</h3>
              <p class="trench-card-copy">Lock it. Burn it. Index it. Show it in the console.</p>
            </article>
          </div>
        </section>

        <section class="trench-section" id="plan">
          <div class="trench-section-head">
            <div>
              <p class="trench-eyebrow">See the Plan</p>
              <h2 class="trench-section-title">Four phases. One descent.</h2>
              <p class="trench-section-copy">Short copy. Hard edges. Expand later.</p>
            </div>
          </div>
          <div class="trench-plan-grid">
            <article class="trench-phase-card">
              <div class="trench-phase-index">01</div>
              <h3 class="trench-phase-title">Build the Trench</h3>
              <p class="trench-phase-copy">Stand up the ingress rail, command console, and first public proof surface.</p>
            </article>
            <article class="trench-phase-card">
              <div class="trench-phase-index">02</div>
              <h3 class="trench-phase-title">Deepen the Market</h3>
              <p class="trench-phase-copy">Make depth visible, tighten routing, and remove blind spots around live liquidity.</p>
            </article>
            <article class="trench-phase-card">
              <div class="trench-phase-index">03</div>
              <h3 class="trench-phase-title">Accumulate With Conviction</h3>
              <p class="trench-phase-copy">Use discipline, not noise, to move deeper into the larger BOB position.</p>
            </article>
            <article class="trench-phase-card">
              <div class="trench-phase-index">04</div>
              <h3 class="trench-phase-title">Expand the Strategic Toolkit</h3>
              <p class="trench-phase-copy">Grow this landing page into live analytics, routing, and stronger proof automation.</p>
            </article>
          </div>
        </section>

        <section class="trench-section" id="how-it-works">
          <div class="trench-section-head">
            <div>
              <p class="trench-eyebrow">How It Works</p>
              <h2 class="trench-section-title">Deposit ICP &gt; Receive MGSN &gt; Route into MGSN/BOB liquidity &gt; Lock/Burn LP &gt; Show proof</h2>
              <p class="trench-section-copy">The rail is the product.</p>
            </div>
          </div>

          <div class="trench-flow-shell">
            <div class="trench-flow-strip" aria-hidden="true">
              <span>Deposit ICP</span>
              <span>Receive MGSN</span>
              <span>Route to MGSN/BOB</span>
              <span>Lock / Burn LP</span>
              <span>Show proof</span>
            </div>

            <div class="trench-flow-grid">
              <article class="trench-flow-card">
                <span class="trench-flow-step">01</span>
                <h3 class="trench-flow-title">Deposit ICP</h3>
                <p class="trench-flow-copy">ICP is the intake pressure. Clean rail first.</p>
                <div class="trench-flow-signal">${escapeHtml(state.icpQuote != null ? `${formatQuote(state.icpQuote)} live` : "ICP route syncing")}</div>
                <div class="trench-flow-actions">
                  ${renderFlowLink(ROUTES.ops, "Open Ops")}
                  ${renderFlowLink(ROUTES.subscribe, "Invoice Rail", true)}
                </div>
              </article>

              <article class="trench-flow-card">
                <span class="trench-flow-step">02</span>
                <h3 class="trench-flow-title">Receive MGSN</h3>
                <p class="trench-flow-copy">MGSN is the trench receipt. The machine skin shows up here.</p>
                <div class="trench-flow-signal">${escapeHtml(formatQuote(state.mgsnQuote))}</div>
                <div class="trench-flow-actions">
                  ${renderFlowLink(ROUTES.strategy, "Open Strategy")}
                </div>
              </article>

              <article class="trench-flow-card">
                <span class="trench-flow-step">03</span>
                <h3 class="trench-flow-title">Route into MGSN/BOB liquidity</h3>
                <p class="trench-flow-copy">Phase one exposes the rail. The deeper BOB trench keeps coming into focus.</p>
                <div class="trench-flow-signal">${escapeHtml(routeSignal)}</div>
                <div class="trench-flow-actions">
                  ${renderFlowLink(ROUTES.build, "View Route Logic")}
                  ${renderFlowLink(ROUTES.proof, "View Stats", true)}
                </div>
              </article>

              <article class="trench-flow-card">
                <span class="trench-flow-step">04</span>
                <h3 class="trench-flow-title">Lock/Burn LP</h3>
                <p class="trench-flow-copy">Seal pressure. Retire float. Leave a visible scar.</p>
                <div class="trench-flow-signal">${escapeHtml(
                  state.stakingState.status === "configured"
                    ? "lock rail published"
                    : state.burnState.status === "live"
                      ? "burn proof live"
                      : "rail pending"
                )}</div>
                <div class="trench-flow-actions">
                  ${renderFlowLink(ROUTES.staking, "Open Lock")}
                  ${renderFlowLink(ROUTES.burn, "Open Burn")}
                </div>
              </article>

              <article class="trench-flow-card">
                <span class="trench-flow-step">05</span>
                <h3 class="trench-flow-title">Show proof</h3>
                <p class="trench-flow-copy">No dead ends. Every live trace lands in the panel below.</p>
                <div class="trench-flow-signal">${escapeHtml(
                  state.recentActions[0]?.title ?? "proof bus armed"
                )}</div>
                <div class="trench-flow-actions">
                  ${renderFlowLink(ROUTES.proof, "Jump to Proof")}
                </div>
              </article>
            </div>
          </div>
        </section>

        <section class="trench-section" id="proof-panel">
          <div class="trench-proof-head">
            <div>
              <p class="trench-eyebrow">Proof Panel</p>
              <h2 class="trench-section-title">Live where the rails are public. Honest where they are not.</h2>
              <p class="trench-section-copy">This panel is built to grow into fuller trench analytics and real routing.</p>
            </div>
            <div class="trench-proof-controls">
              ${statusHtml}
              <button class="trench-refresh-btn" id="trench-refresh" type="button"${isRefreshing ? " disabled" : ""}>${refreshLabel}</button>
            </div>
          </div>

          <div class="trench-proof-grid">
            ${proofMetrics.map((metric) => renderProofMetric(metric)).join("")}
          </div>

          <div class="trench-proof-lower">
            <article class="trench-action-card">
              <span class="trench-action-kicker">Recent actions</span>
              <div class="trench-action-list">
                ${state.recentActions.map((action) => renderActionRow(action)).join("")}
              </div>
            </article>

            <article class="trench-status-card">
              <span class="trench-status-label">Latest lock/burn status</span>
              ${renderStatusRow("Lock", "Pressure seal", latestLockStatus)}
              ${renderStatusRow("Burn", "Retirement scar", latestBurnStatus)}
              ${renderStatusRow(
                "LP",
                "Liquidity proof surface",
                "LP-specific lock and burn totals are staged for the moment the public trench rail is exposed."
              )}
            </article>
          </div>
        </section>

        <section class="trench-section" id="why-bob-icp">
          <div class="trench-section-head">
            <div>
              <p class="trench-eyebrow">Why BOB / Why ICP</p>
              <h2 class="trench-section-title">ICP is the ingress asset. BOB is the larger conviction object.</h2>
              <p class="trench-section-copy">One gets you in. One is the deeper plan.</p>
            </div>
          </div>
          <div class="trench-why-grid">
            <article class="trench-why-card">
              <span class="trench-why-kicker">Why BOB</span>
              <h3 class="trench-why-title">No second BOB.</h3>
              <p class="trench-why-copy">Maurice treats BOB as the deeper gravity well. The trench exists to make that path legible and harder to fake.</p>
            </article>
            <article class="trench-why-card">
              <span class="trench-why-kicker">Why ICP</span>
              <h3 class="trench-why-title">Certified ingress.</h3>
              <p class="trench-why-copy">ICP is how the page lives on-chain, how the intake rail settles, and how proof can stay public instead of ornamental.</p>
            </article>
          </div>
        </section>

        <section class="trench-section" id="lower-cta">
          <article class="trench-lower-card">
            <div>
              <p class="trench-eyebrow">Lower CTA</p>
              <h2 class="trench-lower-title">Phase one is a command surface, not a meme poster.</h2>
              <p class="trench-lower-copy">Stay in the console. Review the plan. Watch the stats. Then route deeper.</p>
            </div>
            <div class="trench-lower-actions">
              <a class="trench-btn trench-btn--primary" href="${ROUTES.plan}">See the Plan</a>
              <a class="trench-btn trench-btn--secondary" href="${ROUTES.strategy}">Open Strategy Engine</a>
              <a class="trench-btn trench-btn--ghost" href="${ROUTES.build}">Open Build Module</a>
            </div>
          </article>
        </section>

        <footer class="trench-footer">
          <p class="trench-footer-copy">Maurice / MGSN / BOB on ICP. Quotes from live ICPSwap sources. Burn and vault traces where the rails are public. More trench analytics can plug into this shell without rebuilding the page.</p>
          <div class="trench-footer-links">
            <a class="trench-footer-link" href="/">Dashboard</a>
            <a class="trench-footer-link" href="${ROUTES.strategy}">Strategy</a>
            <a class="trench-footer-link" href="${ROUTES.staking}">Lock</a>
            <a class="trench-footer-link" href="${ROUTES.burn}">Burn</a>
          </div>
        </footer>
      </main>
    </div>`;
}

function renderPage(state) {
  currentState = state;
  app.innerHTML = buildPageHtml(state);

  const refreshButton = document.querySelector("#trench-refresh");
  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      void hydratePage(true);
    });
  }
}

async function hydratePage(force = false) {
  if (isRefreshing) {
    return;
  }

  isRefreshing = true;
  renderPage({
    ...currentState,
    hydration: currentState.hydration === "fallback" ? "loading" : currentState.hydration,
  });

  let nextState = currentState;

  try {
    const [dashboardResult, pricesResult, poolResult, buybackResult, burnResult, stakingResult] =
      await Promise.allSettled([
        fetchDashboardData(force),
        fetchICPSwapPrices(force),
        fetchICPSwapPoolStats(force),
        fetchBuybackProgramData(force),
        fetchBurnProgramData(force),
        fetchStakingProgramData(force),
      ]);

    const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
    const prices = pricesResult.status === "fulfilled" ? pricesResult.value : null;
    const poolStats = poolResult.status === "fulfilled" ? poolResult.value : null;
    const buybackState = buybackResult.status === "fulfilled" ? buybackResult.value : null;
    const burnState = burnResult.status === "fulfilled" ? burnResult.value : null;
    const stakingState = stakingResult.status === "fulfilled" ? stakingResult.value : null;

    const hasLivePayload = Boolean(
      dashboard?.marketStats?.historyStartLabel ||
      prices?.mgsnUsd != null ||
      prices?.bobUsd != null ||
      poolStats?.mgsnLiq != null ||
      poolStats?.mgsnPoolId ||
      buybackState?.status === "live" ||
      buybackState?.status === "unconfigured" ||
      burnState?.status === "live" ||
      stakingState?.status === "configured" ||
      stakingState?.status === "live"
    );

    if (hasLivePayload) {
      nextState = derivePageState({
        dashboard,
        prices,
        poolStats,
        buybackState,
        burnState,
        stakingState,
        hydration: "live",
      });
      writeViewCache(CACHE_KEY, nextState);
    } else {
      const cached = readViewCache(CACHE_KEY, CACHE_AGE_MS);
      nextState = cached ? { ...cached, hydration: "cached" } : createFallbackState("fallback");
    }
  } finally {
    isRefreshing = false;
    renderPage(nextState);
  }
}

const cachedState = readViewCache(CACHE_KEY, CACHE_AGE_MS);
renderPage(cachedState ? { ...cachedState, hydration: "cached" } : createFallbackState("loading"));
void hydratePage();

setInterval(() => {
  void hydratePage(true);
}, 60_000);
