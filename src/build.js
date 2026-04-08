import "./styles.css";

import {
  BURN_PROGRAM,
  BUYBACK_PROGRAM,
  PROGRAM_ADDRESSES,
  TOKEN_CANISTERS,
} from "./demoData.js";
import { createUnavailableDashboard, getDashboardLastPoint } from "./liveDefaults.js";
import {
  fetchDashboardData,
  fetchICPSwapPoolStats,
  fetchICPSwapPrices,
  fetchLiveSpotPrices,
} from "./liveData.js";
import {
  fetchBuybackProgramData,
  fetchBurnProgramData,
  fetchStakingProgramData,
} from "./onChainData.js";
import { buildPlatformHeaderHTML } from "./siteChrome.js";
import { buildDataStatusHTML, readViewCache, writeViewCache } from "./siteState.js";

const app = document.querySelector("#app");

if (!app) {
  throw new Error("Missing #app root");
}

const BUILD_CACHE_KEY = "build-module-live-v1";
const BUILD_CACHE_AGE_MS = 10 * 60 * 1000;
const ICP_TO_BOB_SWAP_URL = `https://app.icpswap.com/swap?input=${TOKEN_CANISTERS.ICP}&output=${TOKEN_CANISTERS.BOB}`;

const SECTION_LINKS = [
  { id: "summary", label: "Summary" },
  { id: "dao", label: "SNS DAO" },
  { id: "treasury", label: "Treasury" },
  { id: "revenue", label: "Revenue App" },
  { id: "analytics", label: "Analytics" },
  { id: "reality-check", label: "Reality Check" },
];

let currentBuildState = null;
let isHydrating = false;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatUsd(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatTokenPrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  const digits = Math.abs(value) < 0.001 ? 7 : 4;
  return formatUsd(value, digits);
}

function formatCompactNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return `${value.toFixed(digits)}%`;
}

function sourceChip(kind, label) {
  return `<span class="studio-chip studio-chip--${kind}">${escapeHtml(label)}</span>`;
}

function sumTrackedBuybackUsd(entries) {
  return entries.reduce((sum, entry) => sum + (entry.usdSpent ?? 0), 0);
}

function defaultBuybackState() {
  return {
    status: PROGRAM_ADDRESSES.buybackVaultOwner ? "unavailable" : "unconfigured",
    publicAccount: PROGRAM_ADDRESSES.buybackVaultOwner ?? null,
    currentSupply: null,
    log: [],
    note: PROGRAM_ADDRESSES.buybackVaultOwner
      ? "The buyback vault is configured, but the ledger scan is unavailable right now."
      : "Publish a dedicated public buyback vault account to auto-index buyback fills from the MGSN ledger.",
  };
}

function defaultStakingState() {
  return {
    status: PROGRAM_ADDRESSES.stakingCanisterId ? "configured" : "prelaunch",
    canisterId: PROGRAM_ADDRESSES.stakingCanisterId ?? null,
    currentSupply: null,
    positions: [],
    totalLocked: 0,
    totalWeight: 0,
    note: PROGRAM_ADDRESSES.stakingCanisterId
      ? "A public staking canister is configured. Publish position methods to upgrade from configuration status to live positions."
      : "No public staking canister has been published yet.",
  };
}

function defaultBurnState() {
  return {
    status: "unavailable",
    burnAddress: BURN_PROGRAM.burnAddress,
    burnAddressBalance: null,
    currentSupply: null,
    originalSupply: null,
    totalBurned: null,
    log: [],
    note: "The burn ledger is unavailable right now.",
  };
}

function deriveMarketBadge(hasLiveMarket, hydration) {
  if (hasLiveMarket) {
    return { label: "live market feed", tone: "live" };
  }

  if (hydration === "loading") {
    return { label: "loading market feed", tone: "planned" };
  }

  if (hydration === "cached") {
    return { label: "refreshing market feed", tone: "preview" };
  }

  return { label: "market feed unavailable", tone: "preview" };
}

function derivePoolBadge(poolId, volume30d) {
  if (poolId && typeof volume30d === "number") {
    return { label: "live pool stats", tone: "live" };
  }

  if (poolId) {
    return { label: "pool linked", tone: "preview" };
  }

  return { label: "pool feed partial", tone: "preview" };
}

function deriveBuybackBadge(buybackState, buybackCount) {
  if (buybackState.status === "live" && buybackCount > 0) {
    return {
      label: `${buybackCount} indexed fill${buybackCount === 1 ? "" : "s"}`,
      tone: "live",
    };
  }

  if (buybackState.status === "live") {
    return { label: "vault live, awaiting fills", tone: "preview" };
  }

  if (buybackState.status === "unconfigured") {
    return { label: "vault not published", tone: "preview" };
  }

  if (buybackState.status === "unavailable") {
    return { label: "vault scan unavailable", tone: "preview" };
  }

  return { label: "buyback status unavailable", tone: "preview" };
}

function deriveStakingBadge(stakingState, totalLocked) {
  if (stakingState.status === "live" && totalLocked > 0) {
    return { label: "live positions", tone: "live" };
  }

  if (stakingState.status === "configured") {
    return { label: "canister published", tone: "preview" };
  }

  if (stakingState.status === "prelaunch") {
    return { label: "canister unpublished", tone: "planned" };
  }

  return { label: "staking state unavailable", tone: "preview" };
}

