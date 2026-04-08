import "./styles.css";
import Chart from "chart.js/auto";

// Crosshair plugin — draws a vertical tracking line at the hovered data index
Chart.register({
  id: "crosshair",
  afterDraw(chart) {
    if (!chart.tooltip._active?.length) return;
    const ctx = chart.ctx;
    const x = chart.tooltip._active[0].element.x;
    const { top, bottom } = chart.chartArea;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(148,163,184,0.35)";
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();
  },
});

import {
  STAKING_PROGRAM,
  TOKEN_CANISTERS,
} from "./demoData";
import { fetchLiveSpotPrices, fetchICPSwapPrices, fetchICPSwapPoolStats } from "./liveData";
import { fetchStakingProgramData } from "./onChainData.js";
import { buildMobilePlatformNavHTML } from "./siteChrome.js";
import {
  applyScenarioToPoolStats,
  applyScenarioToPrices,
  attachScenarioStudio,
  buildScenarioHeaderHTML,
  buildStakingSourceChips,
  loadScenarioState,
  readViewCache,
  writeViewCache,
} from "./siteState.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const ICPSWAP_SWAP_URL =
  `https://app.icpswap.com/swap?input=${TOKEN_CANISTERS.ICP}&output=${TOKEN_CANISTERS.MGSN}`;
const STAKING_CACHE_KEY = "staking-page-live-v1";

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(v, d = 2) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: d, maximumFractionDigits: d,
  }).format(v);
}
function compact(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
}
function compactMoney(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    notation: "compact", maximumFractionDigits: 2,
  }).format(v);
}

// ── Staking math ──────────────────────────────────────────────────────────────

/**
 * Compute monthly reward pool (USD) for stakers.
 * = monthly trading volume × fee rate × revenueSharePct / 100
 */
function monthlyRewardPool(livePoolStats) {
  const monthlyVol = livePoolStats?.mgsnVol30d
    ?? (livePoolStats?.mgsnVol24h ? livePoolStats.mgsnVol24h * 30 : STAKING_PROGRAM.monthlyVolEst);
  return monthlyVol * STAKING_PROGRAM.poolFee * (STAKING_PROGRAM.revenueSharePct / 100);
}

/**
 * Compute estimated APY for a user staking `mgsnAmount` tokens at a given tier.
 * User's weight = mgsnAmount × tierMultiplier
 * Assumed total staked supply (for projection) = `totalStakedMgsn`
 * APY = (annual reward share / USD value of stake)
 */
function computeAPY(mgsnAmount, tier, totalStakedMgsn, totalWeightedStake, mgsnNow, livePoolStats) {
  const monthly = monthlyRewardPool(livePoolStats);
  const annual  = monthly * 12;

  const userWeight  = mgsnAmount * tier.multiplier;
  const totalWeight = totalWeightedStake;
  const userShare   = totalWeight > 0 ? userWeight / totalWeight : 1;

  const annualUsd   = annual * userShare;
  const stakeValueUsd = typeof mgsnNow === "number" && Number.isFinite(mgsnNow)
    ? mgsnAmount * mgsnNow
    : null;
  const apy = stakeValueUsd > 0 ? (annualUsd / stakeValueUsd) * 100 : 0;

  return {
    monthly: monthly * userShare,
    annual:  annualUsd,
    apy,
    userShare: userShare * 100,
    userWeight,
    totalWeight,
    stakeValueUsd,
  };
}

/**
 * Project the cumulative reward earned over N months for a given stake at a tier.
 */
function projectRewards(mgsnAmount, tier, totalStakedMgsn, totalWeightedStake, mgsnNow, livePoolStats, months = 12) {
  const r = computeAPY(mgsnAmount, tier, totalStakedMgsn, totalWeightedStake, mgsnNow, livePoolStats);
  return Array.from({ length: months }, (_, i) => ({
    month: i + 1,
    monthly: r.monthly,
    cumulative: r.monthly * (i + 1),
  }));
}

/**
 * Compute total staking metrics from current on-chain staking state.
 */
function computeStakingMetrics(mgsnNow, stakingState) {
  const positions = stakingState?.positions ?? [];
  const totalSupply = stakingState?.currentSupply ?? null;
  const totalMgsn   = positions.reduce((a, p) => a + (p.mgsnLocked ?? 0), 0);
  const totalWeight = positions.reduce((a, p) => {
    const tier = STAKING_PROGRAM.tiers.find((t) => t.label === p.tier) ?? STAKING_PROGRAM.tiers[0];
    return a + (p.mgsnLocked ?? 0) * tier.multiplier;
  }, 0);
  const pctSupply   = totalSupply > 0 ? (totalMgsn / totalSupply) * 100 : 0;
  const valueUsd    = typeof mgsnNow === "number" && Number.isFinite(mgsnNow) ? totalMgsn * mgsnNow : null;
  return {
    totalMgsn,
    totalWeight,
    pctSupply,
    totalSupply,
    valueUsd,
    positionCount: positions.length,
  };
}

// ── Chart ─────────────────────────────────────────────────────────────────────

let rewardChart = null;
let supplyChart = null;

