import "./styles.css";
import "./trench.css";

import { Principal } from "@dfinity/principal";

import { getAuthState, login, logout, subscribeAuth } from "./auth";
import { createUnavailableDashboard } from "./liveDefaults.js";
import { fetchDashboardData, fetchICPSwapPoolStats, fetchICPSwapPrices } from "./liveData.js";
import { fetchBuybackProgramData, fetchBurnProgramData, fetchStakingProgramData } from "./onChainData.js";
import { createSubscriptionsActor } from "./mgsnCanisters.js";
import {
  blobToHex,
  formatTimestampNs,
  formatTokenAmount,
  isAnonymousPrincipal,
  parseTokenAmount,
  principalText,
  shorten,
  toBigInt,
  unwrapResult,
  variantLabel,
} from "./platformUtils.js";
import { buildPlatformHeaderHTML } from "./siteChrome.js";
import { buildDataStatusHTML, readViewCache, writeViewCache } from "./siteState.js";

const app = document.querySelector("#app");

if (!app) {
  throw new Error("Missing #app root");
}

const CACHE_KEY = "trench-page-live-v2";
const CACHE_AGE_MS = 10 * 60 * 1000;

const ROUTES = Object.freeze({
  console: "#trench-console",
  plan: "#plan",
  proof: "#proof-panel",
  strategy: "/strategy.html",
  build: "/build.html#treasury",
  staking: "/staking.html",
  burn: "/burn.html",
});

const uiState = {
  auth: null,
  userTrench: null,
  notice: null,
  busyAction: "",
  trenchAmountInput: "25",
  trenchRouteMode: "phase_one_liquidity",
  selectedIntentId: null,
  proofNote: "",
};

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