function deriveBurnBadge(burnState, totalBurned) {
  if (burnState.status === "live" && typeof totalBurned === "number") {
    return {
      label: totalBurned > 0 ? `${formatCompactNumber(totalBurned)} burned` : "ledger tracking live",
      tone: "live",
    };
  }

  return { label: "burn ledger unavailable", tone: "preview" };
}

function deriveProgramBadge(publicBuybackAccount, stakingCanisterId) {
  if (publicBuybackAccount && stakingCanisterId) {
    return { label: "public addresses published", tone: "live" };
  }

  if (publicBuybackAccount || stakingCanisterId) {
    return { label: "partial public wiring", tone: "preview" };
  }

  return { label: "addresses still pending", tone: "planned" };
}

function headerBadgeText(hydration) {
  if (hydration === "live") return "Live build state";
  if (hydration === "cached") return "Refreshing build state";
  if (hydration === "loading") return "Loading build state";
  return "Live build state unavailable";
}

function deriveBuildState({
  dashboard = null,
  prices = null,
  icpSpot = null,
  poolStats = null,
  buybackState = null,
  stakingState = null,
  burnState = null,
  hydration = "fallback",
} = {}) {
  const normalizedBuyback = buybackState ?? defaultBuybackState();
  const normalizedStaking = stakingState ?? defaultStakingState();
  const normalizedBurn = burnState ?? defaultBurnState();
  const livePoint = getDashboardLastPoint(dashboard) ?? {};
  const buybackLog = Array.isArray(normalizedBuyback.log) ? normalizedBuyback.log : [];
  const stakingPositions = Array.isArray(normalizedStaking.positions)
    ? normalizedStaking.positions
    : [];

  const mgsnPrice = prices?.mgsnUsd ?? livePoint.mgsnPrice ?? null;
  const bobPrice = prices?.bobUsd ?? livePoint.bobPrice ?? null;
  const icpPrice = icpSpot?.icpUsd ?? livePoint.icpPrice ?? null;
  const marketStats = dashboard?.marketStats ?? {};
  const poolLiquidity =
    poolStats?.mgsnLiq ?? marketStats.totalLiquidityUsd ?? livePoint.mgsnLiquidity ?? null;
  const volume24h = poolStats?.mgsnVol24h ?? null;
  const volume30d = poolStats?.mgsnVol30d ?? null;
  const circulatingSupply =
    normalizedBurn.currentSupply ??
    normalizedBuyback.currentSupply ??
    normalizedStaking.currentSupply ??
    dashboard?.mgsnSupply ??
    null;
  const totalBurned =
    typeof normalizedBurn.totalBurned === "number" ? normalizedBurn.totalBurned : null;
  const originalSupply =
    normalizedBurn.originalSupply ??
    (typeof totalBurned === "number" && typeof circulatingSupply === "number"
      ? circulatingSupply + totalBurned
      : null);
  const burnedPct =
    typeof originalSupply === "number" && originalSupply > 0 && typeof totalBurned === "number"
      ? (totalBurned / originalSupply) * 100
      : null;
  const totalLocked =
    typeof normalizedStaking.totalLocked === "number"
      ? normalizedStaking.totalLocked
      : stakingPositions.reduce((sum, entry) => sum + (entry.mgsnLocked ?? 0), 0);
  const lockedPct =
    typeof circulatingSupply === "number" && circulatingSupply > 0 && totalLocked > 0
      ? (totalLocked / circulatingSupply) * 100
      : null;
  const buybackTrackedUsd = sumTrackedBuybackUsd(buybackLog);
  const buybackEstimatedCount = buybackLog.filter(
    (entry) => entry.usdBasis === "estimated_pool_snapshot"
  ).length;
  const buybackUnavailableCount = buybackLog.filter(
    (entry) => entry.usdSpent == null || entry.usdBasis === "unavailable"
  ).length;
  const historyRange = marketStats.historyStartLabel && marketStats.historyEndLabel
    ? `${marketStats.historyStartLabel} to ${marketStats.historyEndLabel}`
    : null;
  const hasLiveMarket = Boolean(historyRange || prices?.mgsnUsd != null || poolStats?.mgsnPoolId);
  const publicBuybackAccount = normalizedBuyback.publicAccount ?? PROGRAM_ADDRESSES.buybackVaultOwner ?? null;
  const stakingCanisterId = normalizedStaking.canisterId ?? PROGRAM_ADDRESSES.stakingCanisterId ?? null;
  const mgsnCanister = prices?.mgsnCanister ?? marketStats.mgsnCanister ?? TOKEN_CANISTERS.MGSN;
  const bobCanister = prices?.bobCanister ?? marketStats.bobCanister ?? TOKEN_CANISTERS.BOB;
  const poolId = poolStats?.mgsnPoolId ?? marketStats.mgsnPoolId ?? null;

  return {
    hydration,
    updatedAt: dashboard?.updatedAt ?? null,
    mgsnPrice,
    bobPrice,
    icpPrice,
    poolLiquidity,
    volume24h,
    volume30d,
    totalPairs: marketStats.totalPairs ?? null,
    historyRange,
    circulatingSupply,
    totalBurned,
    burnedPct,
    originalSupply,
    totalLocked,
    lockedPct,
    publicBuybackAccount,
    stakingCanisterId,
    buybackCount: buybackLog.length,
    buybackTrackedUsd,
    buybackEstimatedCount,
    buybackUnavailableCount,
    hasLiveMarket,
    mgsnCanister,
    bobCanister,
    poolId,
    marketBadge: deriveMarketBadge(hasLiveMarket, hydration),
    poolBadge: derivePoolBadge(poolId, volume30d),
    buybackBadge: deriveBuybackBadge(normalizedBuyback, buybackLog.length),
    stakingBadge: deriveStakingBadge(normalizedStaking, totalLocked),
    burnBadge: deriveBurnBadge(normalizedBurn, totalBurned),
    programBadge: deriveProgramBadge(publicBuybackAccount, stakingCanisterId),
    buybackState: normalizedBuyback,
    stakingState: normalizedStaking,
    burnState: normalizedBurn,
  };
}