function renderRewardChart(projection) {
  const el = document.getElementById("chart-rewards");
  if (!el) return;
  el.width  = Math.max((el.parentElement?.clientWidth ?? 500) - 32, 240);
  el.height = 200;

  if (rewardChart) rewardChart.destroy();
  rewardChart = new Chart(el, {
    type: "bar",
    data: {
      labels: projection.map((r) => `M${r.month}`),
      datasets: [
        {
          label: "Monthly reward (USD)",
          data: projection.map((r) => r.monthly),
          backgroundColor: "rgba(139,92,246,0.65)",
          borderRadius: 4,
        },
        {
          type: "line",
          label: "Cumulative (USD)",
          data: projection.map((r) => r.cumulative),
          borderColor: "#a78bfa",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.35,
          yAxisID: "yCum",
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true, position: "top",
          labels: { color: "#5a6a8a", font: { family: "'IBM Plex Mono', monospace", size: 10 }, boxWidth: 12, padding: 14 },
        },
        tooltip: {
          backgroundColor: "#0f1120", borderColor: "#1a1f3a", borderWidth: 1,
          titleColor: "#f0f4ff", bodyColor: "#94a3b8", padding: 10,
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${compactMoney(ctx.raw)}` },
        },
      },
      scales: {
        x: { grid: { color: "#1a1f3a" }, ticks: { color: "#5a6a8a", font: { family: "'IBM Plex Mono', monospace", size: 10 } }, border: { color: "#1a1f3a" } },
        y: { grid: { color: "#1a1f3a" }, ticks: { color: "#5a6a8a", font: { family: "'IBM Plex Mono', monospace", size: 10 }, callback: (v) => compactMoney(v) }, border: { color: "#1a1f3a" } },
        yCum: { position: "right", grid: { drawOnChartArea: false }, ticks: { color: "#a78bfa", font: { family: "'IBM Plex Mono', monospace", size: 10 }, callback: (v) => compactMoney(v) }, border: { color: "#1a1f3a" } },
      },
    },
  });
}

function renderSupplyChart(stakePct) {
  const el = document.getElementById("chart-supply");
  if (!el) return;
  el.width  = Math.max((el.parentElement?.clientWidth ?? 260) - 32, 180);
  el.height = 200;

  if (supplyChart) supplyChart.destroy();

  // Scenario: what if 5%, 10%, 20%, 30% of supply is staked
  const scenarios = [
    { label: "Current", locked: stakePct },
    { label: "5%",   locked: 5  },
    { label: "10%",  locked: 10 },
    { label: "20%",  locked: 20 },
    { label: "30%",  locked: 30 },
  ].sort((a, b) => a.locked - b.locked);

  supplyChart = new Chart(el, {
    type: "bar",
    data: {
      labels: scenarios.map((s) => s.label),
      datasets: [
        {
          label: "Locked %",
          data: scenarios.map((s) => s.locked),
          backgroundColor: scenarios.map((s) =>
            s.label === "Current" ? "rgba(249,115,22,0.7)" : "rgba(139,92,246,0.55)"
          ),
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0f1120", borderColor: "#1a1f3a", borderWidth: 1,
          titleColor: "#f0f4ff", bodyColor: "#94a3b8", padding: 10,
          callbacks: { label: (ctx) => ` Locked: ${ctx.raw.toFixed(1)}% of supply` },
        },
      },
      scales: {
        x: { grid: { color: "#1a1f3a" }, ticks: { color: "#5a6a8a", font: { family: "'IBM Plex Mono', monospace", size: 10 } }, border: { color: "#1a1f3a" } },
        y: { max: 35, grid: { color: "#1a1f3a" }, ticks: { color: "#5a6a8a", font: { family: "'IBM Plex Mono', monospace", size: 10 }, callback: (v) => `${v}%` }, border: { color: "#1a1f3a" } },
      },
    },
  });
}

// ── Tier card renderer ────────────────────────────────────────────────────────

function tierCard(tier, metrics, livePoolStats, mgsnNow) {
  const projection = projectRewards(1_000_000, tier, metrics.totalMgsn, metrics.totalWeight || 1_000_000, mgsnNow, livePoolStats);
  const r          = computeAPY(1_000_000, tier, metrics.totalMgsn, metrics.totalWeight || 1_000_000, mgsnNow, livePoolStats);
  const colorClass = tier.days === 365 ? "diamond" : tier.days === 180 ? "believer" : tier.days === 90 ? "committed" : "starter";
  return `
    <div class="sk-tier-card sk-tier-${colorClass}">
      <div class="sk-tier-badge">${tier.badge}</div>
      <div class="sk-tier-label">${tier.label}</div>
      <div class="sk-tier-mult">${tier.multiplier}× weight</div>
      <div class="sk-tier-apy">${r.apy > 0 ? r.apy.toFixed(1) + "% APY" : "—"}</div>
      <div class="sk-tier-note">per 1M MGSN staked</div>
    </div>`;
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildHTML(metrics, livePoolStats, mgsnNow, icpNow, stakingState, scenarioHeaderHtml) {
  const monthly    = monthlyRewardPool(livePoolStats);
  const hasRealVolume = livePoolStats?.mgsnVol30d != null || livePoolStats?.mgsnVol24h != null;
  const liveTag    = hasRealVolume
      ? `<span class="sk-live-tag">real ICPSwap volume</span>`
      : `<span class="sk-live-tag sk-live-tag--est">estimated</span>`;
  const effectiveFloat = typeof metrics.totalSupply === "number" && Number.isFinite(metrics.totalSupply)
    ? metrics.totalSupply - metrics.totalMgsn
    : null;
  const floatReduction  = metrics.pctSupply;
  const statusBanner = stakingState?.status === "prelaunch"
    ? `No public staking canister has been published yet. Reward assumptions can still be modeled here, but no live staking positions are shown.`
    : stakingState?.status === "configured"
      ? `A public staking canister is configured. Publish position methods and this page can switch from configuration status to live lock tiers and unlock dates.`
      : stakingState?.status === "unavailable"
        ? `The live staking state is temporarily unavailable. Reward estimates continue to use the current pool activity feed when it is reachable.`
        : `Staking positions are coming directly from the on-chain program.`;

  return `
    <header class="top-header">
      <div class="top-header-logo">
        <div class="logo-icon">M</div>
        <div>
          <div class="logo-title">MGSN Strategy Tracker</div>
          <div class="logo-subtitle">on Internet Computer</div>
        </div>
      </div>
      <nav class="sk-nav">
        <a class="sk-nav-link" href="/">Dashboard</a>
        <a class="sk-nav-link" href="/strategy.html">Strategy</a>
        <a class="sk-nav-link" href="/buyback.html">Buyback</a>
        <a class="sk-nav-link active" href="/staking.html">Staking</a>
        <a class="sk-nav-link" href="/burn.html">Burn</a>
      </nav>
      <div class="top-header-spacer"></div>
      <div class="top-header-badge"><div class="live-dot"></div><span class="badge-text">Supply compression</span></div>
      <div class="top-header-icp">
        <span class="header-price-label">MGSN/USD</span>
        <span class="header-price-val" id="sk-mgsn-price">${mgsnNow ? fmt(mgsnNow, 7) : "—"}</span>
      </div>
    </header>
    ${buildMobilePlatformNavHTML("staking")}

    <div class="sk-page">
      ${scenarioHeaderHtml}

      <!-- Hero -->
      <section class="sk-hero">
        <div class="sk-hero-left">
          <div class="sk-hero-eyebrow">MGSN Staking Program · Revenue-share model</div>
          <h1 class="sk-hero-title">Lock $MGSN.<br>Earn fee revenue.<br>Compress circulating supply.</h1>
          <p class="sk-hero-body">
            The MGSN Staking Program lets holders voluntarily lock their tokens for a fixed period in exchange for a share of LP fee income. Every token locked is removed from the tradeable float — reducing sell pressure and providing structural price support. Longer locks earn a higher weight multiplier, rewarding long-term conviction.
          </p>
          <div class="sk-hero-stats">
            <div class="sk-stat">
              <span class="sk-stat-label">MGSN staked</span>
              <span class="sk-stat-val violet">${compact(metrics.totalMgsn)}</span>
            </div>
            <div class="sk-stat">
              <span class="sk-stat-label">% of supply locked</span>
              <span class="sk-stat-val ${floatReduction > 0 ? "violet" : ""}">${floatReduction.toFixed(2)}%</span>
            </div>
            <div class="sk-stat">
              <span class="sk-stat-label">Effective float</span>
              <span class="sk-stat-val">${effectiveFloat != null ? `${compact(effectiveFloat)} MGSN` : "Unavailable"}</span>
            </div>
            <div class="sk-stat">
              <span class="sk-stat-label">Monthly reward pool</span>
              <span class="sk-stat-val pos">${fmt(monthly)}</span>
            </div>
            <div class="sk-stat">
              <span class="sk-stat-label">Program launch</span>
              <span class="sk-stat-val gold">${STAKING_PROGRAM.launchDate}</span>
            </div>
          </div>
          <div class="sk-coming-soon-banner">
            <span class="sk-coming-soon-icon">◎</span>
            <span>${statusBanner}</span>
          </div>
        </div>
        <div class="sk-hero-right">
          <div class="sk-cta-card">
            <p class="sk-cta-label">Get ready to stake</p>
            <p class="sk-cta-body">Staking requires holding MGSN. You can acquire MGSN now on ICPSwap before the staking program opens.</p>
            <a class="sk-cta-btn sk-cta-primary" href="${ICPSWAP_SWAP_URL}" target="_blank" rel="noopener noreferrer">Buy MGSN now →</a>
            <a class="sk-cta-btn sk-cta-secondary" href="/buyback.html">View buyback program</a>
            <p class="sk-cta-disclaimer">Staking smart contracts will be deployed on ICP mainnet. Not financial advice.</p>
          </div>
        </div>
      </section>

      <!-- How it works -->
      <section class="sk-section">
        <h2 class="sk-section-title">How the staking program works</h2>
        <div class="sk-how-grid">
          <div class="sk-how-card">
            <div class="sk-how-num">01</div>
            <div class="sk-how-head">Choose a lock tier</div>
            <p class="sk-how-body">Select a 30, 90, 180, or 365-day lock period. Longer locks earn a higher weight multiplier (up to 3×), giving you a larger share of the reward pool.</p>
          </div>
          <div class="sk-how-card">
            <div class="sk-how-num">02</div>
            <div class="sk-how-head">Tokens are locked on-chain</div>
            <p class="sk-how-body">Your MGSN is locked in an ICP smart contract for the chosen period. It cannot be sold or transferred during the lock. This removal from the float is immediate and verifiable on-chain.</p>
          </div>
          <div class="sk-how-card">
            <div class="sk-how-num">03</div>
            <div class="sk-how-head">Earn LP fee revenue</div>
            <p class="sk-how-body">${STAKING_PROGRAM.revenueSharePct}% of all fee income earned from the MGSN/ICP pool on ICPSwap is distributed to stakers monthly, proportional to each staker's weighted position.</p>
          </div>
          <div class="sk-how-card">
            <div class="sk-how-num">04</div>
            <div class="sk-how-head">Unlock at expiry</div>
            <p class="sk-how-body">At the end of the lock period, your MGSN is returned in full. The accumulated fee rewards are also released. You may re-lock immediately to continue earning.</p>
          </div>
        </div>
      </section>

      <!-- Tier breakdown -->
      <section class="sk-section">
        <h2 class="sk-section-title">Lock tiers</h2>
        <p class="sk-section-sub">APY estimates assume 1,000,000 MGSN staked. Actual yield depends on total staked supply and trading volume. ${liveTag}</p>
        <div class="sk-tier-grid">
          ${STAKING_PROGRAM.tiers.map((t) => tierCard(t, metrics, livePoolStats, mgsnNow)).join("")}
        </div>
        <div class="sk-tier-table-wrap">
          <table class="sk-tier-table">
            <thead>
              <tr><th>Tier</th><th>Lock period</th><th>Weight multiplier</th><th>Est. APY (1M MGSN)</th><th>Early unlock</th></tr>
            </thead>
            <tbody>
              ${STAKING_PROGRAM.tiers.map((t) => {
                const r = computeAPY(1_000_000, t, metrics.totalMgsn, metrics.totalWeight || 1_000_000, mgsnNow, livePoolStats);
                return `<tr>
                  <td>${t.badge}</td>
                  <td>${t.days} days</td>
                  <td>${t.multiplier}×</td>
                  <td class="pos">${r.apy > 0 ? r.apy.toFixed(1) + "%" : "—"}</td>
                  <td class="muted">Not available</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <!-- APY Calculator -->
      <section class="sk-section">
        <h2 class="sk-section-title">Reward estimator</h2>
        <p class="sk-section-sub">Estimate your monthly and annual fee revenue based on your MGSN holdings and chosen lock tier.</p>
        <div class="sk-calc-grid">
          <div class="sk-calc-card">
            <label class="sk-input-label">MGSN to stake</label>
            <input id="sk-amount" type="number" class="sk-input" value="1000000" min="1" step="100000" />
            <label class="sk-input-label" style="margin-top:12px">Lock tier</label>
            <select id="sk-tier" class="sk-input sk-select">
              ${STAKING_PROGRAM.tiers.map((t, i) => `<option value="${i}"${i === 1 ? " selected" : ""}>${t.label} (${t.multiplier}× — ${t.badge})</option>`).join("")}
            </select>
            <div id="sk-calc-results" class="sk-calc-results"></div>
          </div>
          <div class="sk-calc-card">
            <span class="sk-calc-section-label">12-month reward projection</span>
            <div style="height:200px; overflow:hidden"><canvas id="chart-rewards"></canvas></div>
          </div>
        </div>
      </section>

      <!-- Supply impact -->
      <section class="sk-section">
        <h2 class="sk-section-title">Impact on circulating supply</h2>
        <p class="sk-section-sub">As more holders stake, the effective tradeable float shrinks — tightening price discovery and reducing sell-side liquidity.</p>
        <div class="sk-supply-grid">
          <div class="sk-calc-card">
            <span class="sk-calc-section-label">Locked supply scenarios vs. current</span>
            <div style="height:200px; overflow:hidden"><canvas id="chart-supply"></canvas></div>
          </div>
          <div class="sk-calc-card">
            <div class="sk-supply-table">
              <div class="sk-supply-row sk-supply-header">
                <span>% locked</span><span>Float remaining</span><span>USD value locked</span>
              </div>
              ${[0, 5, 10, 20, 30].map((pct) => {
                const locked = typeof metrics.totalSupply === "number" && Number.isFinite(metrics.totalSupply)
                  ? Math.round(metrics.totalSupply * pct / 100)
                  : null;
                const float = locked != null ? metrics.totalSupply - locked : null;
                const usd = locked != null && typeof mgsnNow === "number" && Number.isFinite(mgsnNow)
                  ? locked * mgsnNow
                  : null;
                return `<div class="sk-supply-row${pct === Math.round(floatReduction) ? " sk-supply-row--current" : ""}">
                  <span class="${pct > 0 ? "violet" : "muted"}">${pct}%${pct === 0 ? " (none)" : ""}</span>
                  <span>${float != null ? `${compact(float)} MGSN` : "Unavailable"}</span>
                  <span class="pos">${fmt(usd)}</span>
                </div>`;
              }).join("")}
            </div>
            <p class="sk-supply-note">A 20% reduction in float has historically corresponded to 25–40% price improvement in comparable DeFi tokens, as sell walls thin and bid depth strengthens relative to available supply.</p>
          </div>
        </div>
      </section>

      <!-- Revenue sharing mechanics -->
      <section class="sk-section">
        <h2 class="sk-section-title">How revenue sharing works</h2>
        <div class="sk-mech-grid">
          <div class="sk-mech-card">
            <div class="sk-mech-icon">⊕</div>
            <div class="sk-mech-title">Weighted distribution</div>
            <p class="sk-mech-body">Each staker's share of the reward pool equals their weighted stake divided by the total weighted stake. <code>weight = MGSN × multiplier</code>. A 365-day staker with 1M MGSN has 3× the weight of a 30-day staker with 1M MGSN.</p>
          </div>
          <div class="sk-mech-card">
            <div class="sk-mech-icon">◑</div>
            <div class="sk-mech-title">Fee income source</div>
            <p class="sk-mech-body">The reward pool is funded by 50% of LP fee income from the MGSN/ICP pool on ICPSwap. The other 50% funds the buyback program. Together they represent 100% of fee income being reinvested into MGSN value.</p>
          </div>
          <div class="sk-mech-card">
            <div class="sk-mech-icon">▷</div>
            <div class="sk-mech-title">Monthly distribution</div>
            <p class="sk-mech-body">Rewards accumulate throughout the month and are distributed on the 1st of each month. Distribution is on-chain and verifiable. Rewards are paid in ICP or MGSN depending on the fee structure at distribution time.</p>
          </div>
          <div class="sk-mech-card">
            <div class="sk-mech-icon">△</div>
            <div class="sk-mech-title">Compounding</div>
            <p class="sk-mech-body">Reward earnings can be used to purchase additional MGSN and re-staked immediately at the user's discretion. Compounding monthly at a 90-day tier substantially increases effective APY over a 12-month horizon.</p>
          </div>
        </div>
      </section>

      <!-- Combined program overview -->
      <section class="sk-section">
        <h2 class="sk-section-title">Combined protocol: Buyback + Staking</h2>
        <p class="sk-section-sub">Both programs run simultaneously, each consuming 50% of LP fee income. Together they cover 100% of protocol revenue re-invested into $MGSN value.</p>
        <div class="sk-combined-grid">
          <div class="sk-combined-card sk-combined-buyback">
            <div class="sk-combined-label">Buyback Program</div>
            <div class="sk-combined-pct">50%</div>
            <div class="sk-combined-desc">of LP fees</div>
            <p class="sk-combined-body">Used to purchase MGSN from the open market and permanently remove it from circulation. Reduces total supply. Creates predictable demand floor.</p>
            <a class="sk-cta-btn sk-cta-secondary" style="margin-top:10px;font-size:0.75rem" href="/buyback.html">View Buyback Program →</a>
          </div>
          <div class="sk-combined-divider">+</div>
          <div class="sk-combined-card sk-combined-staking">
            <div class="sk-combined-label">Staking Program</div>
            <div class="sk-combined-pct sk-combined-pct--violet">50%</div>
            <div class="sk-combined-desc">of LP fees</div>
            <p class="sk-combined-body">Distributed as yield to token holders who voluntarily lock their MGSN. Reduces effective float. Rewards long-term holding with fee revenue.</p>
            <span class="sk-cta-btn sk-cta-secondary" style="margin-top:10px;font-size:0.75rem;display:block;text-align:center;opacity:0.6;cursor:default">Active on this page</span>
          </div>
          <div class="sk-combined-equals">=</div>
          <div class="sk-combined-card sk-combined-result">
            <div class="sk-combined-label">Net effect</div>
            <div class="sk-combined-pct sk-combined-pct--gold">100%</div>
            <div class="sk-combined-desc">reinvested</div>
            <p class="sk-combined-body">Every dollar of fee revenue generated by the protocol is recycled back into $MGSN — either as direct demand (buyback) or as supply reduction + holder rewards (staking). Zero leakage.</p>
          </div>
        </div>
      </section>

      <!-- Registration -->
      <section class="sk-section sk-register">
        <div class="sk-register-inner">
          <h2 class="sk-register-title">Register early interest</h2>
          <p class="sk-register-body">
            Staking contracts deploy on <strong>${STAKING_PROGRAM.launchDate}</strong>. To be notified when staking opens, and to reserve priority access for the first reward epoch, join the MGSN community channels below.
          </p>
          <div class="sk-register-btns">
            <a class="sk-cta-btn sk-cta-primary" href="${ICPSWAP_SWAP_URL}" target="_blank" rel="noopener noreferrer">Acquire MGSN now →</a>
            <a class="sk-cta-btn sk-cta-secondary" href="/buyback.html">View Buyback Program</a>
            <a class="sk-cta-btn sk-cta-secondary" href="/strategy.html">Strategy Engine</a>
          </div>
          <p class="sk-register-disclaimer">Staking involves locking tokens and accepting smart-contract risk. Program parameters may be adjusted before launch. Not financial advice.</p>
        </div>
      </section>

      <div class="page-footer" style="padding:24px 0 60px">
        <p>Staking position data appears here only after the public ICP contract exposes a live read surface.</p>
        <p style="margin-top:4px">Powered by <a href="https://icpswap.com" target="_blank" rel="noopener noreferrer">ICPSwap</a> · Deployed on Internet Computer</p>
      </div>
    </div>`;
}

// ── Calc renderer ─────────────────────────────────────────────────────────────

function renderCalc(metrics, livePoolStats, mgsnNow) {
  const amount  = parseFloat(document.getElementById("sk-amount")?.value) || 1_000_000;
  const tierIdx = parseInt(document.getElementById("sk-tier")?.value ?? "1");
  const tier    = STAKING_PROGRAM.tiers[tierIdx] ?? STAKING_PROGRAM.tiers[1];
  const hasRealVolume = livePoolStats?.mgsnVol30d != null || livePoolStats?.mgsnVol24h != null;

  const totalStaked  = metrics.totalMgsn  || 1_000_000;  // use 1M as baseline if no stakers yet
  const totalWeight  = metrics.totalWeight || 1_000_000;

  const userWeight      = amount * tier.multiplier;
  const totalWeightNew  = totalWeight + userWeight;  // include user in denominator

  const r = computeAPY(amount, tier, totalStaked, totalWeightNew, mgsnNow, livePoolStats);

  const resEl = document.getElementById("sk-calc-results");
  if (resEl) {
    resEl.innerHTML = `
      <div class="sk-calc-divider"></div>
      <div class="sk-calc-row"><span class="sk-calc-label">Your weight</span><span class="sk-calc-val">${compact(userWeight)}</span></div>
      <div class="sk-calc-row"><span class="sk-calc-label">Your pool share</span><span class="sk-calc-val">${r.userShare.toFixed(2)}%</span></div>
      <div class="sk-calc-row"><span class="sk-calc-label">Est. monthly reward</span><span class="sk-calc-val pos">${fmt(r.monthly)}</span></div>
      <div class="sk-calc-row"><span class="sk-calc-label">Est. annual reward</span><span class="sk-calc-val pos">${fmt(r.annual)}</span></div>
      <div class="sk-calc-row"><span class="sk-calc-label">Est. APY</span><span class="sk-calc-val violet">${r.apy.toFixed(1)}%</span></div>
      <div class="sk-calc-row"><span class="sk-calc-label">Stake value (USD)</span><span class="sk-calc-val">${fmt(r.stakeValueUsd)}</span></div>
      <div class="sk-calc-row"><span class="sk-calc-label">Volume basis</span><span class="sk-calc-val">${hasRealVolume ? "ICPSwap 30d history" : "Configured estimate"}</span></div>
      <div class="sk-calc-row sk-calc-row--note"><span>Monthly reward pool (total)</span><span>${fmt(monthlyRewardPool(livePoolStats))}</span></div>`;
  }

  const projection = projectRewards(amount, tier, totalStaked, totalWeightNew, mgsnNow, livePoolStats);
  renderRewardChart(projection);
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const STAKING_CSS = `
.sk-page { padding-top: var(--header-h); max-width: 1200px; margin: 0 auto; padding-left: 24px; padding-right: 24px; padding-bottom: 60px; }

/* Nav */
.sk-nav { display: flex; align-items: center; gap: 2px; margin-left: 24px; }
.sk-nav-link { padding: 6px 14px; border-radius: var(--radius-md); font-size: 0.78rem; font-weight: 500; color: var(--muted); text-decoration: none; transition: background 120ms, color 120ms; font-family: "IBM Plex Mono", monospace; letter-spacing: 0.03em; }
.sk-nav-link:hover { color: var(--ink); background: rgba(255,255,255,0.05); }
.sk-nav-link.active { color: #a78bfa; background: rgba(139,92,246,0.1); }

/* Hero */
.sk-hero { display: flex; align-items: flex-start; gap: 32px; padding: 32px 0 28px; border-bottom: 1px solid var(--panel-border); flex-wrap: wrap; }
.sk-hero-left { flex: 1; min-width: 300px; }
.sk-hero-right { flex-shrink: 0; }
.sk-hero-eyebrow { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 10px; }
.sk-hero-title { font-size: 2.0rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 14px; color: var(--ink); }
.sk-hero-body { font-size: 0.88rem; color: var(--ink2); max-width: 560px; line-height: 1.7; margin: 0 0 20px; }
.sk-hero-stats { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 16px; }
.sk-stat { display: flex; flex-direction: column; gap: 3px; }
.sk-stat-label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.sk-stat-val { font-size: 1.1rem; font-weight: 700; color: var(--ink); font-family: "IBM Plex Mono", monospace; }
.sk-stat-val.violet { color: #a78bfa; } .sk-stat-val.pos { color: var(--positive); } .sk-stat-val.gold { color: var(--gold); }

/* Coming soon banner */
.sk-coming-soon-banner { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: rgba(139,92,246,0.08); border: 1px solid rgba(139,92,246,0.25); border-radius: var(--radius-md); font-size: 0.76rem; color: var(--ink2); font-family: "IBM Plex Mono", monospace; }
.sk-coming-soon-icon { color: #a78bfa; font-size: 1rem; flex-shrink: 0; }

/* CTA card */
.sk-cta-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-xl); padding: 22px; min-width: 220px; display: flex; flex-direction: column; gap: 10px; }
.sk-cta-label { font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin: 0; }
.sk-cta-body { font-size: 0.76rem; color: var(--ink2); line-height: 1.6; margin: 0; }
.sk-cta-btn { display: block; padding: 10px 18px; border-radius: var(--radius-md); font-size: 0.84rem; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; transition: opacity 140ms; }
.sk-cta-btn:hover { opacity: 0.85; }
.sk-cta-primary { background: linear-gradient(135deg, #7c3aed, #4f46e5); color: #fff; }
.sk-cta-secondary { background: var(--surface); border: 1px solid var(--panel-border); color: var(--ink2); }
.sk-cta-disclaimer { font-size: 0.62rem; color: var(--muted-alt); font-family: "IBM Plex Mono", monospace; margin: 0; text-align: center; line-height: 1.5; }

/* Section */
.sk-section { padding: 28px 0 0; }
.sk-section-title { font-size: 0.82rem; font-weight: 700; color: var(--ink); letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 4px; font-family: "IBM Plex Mono", monospace; }
.sk-section-sub { font-size: 0.74rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin: 0 0 14px; max-width: 720px; }
.sk-live-tag { font-size: 0.62rem; padding: 2px 8px; border-radius: 4px; background: rgba(34,197,94,0.12); color: var(--positive); font-family: "IBM Plex Mono", monospace; margin-left: 4px; }
.sk-live-tag--est { background: rgba(245,158,11,0.12); color: var(--gold); }
.sk-live-tag--demo { background: rgba(249,115,22,0.12); color: var(--mgsn); }

/* How-it-works */
.sk-how-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px,1fr)); gap: 12px; margin-top:16px; }
.sk-how-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 18px; }
.sk-how-num { font-size: 0.62rem; font-weight: 700; color: #a78bfa; font-family: "IBM Plex Mono", monospace; letter-spacing: 0.1em; margin-bottom: 8px; }
.sk-how-head { font-size: 0.84rem; font-weight: 700; color: var(--ink); margin-bottom: 8px; }
.sk-how-body { font-size: 0.74rem; color: var(--ink2); line-height: 1.65; margin: 0; }

/* Tier cards */
.sk-tier-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-top: 14px; margin-bottom: 16px; }
.sk-tier-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 18px 14px; text-align: center; position: relative; overflow: hidden; }
.sk-tier-badge { position: absolute; top: 8px; right: 10px; font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.12em; font-family: "IBM Plex Mono", monospace; }
.sk-tier-label { font-size: 0.78rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 8px; font-weight: 600; }
.sk-tier-mult { font-size: 1.3rem; font-weight: 800; margin-bottom: 4px; }
.sk-tier-apy { font-size: 1.0rem; font-weight: 700; margin-bottom: 4px; }
.sk-tier-note { font-size: 0.6rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.sk-tier-starter .sk-tier-badge, .sk-tier-starter .sk-tier-mult { color: var(--ink2); }
.sk-tier-starter .sk-tier-apy { color: var(--positive); }
.sk-tier-committed .sk-tier-badge, .sk-tier-committed .sk-tier-mult { color: #60a5fa; }
.sk-tier-committed .sk-tier-apy { color: var(--positive); }
.sk-tier-believer .sk-tier-badge, .sk-tier-believer .sk-tier-mult { color: #a78bfa; }
.sk-tier-believer .sk-tier-apy { color: var(--positive); }
.sk-tier-diamond .sk-tier-badge, .sk-tier-diamond .sk-tier-mult { color: var(--gold); }
.sk-tier-diamond .sk-tier-apy { color: var(--positive); }
.sk-tier-diamond { border-color: rgba(245,158,11,0.3); }

/* Tier table */
.sk-tier-table-wrap { overflow-x: auto; }
.sk-tier-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; font-family: "IBM Plex Mono", monospace; }
.sk-tier-table th { padding: 8px 12px; text-align: left; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); border-bottom: 1px solid var(--line); }
.sk-tier-table td { padding: 9px 12px; border-bottom: 1px solid var(--line); color: var(--ink2); }
.sk-tier-table .pos { color: var(--positive); font-weight: 600; }
.sk-tier-table .muted { color: var(--muted); }

/* Calculator */
.sk-calc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sk-calc-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 16px 18px; }
.sk-input-label { display: block; font-size: 0.67rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 5px; }
.sk-input { width: 100%; padding: 8px 11px; background: var(--surface); border: 1px solid var(--panel-border); border-radius: var(--radius-md); color: var(--ink); font-size: 0.84rem; font-family: "IBM Plex Mono", monospace; outline: none; transition: border-color 140ms; }
.sk-select { appearance: none; cursor: pointer; }
.sk-input:focus { border-color: #7c3aed; }
.sk-calc-results { margin-top: 12px; }
.sk-calc-divider { height: 1px; background: var(--line); margin: 8px 0; }
.sk-calc-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
.sk-calc-row--note { font-size: 0.65rem; border-top: 1px solid var(--line); margin-top: 6px; padding-top: 8px; }
.sk-calc-label { font-size: 0.7rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.sk-calc-val { font-size: 0.8rem; font-weight: 600; color: var(--ink); font-family: "IBM Plex Mono", monospace; }
.sk-calc-val.violet { color: #a78bfa; } .sk-calc-val.pos { color: var(--positive); }
.sk-calc-section-label { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 8px; display: block; }

/* Supply section */
.sk-supply-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sk-supply-table { }
.sk-supply-row { display: grid; grid-template-columns: 5rem 1fr 1fr; padding: 8px 4px; border-bottom: 1px solid var(--line); font-size: 0.74rem; font-family: "IBM Plex Mono", monospace; gap: 8px; align-items: center; }
.sk-supply-header { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
.sk-supply-row--current { background: rgba(139,92,246,0.06); border-radius: 4px; }
.sk-supply-row .violet { color: #a78bfa; font-weight: 600; }
.sk-supply-row .muted { color: var(--muted); }
.sk-supply-row .pos { color: var(--positive); }
.sk-supply-note { font-size: 0.7rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; line-height: 1.55; margin-top: 14px; }

/* Mechanism cards */
.sk-mech-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: 12px; margin-top: 16px; }
.sk-mech-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 18px; }
.sk-mech-icon { font-size: 1.3rem; margin-bottom: 8px; color: #a78bfa; }
.sk-mech-title { font-size: 0.84rem; font-weight: 700; color: var(--ink); margin-bottom: 8px; }
.sk-mech-body { font-size: 0.74rem; color: var(--ink2); line-height: 1.65; margin: 0; }
.sk-mech-body code { background: var(--surface); padding: 1px 5px; border-radius: 3px; font-size: 0.72rem; color: #a78bfa; }

/* Combined overview */
.sk-combined-grid { display: flex; align-items: center; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
.sk-combined-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 20px; flex: 1; min-width: 180px; }
.sk-combined-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 6px; }
.sk-combined-pct { font-size: 2.2rem; font-weight: 800; color: var(--mgsn); line-height: 1; }
.sk-combined-pct--violet { color: #a78bfa; }
.sk-combined-pct--gold { color: var(--gold); }
.sk-combined-desc { font-size: 0.72rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 10px; }
.sk-combined-body { font-size: 0.74rem; color: var(--ink2); line-height: 1.6; margin: 0; }
.sk-combined-divider, .sk-combined-equals { font-size: 1.6rem; font-weight: 800; color: var(--muted); padding: 0 4px; flex-shrink: 0; }
.sk-combined-result { border-color: rgba(245,158,11,0.3); }

/* Register section */
.sk-register { margin-top: 16px; }
.sk-register-inner { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-xl); padding: 28px 32px; max-width: 700px; }
.sk-register-title { font-size: 1.1rem; font-weight: 700; color: var(--ink); margin: 0 0 12px; }
.sk-register-body { font-size: 0.86rem; color: var(--ink2); line-height: 1.7; margin: 0 0 18px; }
.sk-register-btns { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.sk-register-disclaimer { font-size: 0.67rem; color: var(--muted-alt); font-family: "IBM Plex Mono", monospace; margin: 0; line-height: 1.5; }

@media (max-width: 900px) {
  .sk-page { padding-left: 14px; padding-right: 14px; }
  .sk-calc-grid, .sk-supply-grid { grid-template-columns: 1fr; }
  .sk-tier-grid { grid-template-columns: repeat(2,1fr); }
  .sk-hero { flex-direction: column; gap: 20px; }
  .sk-combined-grid { flex-direction: column; }
  .sk-combined-divider, .sk-combined-equals { display: none; }
  .sk-nav { display: none; }
}
@media (max-width: 600px) {
  .sk-calc-row,
  .sk-supply-row {
    gap: 6px;
  }
  .sk-calc-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
@media (max-width: 480px) {
  .sk-tier-grid { grid-template-columns: 1fr; }
  .sk-supply-row { grid-template-columns: 1fr; }
}
`;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  const styleEl = document.createElement("style");
  styleEl.textContent = STAKING_CSS;
  document.head.appendChild(styleEl);

  const app = document.querySelector("#app");
  const cachedState = readViewCache(STAKING_CACHE_KEY);
  let baseState = buildStakingBaseState(cachedState ?? {});
  renderStakingPage(app, baseState, cachedState ? "cached" : "loading");

  const [liveSpotResult, liveIcpswapResult, livePoolResult, liveStakingResult] = await Promise.allSettled([
    fetchLiveSpotPrices(),
    fetchICPSwapPrices(),
    fetchICPSwapPoolStats(),
    fetchStakingProgramData(),
  ]);

  baseState = buildStakingBaseState({
    mgsnNow: liveIcpswapResult.value?.mgsnUsd ?? baseState.mgsnNow,
    icpNow: liveSpotResult.value?.icpUsd ?? baseState.icpNow,
    livePoolStats: livePoolResult.value ?? baseState.livePoolStats,
    stakingState: liveStakingResult.value ?? baseState.stakingState,
  });
  writeViewCache(STAKING_CACHE_KEY, baseState);
  const hasLivePayload = Boolean(
    baseState.mgsnNow != null ||
    baseState.icpNow != null ||
    baseState.livePoolStats?.mgsnVol24h != null ||
    baseState.livePoolStats?.mgsnVol30d != null ||
    baseState.livePoolStats?.mgsnLiq != null ||
    baseState.stakingState?.status === "live" ||
    baseState.stakingState?.status === "configured" ||
    baseState.stakingState?.status === "prelaunch"
  );
  renderStakingPage(app, baseState, hasLivePayload ? "live" : cachedState ? "cached" : "fallback");
}

bootstrap();

function fallbackStakingState() {
  return {
    status: "unavailable",
    currentSupply: null,
    positions: [],
    totalLocked: 0,
    totalWeight: 0,
    note: "The live staking state could not be loaded.",
  };
}

function buildStakingBaseState(raw = {}) {
  return {
    mgsnNow: raw.mgsnNow ?? null,
    icpNow: raw.icpNow ?? null,
    livePoolStats: raw.livePoolStats ?? {},
    stakingState: raw.stakingState ?? fallbackStakingState(),
  };
}

function renderStakingPage(app, baseState, hydrationMode) {
  const scenario = loadScenarioState();
  const prices = applyScenarioToPrices(
    { mgsnUsd: baseState.mgsnNow, icpUsd: baseState.icpNow },
    scenario
  );
  const livePoolStats = applyScenarioToPoolStats(baseState.livePoolStats, scenario);
  const stakingState = baseState.stakingState ?? fallbackStakingState();
  const metrics = computeStakingMetrics(prices.mgsnUsd, stakingState);

  app.innerHTML = buildHTML(
    metrics,
    livePoolStats,
    prices.mgsnUsd,
    prices.icpUsd,
    stakingState,
    buildScenarioHeaderHTML(
      "staking",
      buildStakingSourceChips(stakingState, scenario, hydrationMode)
    )
  );

  const amountEl = document.getElementById("sk-amount");
  if (amountEl) amountEl.value = String(Math.max(1, Math.round(scenario.portfolioHoldings || 1_000_000)));

  renderCalc(metrics, livePoolStats, prices.mgsnUsd);
  renderSupplyChart(metrics.pctSupply);

  document.getElementById("sk-amount")?.addEventListener("input", () => renderCalc(metrics, livePoolStats, prices.mgsnUsd));
  document.getElementById("sk-tier")?.addEventListener("change", () => renderCalc(metrics, livePoolStats, prices.mgsnUsd));

  attachScenarioStudio(app, (action) => {
    if (action?.type === "refresh" || action?.type === "clear-cache") {
      window.location.reload();
      return;
    }
    renderStakingPage(app, baseState, hydrationMode);
  });

  const el = document.getElementById("sk-mgsn-price");
  if (el) el.textContent = fmt(prices.mgsnUsd, 7);
}