function natToNumber(rawValue, decimals = 8) {
  if (rawValue == null) return null;

  try {
    const value = toBigInt(rawValue);
    const factor = 10n ** BigInt(decimals);
    const whole = value / factor;
    const fractional = value % factor;
    const fractionText = fractional
      .toString()
      .padStart(decimals, "0")
      .replace(/0+$/, "");
    const normalized = fractionText.length > 0 ? `${whole}.${fractionText}` : whole.toString();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function natToInt(rawValue) {
  if (rawValue == null) return 0;

  try {
    return Number(toBigInt(rawValue));
  } catch {
    return 0;
  }
}

function nsToIsoDate(value) {
  if (value == null) return null;

  try {
    const millis = Number(toBigInt(value) / 1_000_000n);
    if (!Number.isFinite(millis)) return null;
    return new Date(millis).toISOString();
  } catch {
    return null;
  }
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

function variantKey(value) {
  return variantLabel(value);
}

function routeModeLabel(routeMode) {
  const key = variantKey(routeMode);
  if (key === "bob_reserve_planned") {
    return "BOB reserve planned";
  }
  return "Phase one liquidity";
}

function routeModeVariant(key) {
  return { [key]: null };
}

function trenchStageLabel(stage) {
  const key = variantKey(stage);
  switch (key) {
    case "intent_created":
      return "Intent created";
    case "funds_detected":
      return "Funds detected";
    case "icp_swept":
      return "ICP swept";
    case "mgsn_execution_ready":
      return "MGSN route ready";
    case "liquidity_routed":
      return "Liquidity routed";
    case "lp_locked":
      return "LP locked";
    case "lp_burned":
      return "LP burned";
    case "proof_published":
      return "Proof published";
    default:
      return "Stage pending";
  }
}

function trenchStageVariant(key) {
  return { [key]: null };
}

function trenchStageRank(stage) {
  switch (variantKey(stage)) {
    case "intent_created":
      return 0;
    case "funds_detected":
      return 1;
    case "icp_swept":
      return 2;
    case "mgsn_execution_ready":
      return 3;
    case "liquidity_routed":
      return 4;
    case "lp_locked":
      return 5;
    case "lp_burned":
      return 6;
    case "proof_published":
      return 7;
    default:
      return -1;
  }
}

function invoiceStatusLabel(status) {
  const key = variantKey(status).replaceAll("_", " ");
  return key === "unknown" ? "unknown" : key;
}

function trenchStatusTone(status) {
  const key = variantKey(status);
  if (key === "swept") return "live";
  if (key === "paid") return "projected";
  if (key === "expired" || key === "cancelled") return "fallback";
  return "preview";
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
    totalLocked: 0,
    totalWeight: 0,
    note: "Lock rail not published yet.",
  };
}

function defaultPublicTrenchState() {
  return {
    owner: [],
    operators: [],
    config: {
      treasuryCanister: [],
      analyticsCanister: [],
      ledgerId: null,
      tokenSymbol: "ICP",
      tokenDecimals: 8,
      tokenFee: 10_000n,
      invoiceTtlDays: 7n,
    },
    intents: [],
    totalRequestedE8s: 0n,
    totalObservedE8s: 0n,
    totalSettledE8s: 0n,
    settledCount: 0n,
    pendingCount: 0n,
  };
}

function currentPrincipalOption() {
  if (!uiState.auth?.principal || isAnonymousPrincipal(uiState.auth.principal)) {
    return [];
  }

  return [Principal.fromText(uiState.auth.principal)];
}

function publicTokenDecimals(trench = currentState.publicTrench) {
  return Number(trench?.config?.tokenDecimals ?? 8);
}

function publicTokenSymbol(trench = currentState.publicTrench) {
  return trench?.config?.tokenSymbol || "ICP";
}

function trenchIntentTitle(intent, checkpoint) {
  const id = natToInt(intent.id);
  const stageKey = variantKey(checkpoint.stage);
  const tokenSymbol = publicTokenSymbol();
  const decimals = publicTokenDecimals();

  switch (stageKey) {
    case "intent_created":
      return `Trench intent #${id} armed`;
    case "funds_detected":
      return `Ingress detected for trench #${id}`;
    case "icp_swept":
      return `Swept ${formatTokenAmount(intent.routedAmountE8s, decimals, tokenSymbol)} into treasury`;
    case "mgsn_execution_ready":
      return `MGSN execution lane armed for trench #${id}`;
    case "liquidity_routed":
      return `Liquidity route marked for trench #${id}`;
    case "lp_locked":
      return `LP lock published for trench #${id}`;
    case "lp_burned":
      return `LP burn published for trench #${id}`;
    case "proof_published":
      return `Proof note published for trench #${id}`;
    default:
      return `Trench event #${id}`;
  }
}

function trenchIntentMeta(intent, checkpoint) {
  const routeMode = routeModeLabel(intent.routeMode);
  const who = shorten(principalText(checkpoint.recordedBy), 8, 6);
  if (checkpoint.note) {
    return `${checkpoint.note} · ${routeMode} · ${who}`;
  }
  return `${routeMode} · ${who}`;
}

function buildRecentActions({ buybackState, burnState, stakingState, publicTrench }) {
  const buybackLog = Array.isArray(buybackState?.log) ? [...buybackState.log] : [];
  const burnLog = Array.isArray(burnState?.log) ? [...burnState.log] : [];
  const trenchIntents = Array.isArray(publicTrench?.intents) ? [...publicTrench.intents] : [];
  const actions = [];

  trenchIntents.forEach((intent) => {
    const checkpoints = Array.isArray(intent.checkpoints) ? [...intent.checkpoints] : [];
    checkpoints.forEach((checkpoint) => {
      actions.push({
        kind: "Trench",
        date: nsToIsoDate(checkpoint.recordedAt),
        title: trenchIntentTitle(intent, checkpoint),
        meta: trenchIntentMeta(intent, checkpoint),
      });
    });
  });

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

  if (!trenchIntents.length) {
    actions.push({
      kind: "Trench",
      date: null,
      title: "Ingress rail ready",
      meta: "Open a trench intent to put exact ICP routing on-chain.",
    });
  }

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

  return actions.sort(sortByDateDesc).slice(0, 6);
}

function latestCheckpoint(publicTrench, targetStageKeys) {
  const intents = Array.isArray(publicTrench?.intents) ? publicTrench.intents : [];
  let latest = null;

  intents.forEach((intent) => {
    const checkpoints = Array.isArray(intent.checkpoints) ? intent.checkpoints : [];
    checkpoints.forEach((checkpoint) => {
      if (!targetStageKeys.includes(variantKey(checkpoint.stage))) return;
      const date = nsToIsoDate(checkpoint.recordedAt);
      const timeValue = Number.isFinite(Date.parse(date ?? "")) ? Date.parse(date) : -1;
      if (!latest || timeValue > latest.timeValue) {
        latest = {
          intent,
          checkpoint,
          date,
          timeValue,
        };
      }
    });
  });

  return latest;
}

function derivePageState({
  dashboard = null,
  prices = null,
  poolStats = null,
  buybackState = null,
  burnState = null,
  stakingState = null,
  publicTrench = null,
  hydration = "fallback",
} = {}) {
  const normalizedDashboard = dashboard ?? createUnavailableDashboard();
  const normalizedBuyback = buybackState ?? defaultBuybackState();
  const normalizedBurn = burnState ?? defaultBurnState();
  const normalizedStaking = stakingState ?? defaultStakingState();
  const normalizedPublicTrench = publicTrench ?? defaultPublicTrenchState();
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
  const tokenDecimals = publicTokenDecimals(normalizedPublicTrench);
  const exactRoutedIcp = natToNumber(normalizedPublicTrench.totalSettledE8s, tokenDecimals);
  const totalBurnedMgsn = optionalNumber(normalizedBurn.totalBurned);
  const totalLockedMgsn = optionalNumber(normalizedStaking.totalLocked);
  const totalLiquidityBurned =
    totalBurnedMgsn != null && mgsnQuote != null ? totalBurnedMgsn * mgsnQuote : null;
  const totalLiquidityLocked =
    totalLockedMgsn != null && mgsnQuote != null ? totalLockedMgsn * mgsnQuote : null;

  return {
    hydration,
    updatedAt: normalizedDashboard.updatedAt ?? BigInt(Date.now()) * 1_000_000n,
    dashboard: normalizedDashboard,
    poolStats: poolStats ?? {},
    buybackState: normalizedBuyback,
    burnState: normalizedBurn,
    stakingState: normalizedStaking,
    publicTrench: normalizedPublicTrench,
    buybackLog,
    burnLog,
    mgsnQuote,
    bobQuote,
    icpQuote,
    observedLiquidity,
    totalBurnedMgsn,
    totalLockedMgsn,
    totalLiquidityBurned,
    totalLiquidityLocked,
    totalIcpRouted: exactRoutedIcp ?? estimatedIcpRouted,
    totalIcpRoutedEstimated: exactRoutedIcp == null && estimatedIcpRouted != null,
    latestBurn,
    recentActions: buildRecentActions({
      buybackState: normalizedBuyback,
      burnState: normalizedBurn,
      stakingState: normalizedStaking,
      publicTrench: normalizedPublicTrench,
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
    publicTrench: defaultPublicTrenchState(),
    hydration,
  });
}

function rederiveState(baseState, overrides = {}) {
  return derivePageState({
    dashboard: baseState.dashboard,
    prices: {
      mgsnUsd: baseState.mgsnQuote,
      bobUsd: baseState.bobQuote,
    },
    poolStats: baseState.poolStats,
    buybackState: overrides.buybackState ?? baseState.buybackState,
    burnState: overrides.burnState ?? baseState.burnState,
    stakingState: overrides.stakingState ?? baseState.stakingState,
    publicTrench: overrides.publicTrench ?? baseState.publicTrench,
    hydration: overrides.hydration ?? baseState.hydration,
  });
}

function buildStatusHtml(state) {
  const chips = [];
  const settledCount = natToInt(state.publicTrench?.settledCount);
  const pendingCount = natToInt(state.publicTrench?.pendingCount);

  if (state.mgsnQuote != null) chips.push(statusChip("live", "MGSN quote live"));
  else chips.push(statusChip("fallback", "MGSN quote pending"));

  if (state.bobQuote != null) chips.push(statusChip("live", "BOB quote live"));
  else chips.push(statusChip("fallback", "BOB quote pending"));

  if (settledCount > 0) chips.push(statusChip("live", `${settledCount} ingress rail${settledCount === 1 ? "" : "s"} settled`));
  else if (pendingCount > 0) chips.push(statusChip("projected", `${pendingCount} ingress rail${pendingCount === 1 ? "" : "s"} armed`));
  else chips.push(statusChip("projected", "Ingress rail ready"));

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

  chips.push(statusChip("projected", "LP receipt layer staged"));

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

function renderFlowLink(href, label, ghost = false, external = false) {
  const ghostClass = ghost ? " trench-flow-link--ghost" : "";
  const externalAttrs = external ? ' target="_blank" rel="noopener noreferrer"' : "";
  return `<a class="trench-flow-link${ghostClass}" href="${href}"${externalAttrs}>${escapeHtml(label)}</a>`;
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

function setNotice(type, text) {
  uiState.notice = { type, text };
}

function clearNotice() {
  uiState.notice = null;
}

function renderNotice() {
  if (!uiState.notice) {
    return "";
  }

  return `<div class="trench-rail-alert trench-rail-alert--${escapeHtml(uiState.notice.type)}">${escapeHtml(uiState.notice.text)}</div>`;
}

function intentSortDesc(left, right) {
  return natToInt(right.id) - natToInt(left.id);
}

function getUserIntents() {
  const intents = Array.isArray(uiState.userTrench?.intents) ? [...uiState.userTrench.intents] : [];
  return intents.sort(intentSortDesc);
}

function syncSelectedIntent() {
  const intents = getUserIntents();
  if (!intents.length) {
    uiState.selectedIntentId = null;
    return null;
  }

  const selected = intents.find((intent) => natToInt(intent.id) === uiState.selectedIntentId);
  if (selected) return selected;

  uiState.selectedIntentId = natToInt(intents[0].id);
  return intents[0];
}

function getActiveIntent() {
  return syncSelectedIntent();
}

function renderRouteModeButtons() {
  const modes = [
    {
      key: "phase_one_liquidity",
      label: "Phase One",
      copy: "Exact ICP ingress. MGSN and MGSN/ICP route are live now.",
    },
    {
      key: "bob_reserve_planned",
      label: "BOB Later",
      copy: "Ingress now. Treasury-side BOB reserve logic stays published, not assumed.",
    },
  ];

  return `
    <div class="trench-mode-row">
      ${modes
        .map((mode) => `
          <button
            class="trench-mode-btn${uiState.trenchRouteMode === mode.key ? " trench-mode-btn--active" : ""}"
            type="button"
            data-route-mode="${mode.key}">
            <span>${escapeHtml(mode.label)}</span>
            <small>${escapeHtml(mode.copy)}</small>
          </button>`)
        .join("")}
    </div>`;
}

function renderIntentPicker(intents) {
  if (intents.length <= 1) return "";

  return `
    <div class="trench-intent-picker">
      ${intents
        .map((intent) => {
          const id = natToInt(intent.id);
          return `
            <button
              class="trench-intent-chip${uiState.selectedIntentId === id ? " trench-intent-chip--active" : ""}"
              type="button"
              data-select-intent="${id}">
              #${id}
            </button>`;
        })
        .join("")}
    </div>`;
}

function renderIntentTimeline(intent) {
  const checkpoints = Array.isArray(intent.checkpoints) ? [...intent.checkpoints] : [];
  if (!checkpoints.length) {
    return `<div class="trench-timeline-empty">No trench checkpoints published yet.</div>`;
  }

  const recent = checkpoints.slice(-4).reverse();
  return `
    <div class="trench-timeline">
      ${recent
        .map((checkpoint) => `
          <div class="trench-timeline-row">
            <div>
              <strong>${escapeHtml(trenchStageLabel(checkpoint.stage))}</strong>
              <p>${escapeHtml(checkpoint.note || "Checkpoint published.")}</p>
            </div>
            <span>${escapeHtml(formatTimestampNs(checkpoint.recordedAt))}</span>
          </div>`)
        .join("")}
    </div>`;
}

function renderIntentStageControls(intent) {
  const stageRank = trenchStageRank(intent.currentStage);
  const controls = [];

  if (stageRank < trenchStageRank(trenchStageVariant("mgsn_execution_ready"))) {
    controls.push({ key: "mgsn_execution_ready", label: "Mark MGSN Ready" });
  }

  if (stageRank < trenchStageRank(trenchStageVariant("liquidity_routed"))) {
    controls.push({ key: "liquidity_routed", label: "Mark Routed" });
  }

  if (stageRank >= trenchStageRank(trenchStageVariant("liquidity_routed")) && stageRank < trenchStageRank(trenchStageVariant("lp_locked"))) {
    controls.push({ key: "lp_locked", label: "Mark LP Locked" });
  }

  if (stageRank >= trenchStageRank(trenchStageVariant("liquidity_routed")) && stageRank < trenchStageRank(trenchStageVariant("lp_burned"))) {
    controls.push({ key: "lp_burned", label: "Mark LP Burned" });
  }

  if (!controls.length) {
    return "";
  }

  return `
    <div class="trench-stage-controls">
      ${controls
        .map((control) => `
          <button
            class="trench-mini-btn"
            type="button"
            data-advance-stage="${control.key}"
            ${uiState.busyAction === `advance-${control.key}` ? "disabled" : ""}>
            ${escapeHtml(uiState.busyAction === `advance-${control.key}` ? "Publishing..." : control.label)}
          </button>`)
        .join("")}
    </div>`;
}

function renderActiveIntentCard(intent) {
  const tokenSymbol = publicTokenSymbol();
  const decimals = publicTokenDecimals();
  const statusLabel = invoiceStatusLabel(intent.status);
  const stageLabel = trenchStageLabel(intent.currentStage);
  const routeLabel = routeModeLabel(intent.routeMode);
  const statusTone = trenchStatusTone(intent.status);
  const subaccountHex = blobToHex(intent.subaccount);
  const canSettle = variantKey(intent.status) === "paid";
  const canRefresh = variantKey(intent.status) !== "swept" && variantKey(intent.status) !== "cancelled";
  const proofPublished = trenchStageRank(intent.currentStage) >= trenchStageRank(trenchStageVariant("proof_published"));

  return `
    <article class="trench-intent-card">
      <div class="trench-intent-topline">
        <div>
          <span class="trench-rail-kicker">Active trench intent</span>
          <h3>Intent #${natToInt(intent.id)}</h3>
        </div>
        <div class="trench-intent-status">
          <span class="trench-intent-pill trench-intent-pill--${statusTone}">${escapeHtml(statusLabel)}</span>
          <span class="trench-intent-pill trench-intent-pill--stage">${escapeHtml(stageLabel)}</span>
        </div>
      </div>

      <div class="trench-intent-grid">
        <div>
          <span class="trench-intent-label">Requested ICP</span>
          <strong>${escapeHtml(formatTokenAmount(intent.requestedAmountE8s, decimals, tokenSymbol))}</strong>
        </div>
        <div>
          <span class="trench-intent-label">Quoted total</span>
          <strong>${escapeHtml(formatTokenAmount(intent.quotedAmountE8s, decimals, tokenSymbol))}</strong>
        </div>
        <div>
          <span class="trench-intent-label">Observed balance</span>
          <strong>${escapeHtml(formatTokenAmount(intent.balanceE8s, decimals, tokenSymbol))}</strong>
        </div>
        <div>
          <span class="trench-intent-label">Routed ICP</span>
          <strong>${escapeHtml(formatTokenAmount(intent.routedAmountE8s, decimals, tokenSymbol))}</strong>
        </div>
      </div>

      <div class="trench-intent-meta">
        <div>
          <span class="trench-intent-label">Deposit owner</span>
          <code>${escapeHtml(principalText(intent.account.owner))}</code>
        </div>
        <div>
          <span class="trench-intent-label">Subaccount</span>
          <code title="${escapeHtml(subaccountHex)}">${escapeHtml(shorten(subaccountHex, 14, 10) || "—")}</code>
        </div>
        <div>
          <span class="trench-intent-label">Route mode</span>
          <strong>${escapeHtml(routeLabel)}</strong>
        </div>
        <div>
          <span class="trench-intent-label">Expires</span>
          <strong>${escapeHtml(formatTimestampNs(intent.expiresAt))}</strong>
        </div>
      </div>

      <div class="trench-intent-actions">
        <button
          class="trench-mini-btn"
          id="trench-refresh-intent"
          type="button"
          ${!canRefresh || uiState.busyAction === "refresh-intent" ? "disabled" : ""}>
          ${uiState.busyAction === "refresh-intent" ? "Refreshing..." : "Refresh Ingress"}
        </button>
        <button
          class="trench-mini-btn trench-mini-btn--primary"
          id="trench-settle-intent"
          type="button"
          ${!canSettle || uiState.busyAction === "settle-intent" ? "disabled" : ""}>
          ${uiState.busyAction === "settle-intent" ? "Settling..." : "Settle to Treasury"}
        </button>
        ${renderFlowLink(ROUTES.strategy, "Open MGSN Route")}
        ${renderFlowLink(ROUTES.build, "Open Treasury Logic", true)}
      </div>

      <p class="trench-intent-copy">
        Phase one now uses a dedicated trench ingress rail. Once the ICP leg is swept to treasury, the live next step is the phase-one route:
        <strong> ICP → MGSN → MGSN/ICP liquidity.</strong>
        The larger BOB reserve path stays published on the Build module until that rail becomes executable.
      </p>

      ${renderIntentStageControls(intent)}

      <div class="trench-proof-publish">
        <label class="trench-rail-label" for="trench-proof-note">Proof note</label>
        <textarea
          class="trench-rail-textarea"
          id="trench-proof-note"
          rows="2"
          placeholder="Add a short note when the route, lock, burn, or receipt is published.">${escapeHtml(uiState.proofNote)}</textarea>
        <button
          class="trench-mini-btn trench-mini-btn--accent"
          id="trench-publish-proof"
          type="button"
          ${proofPublished || uiState.busyAction === "publish-proof" ? "disabled" : ""}>
          ${uiState.busyAction === "publish-proof" ? "Publishing..." : "Publish Proof Note"}
        </button>
      </div>

      ${renderIntentTimeline(intent)}
    </article>`;
}

function renderConsoleRail(state) {
  const tokenSymbol = publicTokenSymbol(state.publicTrench);
  const decimals = publicTokenDecimals(state.publicTrench);
  const intents = getUserIntents();
  const activeIntent = getActiveIntent();
  const isAuthenticated = !!uiState.auth?.authenticated && !isAnonymousPrincipal(uiState.auth?.principal);
  const totalSettled = formatTokenAmount(state.publicTrench.totalSettledE8s, decimals, tokenSymbol);
  const settledCount = natToInt(state.publicTrench.settledCount);
  const pendingCount = natToInt(state.publicTrench.pendingCount);

  return `
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
          <span class="trench-console-stat-label">Routed ICP</span>
          <div class="trench-console-stat-value">${escapeHtml(totalSettled)}</div>
          <p class="trench-console-stat-copy">${escapeHtml(`${settledCount} settled rail${settledCount === 1 ? "" : "s"}`)}</p>
        </div>
        <div class="trench-console-stat">
          <span class="trench-console-stat-label">Ingress rails</span>
          <div class="trench-console-stat-value">${escapeHtml(String(pendingCount))}</div>
          <p class="trench-console-stat-copy">Pending or active intents</p>
        </div>
      </div>
      <div class="trench-console-status">
        <span>pressure</span>
        <strong>${escapeHtml(buildRouteSignal(state))}</strong>
      </div>
    </div>

    <div class="trench-rail-panel" id="trench-console">
      <div class="trench-rail-head">
        <div>
          <span class="trench-rail-kicker">Ingress rail</span>
          <h3>${isAuthenticated ? "Open a trench intent" : "Authenticate to open the rail"}</h3>
        </div>
        <button
          class="trench-mini-btn${isAuthenticated ? " trench-mini-btn--ghost" : " trench-mini-btn--primary"}"
          id="${isAuthenticated ? "trench-logout" : "trench-login"}"
          type="button"
          ${uiState.busyAction === "auth" ? "disabled" : ""}>
          ${uiState.busyAction === "auth" ? "Working..." : isAuthenticated ? "Disconnect" : "Connect Identity"}
        </button>
      </div>

      <p class="trench-rail-copy">
        This rail creates a dedicated subaccount for exact ICP ingress, settles the ICP leg to treasury, and leaves a signed checkpoint trail before any market routing starts.
      </p>

      ${renderNotice()}

      <div class="trench-rail-form">
        <div>
          <label class="trench-rail-label" for="trench-amount">ICP to route</label>
          <input
            class="trench-rail-input"
            id="trench-amount"
            type="text"
            inputmode="decimal"
            value="${escapeHtml(uiState.trenchAmountInput)}"
            placeholder="25" />
        </div>
        <div class="trench-rail-inline-copy">
          Exact quote = requested ICP + one ledger fee. The quote is generated on-chain and the settlement leg feeds the proof panel directly.
        </div>
        ${renderRouteModeButtons()}
        <div class="trench-intent-actions">
          <button
            class="trench-mini-btn trench-mini-btn--primary"
            id="trench-create-intent"
            type="button"
            ${!isAuthenticated || uiState.busyAction === "create-intent" ? "disabled" : ""}>
            ${uiState.busyAction === "create-intent" ? "Opening..." : "Create Trench Intent"}
          </button>
          ${renderFlowLink(ROUTES.plan, "Review Plan", true)}
          ${renderFlowLink(ROUTES.proof, "Jump to Proof", true)}
        </div>
      </div>

      ${renderIntentPicker(intents)}
      ${
        activeIntent
          ? renderActiveIntentCard(activeIntent)
          : `<div class="trench-rail-empty">
              <strong>No active trench intent</strong>
              <p>${isAuthenticated
                ? "Create one above to get an exact quoted amount, a trench-specific deposit subaccount, and a clean settlement path into treasury."
                : "Connect with Internet Identity to create a trench-specific ingress rail and track it from this console."}</p>
            </div>`
      }
    </div>`;
}

function buildRouteSignal(state) {
  const settledIcp = natToNumber(state.publicTrench?.totalSettledE8s, publicTokenDecimals(state.publicTrench));
  const settledCount = natToInt(state.publicTrench?.settledCount);
  const pendingCount = natToInt(state.publicTrench?.pendingCount);

  if (settledIcp != null && settledIcp > 0) {
    return `${formatCompactNumber(settledIcp)} ICP routed across ${settledCount} settled rail${settledCount === 1 ? "" : "s"}`;
  }

  if (pendingCount > 0) {
    return `${pendingCount} ingress rail${pendingCount === 1 ? "" : "s"} armed for settlement`;
  }

  if (state.observedLiquidity != null) {
    return `${formatCompactMoney(state.observedLiquidity)} phase-one depth visible`;
  }

  return "Ingress rail standing by";
}

function buildPageHtml(state) {
  const statusHtml = buildStatusHtml(state);
  const headerValue = formatQuote(state.bobQuote);
  const refreshLabel = isRefreshing ? "Refreshing" : "Refresh Feed";
  const latestLockCheckpoint = latestCheckpoint(state.publicTrench, ["lp_locked"]);
  const latestBurnCheckpoint = latestCheckpoint(state.publicTrench, ["lp_burned"]);
  const latestProofCheckpoint = latestCheckpoint(state.publicTrench, ["proof_published", "liquidity_routed"]);
  const totalSettledCount = natToInt(state.publicTrench.settledCount);

  const proofMetrics = [
    {
      label: "Total liquidity burned",
      value:
        state.totalLiquidityBurned != null
          ? formatCompactMoney(state.totalLiquidityBurned)
          : "Awaiting burn inventory",
      copy:
        state.totalBurnedMgsn != null
          ? `${formatCompactNumber(state.totalBurnedMgsn)} MGSN burned live. LP-specific burn receipts are still pending, so this is the phase-one inventory proxy at current MGSN spot.`
          : "The burn ledger will backfill this metric once the live feed is online.",
      tone: "accent",
    },
    {
      label: "Total liquidity locked",
      value:
        state.totalLiquidityLocked != null
          ? formatCompactMoney(state.totalLiquidityLocked)
          : "Awaiting lock inventory",
      copy:
        state.stakingState.status === "configured"
          ? "Lock rail is published. Until position reads are public, this stays a phase-one proxy from currently exposed MGSN lock inventory."
          : state.totalLockedMgsn != null
            ? `${formatCompactNumber(state.totalLockedMgsn)} MGSN is visible in the current lock feed.`
            : "Lock proof goes live when the public rail exposes positions.",
      tone: "bio",
    },
    {
      label: "Total ICP routed",
      value:
        state.totalIcpRouted != null
          ? `${formatCompactNumber(state.totalIcpRouted)} ICP`
          : "Awaiting ingress settlement",
      copy:
        totalSettledCount > 0
          ? "Exact routed ICP is now sourced from settled trench intents, not a vault-side estimate."
          : state.totalIcpRoutedEstimated
            ? "Estimated from indexed vault fills at live ICP spot until the first trench settlement lands."
            : "Open a trench intent and settle it to push exact routed ICP into this panel.",
      tone: "accent",
    },
    {
      label: "Settled ingress rails",
      value: String(totalSettledCount),
      copy:
        totalSettledCount > 0
          ? "Dedicated trench intents have already completed the ICP settlement leg."
          : "No trench intent has completed settlement yet.",
      tone: "bio",
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
      tone: "accent",
    },
  ];

  const latestLockStatus =
    latestLockCheckpoint != null
      ? `${latestLockCheckpoint.checkpoint.note} on ${formatDate(latestLockCheckpoint.date)}.`
      : state.stakingState.status === "live"
        ? "Lock proof live."
        : state.stakingState.status === "configured"
          ? "Lock rail published. Public position proof is still pending."
          : "Lock rail not published yet.";
  const latestBurnStatus =
    latestBurnCheckpoint != null
      ? `${latestBurnCheckpoint.checkpoint.note} on ${formatDate(latestBurnCheckpoint.date)}.`
      : state.latestBurn != null
        ? `Latest MGSN burn: ${formatCompactNumber(state.latestBurn.mgsnBurned)} on ${formatDate(state.latestBurn.date)}.`
        : state.burnState.status === "live"
          ? "Burn watcher is online. No indexed burns yet."
          : "Burn feed is waiting on the ledger.";
  const latestProofStatus =
    latestProofCheckpoint != null
      ? `${latestProofCheckpoint.checkpoint.note} on ${formatDate(latestProofCheckpoint.date)}.`
      : "Later route notes, LP checkpoints, and proof receipts publish here as the trench progresses.";

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
            ${renderConsoleRail(state)}
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
              <p class="trench-card-copy">The trench now creates a dedicated on-chain intent and subaccount before any market leg begins.</p>
            </article>
            <article class="trench-thesis-card">
              <span class="trench-card-kicker">02 / reserve</span>
              <h3 class="trench-card-title">BOB is the larger gravity well.</h3>
              <p class="trench-card-copy">Phase one live route is MGSN-facing. BOB stays a published treasury conviction layer until that leg is executable.</p>
            </article>
            <article class="trench-thesis-card">
              <span class="trench-card-kicker">03 / proof</span>
              <h3 class="trench-card-title">Every step must leave a trace.</h3>
              <p class="trench-card-copy">Intent. Detection. Sweep. Route. Lock. Burn. Proof note. The console now records all of them.</p>
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
                <p class="trench-flow-copy">Open a trench intent, get the exact quote, and fund the trench-specific subaccount from the console above.</p>
                <div class="trench-flow-signal">${escapeHtml(natToInt(state.publicTrench.pendingCount) > 0 ? `${natToInt(state.publicTrench.pendingCount)} ingress rail${natToInt(state.publicTrench.pendingCount) === 1 ? "" : "s"} active` : "Ingress rail ready")}</div>
                <div class="trench-flow-actions">
                  ${renderFlowLink(ROUTES.console, "Open Ingress Rail")}
                  ${renderFlowLink(ROUTES.proof, "View Settlement Proof", true)}
                </div>
              </article>

              <article class="trench-flow-card">
                <span class="trench-flow-step">02</span>
                <h3 class="trench-flow-title">Receive MGSN</h3>
                <p class="trench-flow-copy">After the ICP leg settles, the console arms the live MGSN execution lane and hands you into the phase-one market route.</p>
                <div class="trench-flow-signal">${escapeHtml(formatQuote(state.mgsnQuote))}</div>
                <div class="trench-flow-actions">
                  ${renderFlowLink(ROUTES.strategy, "Open MGSN Route")}
                  ${renderFlowLink(ROUTES.console, "Review Active Intent", true)}
                </div>
              </article>

              <article class="trench-flow-card">
                <span class="trench-flow-step">03</span>
                <h3 class="trench-flow-title">Route into MGSN/BOB liquidity</h3>
                <p class="trench-flow-copy">Phase one live route is ICP → MGSN → MGSN/ICP liquidity. The BOB reserve path stays published on the treasury rail until it is truly live.</p>
                <div class="trench-flow-signal">${escapeHtml(buildRouteSignal(state))}</div>
                <div class="trench-flow-actions">
                  ${renderFlowLink(ROUTES.strategy, "Open LP Route")}
                  ${renderFlowLink(ROUTES.build, "View BOB Logic", true)}
                </div>
              </article>

              <article class="trench-flow-card">
                <span class="trench-flow-step">04</span>
                <h3 class="trench-flow-title">Lock/Burn LP</h3>
                <p class="trench-flow-copy">Seal pressure. Retire float. The trench now gives you explicit lock and burn checkpoints instead of leaving this stage implied.</p>
                <div class="trench-flow-signal">${escapeHtml(
                  latestLockCheckpoint
                    ? "lp lock published"
                    : latestBurnCheckpoint
                      ? "lp burn published"
                      : state.stakingState.status === "configured"
                        ? "lock rail published"
                        : "receipt layer staged"
                )}</div>
                <div class="trench-flow-actions">
                  ${renderFlowLink(ROUTES.staking, "Open Lock")}
                  ${renderFlowLink(ROUTES.burn, "Open Burn")}
                </div>
              </article>

              <article class="trench-flow-card">
                <span class="trench-flow-step">05</span>
                <h3 class="trench-flow-title">Show proof</h3>
                <p class="trench-flow-copy">No dead ends. Every intent, sweep, route note, lock note, and burn note lands in the panel below.</p>
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
              <p class="trench-section-copy">This panel now mixes exact trench settlement data with live market, burn, and lock feeds so phase one no longer feels like a dead-end shell.</p>
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
              ${renderStatusRow("LP", "Liquidity proof surface", latestProofStatus)}
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
          <p class="trench-footer-copy">Maurice / MGSN / BOB on ICP. Quotes from live ICPSwap sources. Trench ingress settlements, burn traces, lock status, and proof notes can all plug into this shell without rebuilding the page again.</p>
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
  const normalizedState = state?.publicTrench
    ? state
    : rederiveState(
        {
          ...createFallbackState(state?.hydration ?? "loading"),
          ...state,
          publicTrench: state?.publicTrench ?? defaultPublicTrenchState(),
        },
        {
          publicTrench: state?.publicTrench ?? defaultPublicTrenchState(),
          hydration: state?.hydration ?? "loading",
        }
      );

  currentState = normalizedState;
  app.innerHTML = buildPageHtml(normalizedState);
  bindPageEvents();
}

function bindPageEvents() {
  document.querySelector("#trench-refresh")?.addEventListener("click", () => {
    void hydratePage(true);
    void hydrateTrenchRail();
  });

  document.querySelector("#trench-login")?.addEventListener("click", () => {
    void handleAuth(true);
  });

  document.querySelector("#trench-logout")?.addEventListener("click", () => {
    void handleAuth(false);
  });

  document.querySelector("#trench-amount")?.addEventListener("input", (event) => {
    uiState.trenchAmountInput = event.currentTarget.value;
  });

  document.querySelector("#trench-proof-note")?.addEventListener("input", (event) => {
    uiState.proofNote = event.currentTarget.value;
  });

  document.querySelectorAll("[data-route-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      uiState.trenchRouteMode = button.dataset.routeMode;
      renderPage(currentState);
    });
  });

  document.querySelectorAll("[data-select-intent]").forEach((button) => {
    button.addEventListener("click", () => {
      uiState.selectedIntentId = Number(button.dataset.selectIntent);
      renderPage(currentState);
    });
  });

  document.querySelector("#trench-create-intent")?.addEventListener("click", () => {
    void handleCreateIntent();
  });

  document.querySelector("#trench-refresh-intent")?.addEventListener("click", () => {
    void handleRefreshIntent();
  });

  document.querySelector("#trench-settle-intent")?.addEventListener("click", () => {
    void handleSettleIntent();
  });

  document.querySelector("#trench-publish-proof")?.addEventListener("click", () => {
    void handleAdvanceIntent("proof_published");
  });

  document.querySelectorAll("[data-advance-stage]").forEach((button) => {
    button.addEventListener("click", () => {
      void handleAdvanceIntent(button.dataset.advanceStage);
    });
  });
}

function requireAuthenticatedIdentity() {
  if (!uiState.auth?.identity || isAnonymousPrincipal(uiState.auth?.principal)) {
    throw new Error("Connect with Internet Identity before using the trench ingress rail.");
  }

  return uiState.auth.identity;
}

async function getSubscriptionsActor(identity = undefined) {
  return createSubscriptionsActor(identity);
}

async function handleAuth(shouldLogin) {
  uiState.busyAction = "auth";
  renderPage(currentState);

  try {
    if (shouldLogin) {
      await login();
      setNotice("success", "Identity connected. The trench rail is ready.");
    } else {
      await logout();
      uiState.userTrench = null;
      uiState.selectedIntentId = null;
      uiState.proofNote = "";
      setNotice("success", "Identity disconnected. Public trench proof stays live.");
    }
  } catch (error) {
    setNotice("error", error?.message || "Authentication failed.");
  } finally {
    uiState.busyAction = "";
    renderPage(currentState);
  }
}

async function hydrateTrenchRail() {
  try {
    const publicActor = await getSubscriptionsActor();
    const publicTrench = publicActor?.getTrenchState ? await publicActor.getTrenchState([]) : null;
    const userActor = uiState.auth?.authenticated ? await getSubscriptionsActor(uiState.auth.identity) : null;
    const userTrench =
      userActor?.getTrenchState && currentPrincipalOption().length
        ? await userActor.getTrenchState(currentPrincipalOption())
        : null;

    uiState.userTrench = userTrench;
    const nextState = rederiveState(currentState, {
      publicTrench: publicTrench ?? currentState.publicTrench,
    });
    renderPage(nextState);
  } catch {
    renderPage(currentState);
  }
}

async function handleCreateIntent() {
  try {
    requireAuthenticatedIdentity();
    clearNotice();
    uiState.busyAction = "create-intent";
    renderPage(currentState);

    const actor = await getSubscriptionsActor(uiState.auth.identity);
    if (!actor?.createTrenchIntent) {
      throw new Error("Subscriptions canister does not expose the trench rail in this environment.");
    }

    const amountE8s = parseTokenAmount(uiState.trenchAmountInput, publicTokenDecimals(currentState.publicTrench));
    const intent = unwrapResult(
      await actor.createTrenchIntent(
        amountE8s,
        routeModeVariant(uiState.trenchRouteMode),
        `Maurice trench intent · ${routeModeLabel(routeModeVariant(uiState.trenchRouteMode))}`
      )
    );

    uiState.selectedIntentId = natToInt(intent.id);
    setNotice(
      "success",
      `Trench intent #${natToInt(intent.id)} opened for ${formatTokenAmount(intent.requestedAmountE8s, publicTokenDecimals(currentState.publicTrench), publicTokenSymbol(currentState.publicTrench))}.`
    );
    await hydrateTrenchRail();
  } catch (error) {
    setNotice("error", error?.message || "Unable to create the trench intent.");
    renderPage(currentState);
  } finally {
    uiState.busyAction = "";
    renderPage(currentState);
  }
}

async function handleRefreshIntent() {
  const activeIntent = getActiveIntent();
  if (!activeIntent) return;

  try {
    requireAuthenticatedIdentity();
    clearNotice();
    uiState.busyAction = "refresh-intent";
    renderPage(currentState);

    const actor = await getSubscriptionsActor(uiState.auth.identity);
    const refreshed = unwrapResult(await actor.refreshTrenchIntent(activeIntent.id));
    uiState.selectedIntentId = natToInt(refreshed.id);
    setNotice("success", `Refreshed trench intent #${natToInt(refreshed.id)}.`);
    await hydrateTrenchRail();
  } catch (error) {
    setNotice("error", error?.message || "Unable to refresh the trench intent.");
    renderPage(currentState);
  } finally {
    uiState.busyAction = "";
    renderPage(currentState);
  }
}

async function handleSettleIntent() {
  const activeIntent = getActiveIntent();
  if (!activeIntent) return;

  try {
    requireAuthenticatedIdentity();
    clearNotice();
    uiState.busyAction = "settle-intent";
    renderPage(currentState);

    const actor = await getSubscriptionsActor(uiState.auth.identity);
    const settlement = unwrapResult(await actor.settleTrenchIntent(activeIntent.id));
    uiState.selectedIntentId = natToInt(settlement.intent.id);
    setNotice(
      "success",
      `Trench intent #${natToInt(settlement.intent.id)} settled to treasury at block ${toBigInt(settlement.treasuryTransferTxIndex).toString()}.`
    );
    await hydrateTrenchRail();
  } catch (error) {
    setNotice("error", error?.message || "Unable to settle the trench intent.");
    renderPage(currentState);
  } finally {
    uiState.busyAction = "";
    renderPage(currentState);
  }
}

async function handleAdvanceIntent(stageKey) {
  const activeIntent = getActiveIntent();
  if (!activeIntent || !stageKey) return;

  try {
    requireAuthenticatedIdentity();
    clearNotice();
    const busyKey = stageKey === "proof_published" ? "publish-proof" : `advance-${stageKey}`;
    uiState.busyAction = busyKey;
    renderPage(currentState);

    const actor = await getSubscriptionsActor(uiState.auth.identity);
    const note = stageKey === "proof_published" ? uiState.proofNote.trim() : "";
    const updated = unwrapResult(
      await actor.advanceTrenchIntent(activeIntent.id, trenchStageVariant(stageKey), note, [])
    );

    uiState.selectedIntentId = natToInt(updated.id);
    if (stageKey === "proof_published") {
      uiState.proofNote = "";
    }
    setNotice("success", `${trenchStageLabel(trenchStageVariant(stageKey))} published for trench #${natToInt(updated.id)}.`);
    await hydrateTrenchRail();
  } catch (error) {
    setNotice("error", error?.message || "Unable to publish the trench stage.");
    renderPage(currentState);
  } finally {
    uiState.busyAction = "";
    renderPage(currentState);
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
    const publicActorPromise = getSubscriptionsActor();
    const [dashboardResult, pricesResult, poolResult, buybackResult, burnResult, stakingResult, trenchResult] =
      await Promise.allSettled([
        fetchDashboardData(force),
        fetchICPSwapPrices(force),
        fetchICPSwapPoolStats(force),
        fetchBuybackProgramData(force),
        fetchBurnProgramData(force),
        fetchStakingProgramData(force),
        publicActorPromise.then((actor) => (actor?.getTrenchState ? actor.getTrenchState([]) : null)),
      ]);

    const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
    const prices = pricesResult.status === "fulfilled" ? pricesResult.value : null;
    const poolStats = poolResult.status === "fulfilled" ? poolResult.value : null;
    const buybackState = buybackResult.status === "fulfilled" ? buybackResult.value : null;
    const burnState = burnResult.status === "fulfilled" ? burnResult.value : null;
    const stakingState = stakingResult.status === "fulfilled" ? stakingResult.value : null;
    const publicTrench = trenchResult.status === "fulfilled" ? trenchResult.value : null;

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
      stakingState?.status === "live" ||
      publicTrench?.intents?.length ||
      natToInt(publicTrench?.pendingCount) > 0 ||
      natToInt(publicTrench?.settledCount) > 0
    );

    if (hasLivePayload) {
      nextState = derivePageState({
        dashboard,
        prices,
        poolStats,
        buybackState,
        burnState,
        stakingState,
        publicTrench,
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
renderPage(
  cachedState
    ? {
        ...cachedState,
        publicTrench: cachedState.publicTrench ?? defaultPublicTrenchState(),
        hydration: "cached",
      }
    : createFallbackState("loading")
);

void getAuthState()
  .then((auth) => {
    uiState.auth = auth;
    renderPage(currentState);
    return hydrateTrenchRail();
  })
  .catch(() => {});

subscribeAuth((auth) => {
  uiState.auth = auth;
  if (!auth?.authenticated || isAnonymousPrincipal(auth.principal)) {
    uiState.userTrench = null;
    uiState.selectedIntentId = null;
  }
  renderPage(currentState);
  void hydrateTrenchRail();
});

void hydratePage();
void hydrateTrenchRail();

setInterval(() => {
  void hydratePage(true);
  void hydrateTrenchRail();
}, 60_000);