function createFallbackBuildState(hydration = "fallback") {
  return deriveBuildState({
    dashboard: createUnavailableDashboard(),
    prices: null,
    icpSpot: null,
    poolStats: {},
    buybackState: defaultBuybackState(),
    stakingState: defaultStakingState(),
    burnState: defaultBurnState(),
    hydration,
  });
}

function buildBuildSourceChips(state) {
  const chips = [];

  if (state.hasLiveMarket) {
    chips.push(sourceChip("live", "ICPSwap market feed"));
  } else if (state.hydration === "loading") {
    chips.push(sourceChip("cache", "Loading market feed"));
  } else {
    chips.push(sourceChip("fallback", "Market feed unavailable"));
  }

  if (state.poolId) {
    chips.push(sourceChip("live", "Pool stats linked"));
  }

  if (state.buybackState.status === "live") {
    chips.push(sourceChip("live", "Buyback ledger"));
  } else if (state.buybackState.status === "unconfigured") {
    chips.push(sourceChip("projected", "Buyback vault unpublished"));
  } else {
    chips.push(sourceChip("fallback", "Buyback scan unavailable"));
  }

  if (state.stakingState.status === "live") {
    chips.push(sourceChip("live", "Staking positions"));
  } else if (state.stakingState.status === "configured") {
    chips.push(sourceChip("projected", "Staking canister published"));
  } else {
    chips.push(sourceChip("fallback", "Staking state unavailable"));
  }

  if (state.burnState.status === "live") {
    chips.push(sourceChip("live", "Burn ledger"));
  } else {
    chips.push(sourceChip("fallback", "Burn ledger unavailable"));
  }

  return buildDataStatusHTML({
    hydration: state.hydration,
    updatedAt: state.updatedAt,
    chips,
  });
}

function renderStatusPill(label, tone) {
  return `<span class="build-status-pill build-status-pill--${tone}">${escapeHtml(label)}</span>`;
}

function renderPanelHeader(indexLabel, title, subtitle) {
  return `
    <div class="panel-header">
      <div class="panel-header-left">
        <div class="panel-tabs">
          <span class="panel-tab">${escapeHtml(indexLabel)}</span>
          <span class="panel-tab-sep">/</span>
          <span class="panel-tab">${escapeHtml(title)}</span>
        </div>
        <p class="panel-subtitle">${escapeHtml(subtitle)}</p>
      </div>
    </div>`;
}

function renderList(items) {
  return `
    <ul class="build-list">
      ${items.map((item) => `<li>${item}</li>`).join("")}
    </ul>`;
}

function renderCard({ kicker, title, copy, list = [], statusLabel = "", statusTone = "planned" }) {
  const statusHtml = statusLabel ? renderStatusPill(statusLabel, statusTone) : "";
  return `
    <article class="build-card">
      <div class="build-card-top">
        <p class="build-card-kicker">${escapeHtml(kicker)}</p>
        ${statusHtml}
      </div>
      <h3 class="build-card-title">${escapeHtml(title)}</h3>
      <p class="build-card-copy">${escapeHtml(copy)}</p>
      ${list.length ? renderList(list) : ""}
    </article>`;
}

function renderMetricCard({
  kicker,
  title,
  valueHtml,
  subvalueHtml = "",
  list = [],
  statusLabel = "",
  statusTone = "planned",
}) {
  const statusHtml = statusLabel ? renderStatusPill(statusLabel, statusTone) : "";
  return `
    <article class="build-metric-card">
      <div class="build-card-top">
        <p class="build-card-kicker">${escapeHtml(kicker)}</p>
        ${statusHtml}
      </div>
      <h3 class="build-card-title">${escapeHtml(title)}</h3>
      <p class="build-metric-value">${valueHtml}</p>
      ${subvalueHtml ? `<p class="build-metric-subvalue">${subvalueHtml}</p>` : ""}
      ${list.length ? renderList(list) : ""}
    </article>`;
}

function buildPageHTML(state) {
  const summaryCards = [
    {
      kicker: "Execution order",
      title: "Revenue before governance theater",
      copy: "Ship the paid product first, then let treasury and DAO logic formalize around real cashflow.",
      list: [
        "1. Subscription revenue app.",
        "2. Treasury journal plus ICP to BOB routing.",
        "3. DAO proposal execution and budgeting.",
        "4. Expanded analytics and automation.",
      ],
      statusLabel: "priority",
      statusTone: "new",
    },
    {
      kicker: "Treasury rule",
      title: "ICP in, BOB reserve, buybacks as output",
      copy: "Treat treasury intake, reserve allocation, and buybacks as separate policy layers instead of one blended narrative.",
      list: [
        "Revenue lands in treasury in ICP.",
        "Approved capital can rotate into BOB via ICPSwap.",
        state.poolLiquidity != null
          ? `Current MGSN/ICP pool liquidity: ${escapeHtml(formatCompactMoney(state.poolLiquidity))}.`
          : "Live pool liquidity is unavailable right now.",
      ],
      statusLabel: "operating model",
      statusTone: "planned",
    },
    {
      kicker: "Already live",
      title: "The product shell is running now",
      copy: "This page now inherits the same live-data posture as the rest of MGSN instead of staying a static roadmap island.",
      list: [
        state.hasLiveMarket
          ? "Dashboard is currently hydrated from live ICPSwap market and history data."
          : "Dashboard keeps market metrics unavailable until the live ICPSwap feed returns.",
        `Buyback page: ${escapeHtml(state.buybackBadge.label)}.`,
        `Burn page: ${escapeHtml(state.burnBadge.label)}.`,
        `Staking page: ${escapeHtml(state.stakingBadge.label)}.`,
      ],
      statusLabel: "live-linked",
      statusTone: "live",
    },
    {
      kicker: "Public wiring",
      title: "Current hooks tell the truth",
      copy: "Program addresses, pool ids, and ledger scans now surface directly on the Build page so the roadmap stays honest about what is and is not published.",
      list: [
        `MGSN canister: <span class="build-mono">${escapeHtml(state.mgsnCanister)}</span>.`,
        `BOB canister: <span class="build-mono">${escapeHtml(state.bobCanister)}</span>.`,
        state.poolId
          ? `MGSN/ICP pool id: <span class="build-mono">${escapeHtml(state.poolId)}</span>.`
          : "MGSN/ICP pool id is unavailable right now.",
        state.publicBuybackAccount
          ? `Buyback vault: <span class="build-mono">${escapeHtml(state.publicBuybackAccount)}</span>.`
          : `Buyback vault: ${escapeHtml(state.buybackBadge.label)}.`,
      ],
      statusLabel: state.programBadge.label,
      statusTone: state.programBadge.tone,
    },
  ];

  const daoCards = [
    {
      kicker: "Governance token",
      title: "Use MGSN as the governance unit",
      copy: "Tie decision rights to the asset the market already prices instead of inventing a disconnected token narrative.",
      list: [
        `Current MGSN canister: <span class="build-mono">${escapeHtml(state.mgsnCanister)}</span>.`,
        `Current circulating supply: ${escapeHtml(formatCompactNumber(state.circulatingSupply))} MGSN.`,
        "Voting power should align with treasury policy and operating budgets.",
      ],
      statusLabel: "existing asset",
      statusTone: "live",
    },
    {
      kicker: "Treasury surface",
      title: "Make treasury execution explicit",
      copy: "One treasury surface should hold reserves, receive revenue, and execute approved capital moves.",
      list: [
        "Hold ICP, BOB, and any treasury-owned MGSN.",
        state.publicBuybackAccount
          ? `Published buyback vault: <span class="build-mono">${escapeHtml(state.publicBuybackAccount)}</span>.`
          : "A public buyback vault still needs to be published.",
        state.stakingCanisterId
          ? `Published staking canister: <span class="build-mono">${escapeHtml(state.stakingCanisterId)}</span>.`
          : "No public staking canister has been published yet.",
      ],
      statusLabel: state.programBadge.label,
      statusTone: state.programBadge.tone,
    },
    {
      kicker: "Proposal lanes",
      title: "Governance should approve policy, not cosplay operations",
      copy: "Keep DAO scope focused on money decisions and reporting requirements instead of bloating it with unnecessary mechanics.",
      list: [
        "Revenue app budgets and roadmap priorities.",
        "Treasury allocation targets and reserve policy.",
        "MGSN buyback cadence and reporting rules.",
        "Analytics requirements for treasury, revenue, and supply.",
      ],
      statusLabel: "planned",
      statusTone: "planned",
    },
  ];

  const revenueCards = [
    {
      kicker: "Product shape",
      title: "A paid app has to exist first",
      copy: "The shortest honest path is a subscription or seat-based app that the DAO can eventually own.",
      list: [
        "ICP-native checkout and recurring access control.",
        "Simple entitlements instead of elaborate token theater.",
        "Treasury receives actual operating cashflow.",
      ],
      statusLabel: "missing unlock",
      statusTone: "new",
    },
    {
      kicker: "Compute discipline",
      title: "Keep the first revenue app thin",
      copy: "Heavy on-chain complexity before product-market proof just raises costs and slows iteration.",
      list: [
        "Favor simple writes, receipts, and entitlement checks.",
        "Keep the canister count low until demand is proven.",
        "Publish revenue events cleanly for treasury reporting.",
      ],
      statusLabel: "design rule",
      statusTone: "planned",
    },
    {
      kicker: "DAO hooks",
      title: "Revenue gives the treasury and DAO something real to govern",
      copy: "Once money flows in, treasury policy, buybacks, grants, and reporting stop being abstract.",
      list: [
        "Fund growth or treasury accumulation from realized revenue.",
        "Authorize MGSN buybacks from approved surplus.",
        "Track revenue quality directly inside the analytics layer.",
      ],
      statusLabel: "why it matters",
      statusTone: "preview",
    },
  ];

  const analyticsCards = [
    {
      kicker: "Dashboard",
      title: "Treasury value and market context",
      copy: "Reserve framing, mNAV context, and token market data already belong on the live dashboard.",
      list: [
        state.historyRange
          ? `History coverage: ${escapeHtml(state.historyRange)}.`
          : "History coverage is unavailable until live token-storage data returns.",
        state.poolLiquidity != null
          ? `Current MGSN/ICP liquidity: ${escapeHtml(formatCompactMoney(state.poolLiquidity))}.`
          : "Live pool liquidity unavailable.",
      ],
      statusLabel: state.marketBadge.label,
      statusTone: state.marketBadge.tone,
    },
    {
      kicker: "Strategy",
      title: "Capital policy and live calculators",
      copy: "This remains the modeling surface for sizing, timing, and capital-allocation thought experiments.",
      list: [
        "DCA, signal views, and capital-planning calculators.",
        "Useful for treasury policy before automation.",
      ],
      statusLabel: "live",
      statusTone: "live",
    },
    {
      kicker: "Buyback",
      title: "Execution and status surface",
      copy: "The shell already exists, and the Build page now mirrors whether buyback execution is truly published or still waiting on public treasury wiring.",
      list: [
        state.publicBuybackAccount
          ? `Vault account: <span class="build-mono">${escapeHtml(state.publicBuybackAccount)}</span>.`
          : "Vault account has not been published yet.",
        `Indexed fills: ${escapeHtml(String(state.buybackCount))}.`,
        state.buybackTrackedUsd > 0
          ? `${state.buybackEstimatedCount > 0 ? "Tracked buyback USD (estimated)" : "Tracked buyback USD"}: ${escapeHtml(formatCompactMoney(state.buybackTrackedUsd))}.`
          : state.buybackUnavailableCount > 0
            ? "Buyback transfers are indexed, but USD settlement values are still unpublished."
            : "No verified buyback fills have been indexed yet.",
      ],
      statusLabel: state.buybackBadge.label,
      statusTone: state.buybackBadge.tone,
    },
    {
      kicker: "Staking",
      title: "Lock state and reward posture",
      copy: "Staking may still be unpublished or only partially published, and the Build page now reflects that state instead of guessing.",
      list: [
        state.stakingCanisterId
          ? `Staking canister: <span class="build-mono">${escapeHtml(state.stakingCanisterId)}</span>.`
          : "No public staking canister has been published yet.",
        state.totalLocked > 0
          ? `Locked MGSN: ${escapeHtml(formatCompactNumber(state.totalLocked))} (${escapeHtml(formatPercent(state.lockedPct, 2))} of current supply).`
          : escapeHtml(state.stakingState.note),
      ],
      statusLabel: state.stakingBadge.label,
      statusTone: state.stakingBadge.tone,
    },
    {
      kicker: "Burn",
      title: "Supply retirements and community proof",
      copy: "The burn page already anchors one of the few fully objective supply-side stories in the product, and this page now reads that live state directly.",
      list: [
        state.totalBurned != null
          ? `Total burned: ${escapeHtml(formatCompactNumber(state.totalBurned))} MGSN.`
          : "Burn totals are unavailable right now.",
        state.burnState.burnAddress
          ? `Burn address: <span class="build-mono">${escapeHtml(state.burnState.burnAddress)}</span>.`
          : "Burn address unavailable.",
      ],
      statusLabel: state.burnBadge.label,
      statusTone: state.burnBadge.tone,
    },
    {
      kicker: "Revenue app",
      title: "The missing operating metric source",
      copy: "Revenue, retention, and subscription events are still the missing dataset the rest of the stack depends on.",
      list: [
        "Recurring revenue and payment quality.",
        "Conversion, churn, and entitlement activity.",
      ],
      statusLabel: "planned",
      statusTone: "new",
    },
    {
      kicker: "Build page",
      title: "Blueprint plus live truth surface",
      copy: "This page now hydrates from the same ICPSwap and ledger sources as the rest of the site, while still keeping sequencing and roadmap logic explicit.",
      list: [
        "Truthfully reports live, cached, or unavailable hydration state.",
        "Supports manual refresh without losing the roadmap context.",
      ],
      statusLabel: state.hydration === "live" ? "live module" : "operational",
      statusTone: state.hydration === "live" ? "live" : "preview",
    },
  ];

  const worksList = [
    "You ship a paid product before trying to financial-engineer value.",
    "Treasury rules stay legible: revenue in, reserve rotation, buybacks as output.",
    "DAO proposals focus on budgets, treasury policy, and reporting.",
    state.hasLiveMarket
      ? "The current market shell is already wired to live ICPSwap and ledger-backed state."
      : "The current market shell keeps market data unavailable instead of substituting a bundled snapshot.",
  ];

  const failsList = [
    "Treasury depends on speculative LP yield instead of actual cashflow.",
    "Buybacks happen without published accounting or treasury policy.",
    "DAO launches before there is anything concrete to govern.",
    "The app becomes an expensive on-chain maze before demand is proven.",
  ];

  const runtimeStatusHtml = buildBuildSourceChips(state);
  const refreshButtonLabel = isHydrating ? "Refreshing..." : "Refresh live data";

  return `
    ${buildPlatformHeaderHTML({
      activePage: "build",
      badgeText: headerBadgeText(state.hydration),
      priceLabel: "MGSN/USD",
      priceValue: formatTokenPrice(state.mgsnPrice),
      priceClass: state.hasLiveMarket ? "live" : "",
    })}
    <div class="page-body">
      <main class="main-content build-page">
        <section class="main-header">
          <div class="main-header-row">
            <div>
              <h1 class="main-title">MGSN Build Module</h1>
              <p class="main-subtitle">Revenue-first sequencing tied directly into live ICPSwap market state, on-chain ledger scans, and the current public program wiring.</p>
            </div>
            <div class="build-header-meta">
              ${renderStatusPill(state.marketBadge.label, state.marketBadge.tone)}
              ${renderStatusPill(state.buybackBadge.label, state.buybackBadge.tone)}
              ${renderStatusPill(state.stakingBadge.label, state.stakingBadge.tone)}
              ${renderStatusPill("revenue app still missing", "new")}
            </div>
          </div>
          <div class="build-runtime-bar">
            ${runtimeStatusHtml}
            <button class="build-refresh-btn" id="build-refresh" type="button"${isHydrating ? " disabled" : ""}>${refreshButtonLabel}</button>
          </div>
        </section>

        <section class="chart-panels">
          <article class="chart-panel build-section" id="summary">
            ${renderPanelHeader("Roadmap", "Revenue-first stack", "Build the money machine first, then formalize treasury and governance around it.")}
            <div class="build-anchor-row">
              ${SECTION_LINKS.map((section) => `<a class="build-anchor" href="#${section.id}">${escapeHtml(section.label)}</a>`).join("")}
            </div>
            <div class="build-live-grid">
              ${renderMetricCard({
                kicker: "Live market",
                title: "ICPSwap spot feed",
                valueHtml: escapeHtml(formatTokenPrice(state.mgsnPrice)),
                subvalueHtml: `BOB ${escapeHtml(formatTokenPrice(state.bobPrice))} · ICP ${escapeHtml(formatUsd(state.icpPrice, 2))}`,
                statusLabel: state.marketBadge.label,
                statusTone: state.marketBadge.tone,
                list: [
                  state.historyRange
                    ? `History coverage: ${escapeHtml(state.historyRange)}.`
                    : "History coverage is unavailable until live token-storage data returns.",
                  `MGSN canister: <span class="build-mono">${escapeHtml(state.mgsnCanister)}</span>.`,
                  state.totalPairs != null
                    ? `ICPSwap pairs tracked: ${escapeHtml(formatCompactNumber(state.totalPairs))}.`
                    : "Pair count unavailable right now.",
                ],
              })}
              ${renderMetricCard({
                kicker: "Pool activity",
                title: "MGSN / ICP liquidity",
                valueHtml: escapeHtml(formatCompactMoney(state.poolLiquidity)),
                subvalueHtml: state.volume30d != null
                  ? `30d volume ${escapeHtml(formatCompactMoney(state.volume30d))}`
                  : state.volume24h != null
                    ? `24h volume ${escapeHtml(formatCompactMoney(state.volume24h))}`
                    : "Volume feed unavailable",
                statusLabel: state.poolBadge.label,
                statusTone: state.poolBadge.tone,
                list: [
                  state.poolId
                    ? `Pool id: <span class="build-mono">${escapeHtml(state.poolId)}</span>.`
                    : "Pool id unavailable right now.",
                  state.volume24h != null
                    ? `24h volume: ${escapeHtml(formatCompactMoney(state.volume24h))}.`
                    : "24h volume unavailable.",
                  `ICP to BOB treasury route: <a class="build-link" href="${ICP_TO_BOB_SWAP_URL}" target="_blank" rel="noreferrer">ICPSwap swap path</a>.`,
                ],
              })}
              ${renderMetricCard({
                kicker: "Supply reality",
                title: "Circulating supply",
                valueHtml: `${escapeHtml(formatCompactNumber(state.circulatingSupply))} MGSN`,
                subvalueHtml: state.totalBurned != null
                  ? `${escapeHtml(formatCompactNumber(state.totalBurned))} burned${state.burnedPct != null ? ` · ${escapeHtml(formatPercent(state.burnedPct, 2))} retired` : ""}`
                  : "Burn ledger unavailable",
                statusLabel: state.burnBadge.label,
                statusTone: state.burnBadge.tone,
                list: [
                  state.burnState.burnAddress
                    ? `Burn address: <span class="build-mono">${escapeHtml(state.burnState.burnAddress)}</span>.`
                    : "Burn address unavailable.",
                  escapeHtml(state.burnState.note),
                ],
              })}
              ${renderMetricCard({
                kicker: "Program wiring",
                title: "Treasury execution state",
                valueHtml: escapeHtml(state.publicBuybackAccount || state.stakingCanisterId ? "Published" : "Pending"),
                subvalueHtml: escapeHtml(state.programBadge.label),
                statusLabel: state.programBadge.label,
                statusTone: state.programBadge.tone,
                list: [
                  state.publicBuybackAccount
                    ? `Buyback vault: <span class="build-mono">${escapeHtml(state.publicBuybackAccount)}</span>.`
                    : "Buyback vault account has not been published yet.",
                  state.stakingCanisterId
                    ? `Staking canister: <span class="build-mono">${escapeHtml(state.stakingCanisterId)}</span>.`
                    : "No public staking canister has been published yet.",
                  state.buybackTrackedUsd > 0
                    ? `${state.buybackEstimatedCount > 0 ? "Tracked buyback USD (estimated)" : "Tracked buyback USD"}: ${escapeHtml(formatCompactMoney(state.buybackTrackedUsd))}.`
                    : state.buybackUnavailableCount > 0
                      ? "Buyback transfers are indexed, but USD settlement values are still unpublished."
                      : `Buyback cadence model: every ${escapeHtml(String(BUYBACK_PROGRAM.intervalDays))} days.`,
                  state.totalLocked > 0
                    ? `Locked MGSN: ${escapeHtml(formatCompactNumber(state.totalLocked))} (${escapeHtml(formatPercent(state.lockedPct, 2))} of current supply).`
                    : escapeHtml(state.stakingState.note),
                ],
              })}
            </div>
            <div class="build-summary-grid">
              ${summaryCards.map((card) => renderCard(card)).join("")}
            </div>
            <div class="panel-stats-footer build-panel-footer">
              <div class="stat-chip">
                <span class="stat-chip-label">MGSN token</span>
                <span class="stat-chip-value build-mono">${escapeHtml(state.mgsnCanister)}</span>
              </div>
              <div class="stat-chip">
                <span class="stat-chip-label">BOB token</span>
                <span class="stat-chip-value build-mono">${escapeHtml(state.bobCanister)}</span>
              </div>
              <div class="stat-chip">
                <span class="stat-chip-label">ICP token</span>
                <span class="stat-chip-value build-mono">${escapeHtml(TOKEN_CANISTERS.ICP)}</span>
              </div>
              <div class="stat-chip">
                <span class="stat-chip-label">ICP to BOB route</span>
                <a class="stat-chip-value build-link build-mono" href="${ICP_TO_BOB_SWAP_URL}" target="_blank" rel="noreferrer">ICPSwap path</a>
              </div>
            </div>
          </article>

          <article class="chart-panel build-section" id="dao">
            ${renderPanelHeader("01", "SNS DAO", "Use MGSN as the governance asset and keep proposal scope tied to treasury and product decisions.")}
            <div class="build-card-grid">
              ${daoCards.map((card) => renderCard(card)).join("")}
            </div>
          </article>

          <article class="chart-panel build-section" id="treasury">
            ${renderPanelHeader("02", "Treasury Logic", "Simple beats clever: intake revenue, rotate approved capital, publish accounting, then execute buyback policy.")}
            <p class="build-note">The shortest honest treasury design is: subscription revenue lands in ICP, treasury can rotate approved working capital into BOB, and MGSN buybacks only happen after surplus and policy are visible. This page now surfaces the actual state of the buyback vault, burn ledger, and staking canister instead of assuming they are live.</p>
            <div class="build-flow-grid">
              <article class="build-flow-step">
                <p class="build-flow-step-number">Step 1</p>
                <h3 class="build-card-title">Collect revenue in ICP</h3>
                <p class="build-flow-copy">The revenue app should settle in ICP first so inflows are obvious and auditable.</p>
                ${renderList([
                  "Subscriptions and paid features settle to treasury.",
                  "Keep intake reporting plain enough for monthly treasury statements.",
                ])}
              </article>
              <article class="build-flow-step">
                <p class="build-flow-step-number">Step 2</p>
                <h3 class="build-card-title">Rotate approved capital into BOB</h3>
                <p class="build-flow-copy">If BOB is the treasury conviction asset, buy it deliberately rather than burying that choice inside a vague token story.</p>
                ${renderList([
                  `Use the <a class="build-link" href="${ICP_TO_BOB_SWAP_URL}" target="_blank" rel="noreferrer">ICP to BOB ICPSwap route</a> when policy allows.`,
                  "Move approved capital only, not every dollar blindly.",
                ])}
              </article>
              <article class="build-flow-step">
                <p class="build-flow-step-number">Step 3</p>
                <h3 class="build-card-title">Publish NAV and buyback outputs</h3>
                <p class="build-flow-copy">Treasury reporting and buyback execution should be outputs of the business, not the business itself.</p>
                ${renderList([
                  "Report reserve mix, realized revenue, and capital deployed.",
                  `Keep buyback cadence tied to approved policy, currently modeled every ${escapeHtml(String(BUYBACK_PROGRAM.intervalDays))} days.`,
                ])}
              </article>
            </div>
          </article>

          <article class="chart-panel build-section" id="revenue">
            ${renderPanelHeader("03", "Revenue App", "This is the missing piece that turns treasury and DAO logic from narrative into operations.")}
            <div class="build-card-grid">
              ${revenueCards.map((card) => renderCard(card)).join("")}
            </div>
          </article>

          <article class="chart-panel build-section" id="analytics">
            ${renderPanelHeader("04", "Analytics Layer", "Map live pages to the metrics they already cover, then add the operating metrics that do not exist yet.")}
            <div class="build-route-grid">
              ${analyticsCards.map((card) => renderCard(card)).join("")}
            </div>
          </article>

          <article class="chart-panel build-section" id="reality-check">
            ${renderPanelHeader("05", "Final Reality Check", "The system works only if revenue is real, treasury rules are legible, and governance arrives after substance.")}
            <div class="build-check-grid">
              <article class="build-check-card build-check-card--good">
                <div class="build-check-top">
                  <p class="build-card-kicker">What works</p>
                  ${renderStatusPill("build this", "live")}
                </div>
                <h3 class="build-check-title">A clean operating loop</h3>
                <p class="build-check-copy">Revenue, treasury policy, buybacks, and reporting reinforce each other when the order of operations is disciplined.</p>
                ${renderList(worksList)}
              </article>
              <article class="build-check-card build-check-card--risk">
                <div class="build-check-top">
                  <p class="build-card-kicker">What breaks</p>
                  ${renderStatusPill("avoid this", "preview")}
                </div>
                <h3 class="build-check-title">Narrative without operating proof</h3>
                <p class="build-check-copy">If the stack chases token complexity before product revenue, the treasury and DAO layers become decorative instead of useful.</p>
                ${renderList(failsList)}
              </article>
            </div>
          </article>
        </section>

        <footer class="page-footer">
          <p>Revenue-first blueprint wired into the live MGSN product shell, with cached first paint and explicit unavailable states when ICPSwap or ledger endpoints are offline.</p>
        </footer>
      </main>
    </div>`;
}

function renderBuildPage(state) {
  currentBuildState = state;
  app.innerHTML = buildPageHTML(state);

  const refreshButton = document.querySelector("#build-refresh");
  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      void hydrateBuildPage(true);
    });
  }
}

async function hydrateBuildPage(force = false) {
  if (isHydrating) {
    return;
  }

  isHydrating = true;

  if (force) {
    const previousState = currentBuildState ?? createFallbackBuildState("loading");
    renderBuildPage({
      ...previousState,
      hydration: previousState.hydration === "fallback" ? "loading" : "cached",
    });
  }

  try {
    const [dashboardResult, pricesResult, icpResult, poolResult, buybackResult, stakingResult, burnResult] =
      await Promise.allSettled([
        fetchDashboardData(force),
        fetchICPSwapPrices(force),
        fetchLiveSpotPrices(force),
        fetchICPSwapPoolStats(force),
        fetchBuybackProgramData(force),
        fetchStakingProgramData(force),
        fetchBurnProgramData(force),
      ]);

    const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
    const prices = pricesResult.status === "fulfilled" ? pricesResult.value : null;
    const icpSpot = icpResult.status === "fulfilled" ? icpResult.value : null;
    const poolStats = poolResult.status === "fulfilled" ? poolResult.value : null;
    const buybackState = buybackResult.status === "fulfilled" ? buybackResult.value : null;
    const stakingState = stakingResult.status === "fulfilled" ? stakingResult.value : null;
    const burnState = burnResult.status === "fulfilled" ? burnResult.value : null;

    const hasLivePayload = Boolean(
      dashboard ||
      prices?.mgsnUsd != null ||
      prices?.bobUsd != null ||
      icpSpot?.icpUsd != null ||
      poolStats?.mgsnPoolId ||
      poolStats?.mgsnLiq != null ||
      buybackState?.status === "live" ||
      stakingState?.status === "live" ||
      stakingState?.status === "configured" ||
      burnState?.status === "live"
    );

    if (hasLivePayload) {
      const nextState = deriveBuildState({
        dashboard,
        prices,
        icpSpot,
        poolStats,
        buybackState,
        stakingState,
        burnState,
        hydration: "live",
      });

      writeViewCache(BUILD_CACHE_KEY, nextState);
      renderBuildPage(nextState);
      return;
    }

    const cachedState = readViewCache(BUILD_CACHE_KEY, BUILD_CACHE_AGE_MS);
    if (cachedState) {
      renderBuildPage({ ...cachedState, hydration: "cached" });
      return;
    }

    renderBuildPage(createFallbackBuildState("fallback"));
  } finally {
    isHydrating = false;
    if (currentBuildState) {
      renderBuildPage(currentBuildState);
    }
  }
}

const cachedState = readViewCache(BUILD_CACHE_KEY, BUILD_CACHE_AGE_MS);
renderBuildPage(cachedState ? { ...cachedState, hydration: "cached" } : createFallbackBuildState("loading"));
void hydrateBuildPage();
setInterval(() => {
  void hydrateBuildPage(true);
}, 60_000);
