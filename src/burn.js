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

import { BURN_PROGRAM, TOKEN_CANISTERS } from "./demoData";
import { DEFAULT_BURN_CALC_AMOUNT } from "./liveDefaults.js";
import { fetchICPSwapPrices } from "./liveData";
import { fetchBurnProgramData } from "./onChainData.js";
import { buildPlatformHeaderHTML } from "./siteChrome.js";
import {
  applyScenarioToPrices,
  attachScenarioStudio,
  buildBurnSourceChips,
  buildScenarioHeaderHTML,
  getBurnScenarioAmount,
  loadScenarioState,
  readViewCache,
  writeViewCache,
} from "./siteState.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const ICPSWAP_SWAP_URL =
  `https://app.icpswap.com/swap?input=${TOKEN_CANISTERS.ICP}&output=${TOKEN_CANISTERS.MGSN}`;
const BURN_CACHE_KEY = "burn-page-live-v1";

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
function fmtNum(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US").format(v);
}

// ── Burn math ─────────────────────────────────────────────────────────────────

function computeBurnMetrics(mgsnNow, burnState) {
  const log = burnState?.log ?? [];
  const totalBurned = typeof burnState?.totalBurned === "number" ? burnState.totalBurned : null;
  const supply = burnState?.originalSupply
    ?? burnState?.currentSupply
    ?? BURN_PROGRAM.totalSupply
    ?? null;
  const pctBurned = typeof supply === "number" && supply > 0 && typeof totalBurned === "number"
    ? (totalBurned / supply) * 100
    : null;
  const remaining = burnState?.currentSupply ?? (typeof supply === "number" && typeof totalBurned === "number" ? Math.max(supply - totalBurned, 0) : null);
  const valueDestroyed = typeof totalBurned === "number" && typeof mgsnNow === "number" && Number.isFinite(mgsnNow)
    ? totalBurned * mgsnNow
    : null;

  // Next milestone not yet reached
  const nextMilestone = typeof pctBurned === "number"
    ? BURN_PROGRAM.milestones.find((m) => pctBurned < m.pct) ?? null
    : null;
  const nextTarget = nextMilestone && typeof supply === "number"
    ? Math.ceil(supply * nextMilestone.pct / 100)
    : null;
  const toNextTarget = nextTarget && typeof totalBurned === "number" ? Math.max(nextTarget - totalBurned, 0) : null;

  // Leaderboard: sort descending by mgsnBurned, group by address
  const addrMap = {};
  for (const e of log) {
    if (!addrMap[e.address]) addrMap[e.address] = { address: e.address, totalBurned: 0, txCount: 0, lastDate: "" };
    addrMap[e.address].totalBurned += e.mgsnBurned ?? 0;
    addrMap[e.address].txCount     += 1;
    if (!addrMap[e.address].lastDate || e.date > addrMap[e.address].lastDate) addrMap[e.address].lastDate = e.date;
  }
  const leaderboard = Object.values(addrMap).sort((a, b) => b.totalBurned - a.totalBurned);

  return {
    burnAddress: burnState?.burnAddress ?? BURN_PROGRAM.burnAddress,
    burnAddressBalance: burnState?.burnAddressBalance ?? 0,
    burnLog: log,
    totalBurned,
    supply,
    pctBurned,
    remaining,
    valueDestroyed,
    nextMilestone,
    toNextTarget,
    leaderboard,
    note: burnState?.note ?? "",
    status: burnState?.status ?? "unavailable",
  };
}

function priceImpactEstimate(burnAmount, supply, mgsnNow) {
  if (
    typeof burnAmount !== "number" ||
    !Number.isFinite(burnAmount) ||
    typeof supply !== "number" ||
    !Number.isFinite(supply) ||
    supply <= 0 ||
    typeof mgsnNow !== "number" ||
    !Number.isFinite(mgsnNow)
  ) {
    return null;
  }
  // Simplified deflationary model: price impact ≈ (burn% × elasticity)
  // Conservative elasticity of 0.5 (50¢ price rise per 1% supply removed)
  const pct       = (burnAmount / supply) * 100;
  const pctImpact = pct * 0.5;
  const newPrice  = mgsnNow * (1 + pctImpact / 100);
  return { pct, pctImpact, newPrice, burnAmount };
}

// ── Chart ─────────────────────────────────────────────────────────────────────

let milestoneChart = null;

function renderMilestoneChart(metrics) {
  const el = document.getElementById("chart-milestones");
  if (!el) return;
  el.width  = Math.max((el.parentElement?.clientWidth ?? 400) - 32, 240);
  el.height = 220;

  if (milestoneChart) milestoneChart.destroy();

  const labels   = BURN_PROGRAM.milestones.map((m) => m.badge);
  const targets  = BURN_PROGRAM.milestones.map((m) => m.pct);
  const achieved = BURN_PROGRAM.milestones.map((m) => Math.min(metrics.pctBurned, m.pct));

  milestoneChart = new Chart(el, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Target %",
          data: targets,
          backgroundColor: "rgba(239,68,68,0.15)",
          borderColor: "rgba(239,68,68,0.4)",
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: "Burned %",
          data: achieved,
          backgroundColor: achieved.map((v, i) => v >= targets[i] ? "rgba(239,68,68,0.8)" : "rgba(239,68,68,0.55)"),
          borderRadius: 4,
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
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(3)}%` },
        },
      },
      scales: {
        x: { grid: { color: "#1a1f3a" }, ticks: { color: "#5a6a8a", font: { family: "'IBM Plex Mono', monospace", size: 11 } }, border: { color: "#1a1f3a" } },
        y: {
          grid: { color: "#1a1f3a" },
          ticks: { color: "#5a6a8a", font: { family: "'IBM Plex Mono', monospace", size: 10 }, callback: (v) => `${v}%` },
          border: { color: "#1a1f3a" },
        },
      },
    },
  });
}

// ── Impact calculator renderer ────────────────────────────────────────────────

function renderImpactCalc(metrics, mgsnNow) {
  const amountEl = document.getElementById("br-amount");
  if (!amountEl) return;
  const amount = parseFloat(amountEl.value) || DEFAULT_BURN_CALC_AMOUNT;
  const impact = priceImpactEstimate(amount, metrics.supply, mgsnNow);
  const resEl  = document.getElementById("br-calc-results");
  if (!resEl) return;
  if (!impact) {
    resEl.innerHTML = `
      <div class="br-calc-divider"></div>
      <div class="br-calc-row br-calc-row--note"><span>Live supply and price data are required before the burn impact calculator can estimate scarcity impact.</span></div>`;
    return;
  }
  resEl.innerHTML = `
    <div class="br-calc-divider"></div>
    <div class="br-calc-row"><span class="br-calc-label">Tokens removed</span><span class="br-calc-val">${fmtNum(impact.burnAmount)} MGSN</span></div>
    <div class="br-calc-row"><span class="br-calc-label">% of total supply</span><span class="br-calc-val fire">${impact.pct.toFixed(4)}%</span></div>
    <div class="br-calc-row"><span class="br-calc-label">Est. price impact</span><span class="br-calc-val pos">+${impact.pctImpact.toFixed(3)}%</span></div>
    <div class="br-calc-row"><span class="br-calc-label">New est. price</span><span class="br-calc-val pos">${fmt(impact.newPrice, 7)}</span></div>
    <div class="br-calc-row"><span class="br-calc-label">USD value destroyed</span><span class="br-calc-val fire">${fmt(impact.burnAmount * mgsnNow)}</span></div>
    <div class="br-calc-row br-calc-row--note"><span>Model uses conservative 0.5× supply elasticity. Actual impact may be higher.</span></div>`;
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildHTML(metrics, mgsnNow, scenarioHeaderHtml, scenarioAmount) {
  const burnAddressReady = !!metrics.burnAddress;
  const burnAddressText = burnAddressReady ? metrics.burnAddress : "Unavailable";
  const totalBurnedDisplay = typeof metrics.totalBurned === "number" && metrics.totalBurned > 0 ? compact(metrics.totalBurned) : metrics.totalBurned === 0 ? "0" : "Unavailable";
  const pctDisplay = typeof metrics.pctBurned === "number" ? metrics.pctBurned.toFixed(4) + "%" : "Unavailable";
  const valueDisplay = typeof metrics.valueDestroyed === "number" && metrics.valueDestroyed > 0 ? fmt(metrics.valueDestroyed) : metrics.valueDestroyed === 0 ? "$0.00" : "Unavailable";
  const txCount            = metrics.burnLog.length;

  // Milestone progress bars
  const milestoneBars = BURN_PROGRAM.milestones.map((m) => {
    const fill = typeof metrics.pctBurned === "number" ? Math.min((metrics.pctBurned / m.pct) * 100, 100) : 0;
    const reached = typeof metrics.pctBurned === "number" && metrics.pctBurned >= m.pct;
    return `
      <div class="br-milestone-row">
        <div class="br-milestone-header">
          <span class="br-milestone-badge${reached ? " br-milestone-badge--reached" : ""}">${m.badge}</span>
          <span class="br-milestone-label">${m.label} of supply</span>
          <span class="br-milestone-target">${typeof metrics.supply === "number" ? `${fmtNum(Math.ceil(metrics.supply * m.pct / 100))} MGSN` : "Unavailable"}</span>
        </div>
        <div class="br-progress-track">
          <div class="br-progress-fill${reached ? " br-progress-fill--reached" : ""}" style="width:${fill.toFixed(2)}%"></div>
        </div>
        <div class="br-milestone-reward">
          <span class="br-milestone-reward-icon">${reached ? "✓" : "○"}</span>
          <span>${m.reward}</span>
        </div>
      </div>`;
  }).join("");

  // Leaderboard table
  const leaderboardRows = metrics.leaderboard.length > 0
    ? metrics.leaderboard.map((row, i) => {
        const shortAddr = `${row.address.slice(0, 8)}…${row.address.slice(-6)}`;
        const rank      = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
        return `<tr>
          <td class="br-rank">${rank}</td>
          <td class="br-addr mono">${shortAddr}</td>
          <td class="fire">${fmtNum(row.totalBurned)} MGSN</td>
          <td class="br-pct">${typeof metrics.supply === "number" ? `${((row.totalBurned / metrics.supply) * 100).toFixed(4)}%` : "—"}</td>
          <td class="muted">${row.txCount}</td>
          <td class="muted">${row.lastDate}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="6" class="br-empty-row">No burns recorded yet. Be the first to burn MGSN and appear on the leaderboard.</td></tr>`;

  // Hall of Flame (top 3)
  const hallOfFlame = metrics.leaderboard.slice(0, 3).map((row, i) => {
    const flames = ["🔥", "🔥🔥", "🔥🔥🔥"][2 - i] ?? "🔥";
    const shortAddr = `${row.address.slice(0, 10)}…`;
    return `
      <div class="br-hall-card${i === 0 ? " br-hall-card--first" : ""}">
        <div class="br-hall-flames">${flames}</div>
        <div class="br-hall-rank">#${i + 1}</div>
        <div class="br-hall-addr mono">${shortAddr}</div>
        <div class="br-hall-amount">${compact(row.totalBurned)} MGSN</div>
        <div class="br-hall-pct fire">${typeof metrics.supply === "number" ? `${((row.totalBurned / metrics.supply) * 100).toFixed(3)}% of supply` : "Supply unavailable"}</div>
      </div>`;
  }).join("") || `<div class="br-hall-empty">The Hall of Flame awaits its first hero. Burn MGSN to take the top spot.</div>`;

  return `
    ${buildPlatformHeaderHTML({
      activePage: "burn",
      badgeText: "Supply destruction",
      priceLabel: "MGSN/USD",
      priceValue: mgsnNow ? fmt(mgsnNow, 7) : "—",
      priceId: "br-mgsn-price",
      priceClass: mgsnNow ? "live" : "",
    })}

    <div class="br-page">
      ${scenarioHeaderHtml}

      <!-- Hero -->
      <section class="br-hero">
        <div class="br-hero-left">
          <div class="br-hero-eyebrow">MGSN Community Burn · Voluntary supply destruction</div>
          <h1 class="br-hero-title">Burn $MGSN.<br>Destroy supply.<br>Increase scarcity.</h1>
          <p class="br-hero-body">
            The MGSN Community Burn Program lets any holder voluntarily and permanently destroy their MGSN tokens by sending them to the ICP blackhole. Every token burned reduces total supply forever — increasing the relative scarcity of every remaining token. Public burns are recorded on-chain and displayed on the leaderboard below.
          </p>
          <div class="br-hero-stats">
            <div class="br-stat">
              <span class="br-stat-label">Total MGSN burned</span>
              <span class="br-stat-val fire">${totalBurnedDisplay}</span>
            </div>
            <div class="br-stat">
              <span class="br-stat-label">% of supply destroyed</span>
              <span class="br-stat-val fire">${pctDisplay}</span>
            </div>
            <div class="br-stat">
              <span class="br-stat-label">USD value destroyed</span>
              <span class="br-stat-val pos">${valueDisplay}</span>
            </div>
            <div class="br-stat">
              <span class="br-stat-label">Burn transactions</span>
              <span class="br-stat-val">${txCount}</span>
            </div>
            <div class="br-stat">
              <span class="br-stat-label">Remaining supply</span>
              <span class="br-stat-val">${metrics.remaining != null ? `${compact(metrics.remaining)} MGSN` : "Unavailable"}</span>
            </div>
            <div class="br-stat">
              <span class="br-stat-label">Blackhole balance</span>
              <span class="br-stat-val fire">${metrics.burnAddressBalance != null ? `${compact(metrics.burnAddressBalance)} MGSN` : "Unavailable"}</span>
            </div>
          </div>
          <div class="br-coming-soon-banner">
            <span class="br-coming-soon-icon">◎</span>
            <span>${metrics.note || "Burn history is being read directly from the MGSN ledger."}</span>
          </div>
        </div>
        <div class="br-hero-right">
          <div class="br-cta-card">
            <p class="br-cta-label">Ready to burn?</p>
            <p class="br-cta-body">Burning MGSN is permanent and irreversible. Every token burned reduces total supply forever, benefiting all remaining holders through increased scarcity.</p>
            <a class="br-cta-btn br-cta-primary" href="${ICPSWAP_SWAP_URL}" target="_blank" rel="noopener noreferrer">Buy MGSN to burn →</a>
            <div class="br-burn-address">
              <span class="br-burn-addr-label">Burn address (blackhole)</span>
              <code class="br-burn-addr-val" id="br-burn-addr">${burnAddressText}</code>
              ${burnAddressReady ? `<button class="br-copy-btn" id="br-copy-addr">Copy</button>` : `<span class="br-copy-btn" style="cursor:default;opacity:0.7">Awaiting verification</span>`}
            </div>
            <p class="br-cta-disclaimer">Burning is irreversible. Tokens sent to the blackhole cannot be recovered. Not financial advice.</p>
          </div>
        </div>
      </section>

      <!-- How to burn -->
      <section class="br-section">
        <h2 class="br-section-title">How to burn MGSN</h2>
        <div class="br-how-grid">
          <div class="br-how-card">
            <div class="br-how-num">01</div>
            <div class="br-how-head">Acquire MGSN</div>
            <p class="br-how-body">Purchase MGSN on ICPSwap using the MGSN/ICP pair. You can also burn tokens you already hold in any ICP-compatible wallet such as Plug, NFID, or the NNS dapp.</p>
          </div>
          <div class="br-how-card">
            <div class="br-how-num">02</div>
            <div class="br-how-head">Send to the blackhole</div>
            <p class="br-how-body">${burnAddressReady
              ? `Transfer MGSN to the ICP blackhole canister address: <code class="br-inline-code">${metrics.burnAddress}</code>. This canister has no controller, no upgrade path, and no way to send tokens back. The burn is permanent and on-chain verifiable.`
              : `The burn address is temporarily unavailable.`}</p>
          </div>
          <div class="br-how-card">
            <div class="br-how-num">03</div>
            <div class="br-how-head">Auto-index from the ledger</div>
            <p class="br-how-body">Burns on this page are indexed directly from the MGSN ledger. Transfers to the blackhole and native ledger burn operations are both included in the leaderboard once the archive scan refreshes.</p>
          </div>
        </div>
      </section>

      <!-- Impact calculator -->
      <section class="br-section">
        <h2 class="br-section-title">Burn impact calculator</h2>
        <p class="br-section-sub">See how burning a specific amount of MGSN affects total supply and modeled price trajectory. This is a scenario model, not an execution guarantee.</p>
        <div class="br-calc-grid">
          <div class="br-calc-card">
            <label class="br-input-label">MGSN to burn</label>
            <input id="br-amount" type="number" class="br-input" value="${Math.max(1, Math.round(scenarioAmount))}" min="1" step="10000" />
            <div id="br-calc-results" class="br-calc-results"></div>
          </div>
          <div class="br-calc-card">
            <span class="br-calc-section-label">Why burning increases price</span>
            <p class="br-calc-explain">
              When tokens are permanently removed from circulation, the total supply decreases. With constant or growing demand, a smaller supply means each remaining token represents a larger share of the network — directly increasing its proportional value. Even small burns create measurable scarcity pressure, especially when the token has low float.
            </p>
            <div class="br-calc-supply-row">
              <div class="br-calc-supply-stat">
                <span class="br-calc-supply-label">Total supply</span>
                <span class="br-calc-supply-val">${fmtNum(metrics.supply)}</span>
              </div>
              <div class="br-calc-supply-stat">
                <span class="br-calc-supply-label">Burned to date</span>
                <span class="br-calc-supply-val fire">${fmtNum(metrics.totalBurned)}</span>
              </div>
              <div class="br-calc-supply-stat">
                <span class="br-calc-supply-label">Remaining</span>
                <span class="br-calc-supply-val pos">${fmtNum(metrics.remaining)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Milestone tracker -->
      <section class="br-section">
        <h2 class="br-section-title">Burn milestones</h2>
        <p class="br-section-sub">Community milestones unlock recognition rewards for top burners. Each milestone is based on the original on-chain supply before recorded burns.</p>
        <div class="br-milestones-layout">
          <div class="br-milestone-list">
            ${milestoneBars}
          </div>
          <div class="br-calc-card">
            <span class="br-calc-section-label">Milestone progress overview</span>
            <div style="height:220px;overflow:hidden"><canvas id="chart-milestones"></canvas></div>
          </div>
        </div>
      </section>

      <!-- Burn leaderboard -->
      <section class="br-section">
        <h2 class="br-section-title">Public burn leaderboard</h2>
        <p class="br-section-sub">All detected burns are listed publicly. Rankings are rebuilt directly from the MGSN ledger archive, so manual log updates are no longer required.</p>
        <div class="br-table-wrap">
          <table class="br-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Address</th>
                <th>Total burned</th>
                <th>% of supply</th>
                <th>TXs</th>
                <th>Last burn</th>
              </tr>
            </thead>
            <tbody>
              ${leaderboardRows}
            </tbody>
          </table>
        </div>
      </section>

      <!-- Hall of Flame -->
      <section class="br-section">
        <h2 class="br-section-title">Hall of Flame</h2>
        <p class="br-section-sub">The top 3 burners of all time. These addresses have permanently destroyed the most MGSN and contributed the most to token scarcity.</p>
        <div class="br-hall-grid">
          ${hallOfFlame}
        </div>
      </section>

      <!-- Combined protocol overview -->
      <section class="br-section">
        <h2 class="br-section-title">Four mechanisms. One goal.</h2>
        <p class="br-section-sub">The MGSN value stack combines four complementary programs, each targeting a different supply/demand lever.</p>
        <div class="br-combined-grid">
          <div class="br-combined-card br-combined-strategy">
            <div class="br-combined-label">Strategy Engine</div>
            <div class="br-combined-icon">◈</div>
            <p class="br-combined-body">6-signal composite score identifies optimal entry/exit windows, maximizing buy-side timing efficiency.</p>
            <a class="br-cta-btn br-cta-secondary" style="margin-top:10px;font-size:0.75rem" href="/strategy.html">View →</a>
          </div>
          <div class="br-combined-card br-combined-buyback">
            <div class="br-combined-label">Buyback Program</div>
            <div class="br-combined-icon" style="color:var(--mgsn)">↺</div>
            <p class="br-combined-body">50% of LP fee income funds monthly market buys — reducing float and creating a predictable demand floor.</p>
            <a class="br-cta-btn br-cta-secondary" style="margin-top:10px;font-size:0.75rem" href="/buyback.html">View →</a>
          </div>
          <div class="br-combined-card br-combined-staking">
            <div class="br-combined-label">Staking Program</div>
            <div class="br-combined-icon" style="color:#a78bfa">⊕</div>
            <p class="br-combined-body">50% of LP fees distributed to stakers. Voluntarily locks circulating supply while rewarding long-term conviction.</p>
            <a class="br-cta-btn br-cta-secondary" style="margin-top:10px;font-size:0.75rem" href="/staking.html">View →</a>
          </div>
          <div class="br-combined-card br-combined-burn">
            <div class="br-combined-label">Community Burn</div>
            <div class="br-combined-icon" style="color:#ef4444">🔥</div>
            <p class="br-combined-body">Voluntary permanent supply destruction by any holder. Every burned token is gone forever, increasing the scarcity of all remaining supply.</p>
            <span class="br-cta-btn br-cta-secondary" style="margin-top:10px;font-size:0.75rem;display:block;text-align:center;opacity:0.6;cursor:default">Active on this page</span>
          </div>
        </div>
      </section>

      <!-- CTA -->
      <section class="br-section br-cta-section">
        <div class="br-cta-inner">
          <h2 class="br-cta-title">Start burning. Join the leaderboard.</h2>
          <p class="br-cta-body-text">
            Burning MGSN is the most direct way to increase the value of every remaining token. Historical burn events are already being indexed directly from the MGSN ledger, so every additional burn updates a live on-chain scarcity record.
          </p>
          <div class="br-cta-burn-address">
            <span class="br-burn-addr-label">Official burn address (ICP blackhole)</span>
            <code class="br-burn-addr-val" id="br-burn-addr-2">${burnAddressText}</code>
            ${burnAddressReady ? `<button class="br-copy-btn" id="br-copy-addr-2">Copy</button>` : `<span class="br-copy-btn" style="cursor:default;opacity:0.7">Awaiting verification</span>`}
          </div>
          <div class="br-cta-btns">
            <a class="br-cta-btn br-cta-fire" href="${ICPSWAP_SWAP_URL}" target="_blank" rel="noopener noreferrer">Buy MGSN on ICPSwap →</a>
            <a class="br-cta-btn br-cta-secondary" href="/staking.html">Staking Program</a>
            <a class="br-cta-btn br-cta-secondary" href="/buyback.html">Buyback Program</a>
          </div>
          <p class="br-cta-footer-note">Burns are permanent and irreversible. Always verify the burn address before sending. Not financial advice.</p>
        </div>
      </section>

      <div class="page-footer" style="padding:24px 0 60px">
        <p>Burn history is read directly from the MGSN ledger. The canonical blackhole address is ${burnAddressText}.</p>
        <p style="margin-top:4px">Powered by <a href="https://icpswap.com" target="_blank" rel="noopener noreferrer">ICPSwap</a> · Deployed on Internet Computer</p>
      </div>
    </div>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const BURN_CSS = `
.br-page { padding-top: var(--header-h); max-width: 1200px; margin: 0 auto; padding-left: 24px; padding-right: 24px; padding-bottom: 60px; }

/* Nav — burn page uses sk-nav/sk-nav-link class names; define them here */
.sk-nav { display: flex; align-items: center; gap: 2px; margin-left: 24px; }
.sk-nav-link { padding: 6px 14px; border-radius: var(--radius-md); font-size: 0.78rem; font-weight: 500; color: var(--muted); text-decoration: none; transition: background 120ms, color 120ms; font-family: "IBM Plex Mono", monospace; letter-spacing: 0.03em; }
.sk-nav-link:hover { color: var(--ink); background: rgba(255,255,255,0.05); }
/* Active state override for burn */
.br-nav-active { color: #ef4444 !important; background: rgba(239,68,68,0.1) !important; }

/* Hero */
.br-hero { display: flex; align-items: flex-start; gap: 32px; padding: 32px 0 28px; border-bottom: 1px solid var(--panel-border); flex-wrap: wrap; }
.br-hero-left { flex: 1; min-width: 300px; }
.br-hero-right { flex-shrink: 0; }
.br-hero-eyebrow { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 10px; }
.br-hero-title { font-size: 2.0rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 14px; color: var(--ink); }
.br-hero-body { font-size: 0.88rem; color: var(--ink2); max-width: 560px; line-height: 1.7; margin: 0 0 20px; }
.br-hero-stats { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 16px; }
.br-stat { display: flex; flex-direction: column; gap: 3px; }
.br-stat-label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.br-stat-val { font-size: 1.1rem; font-weight: 700; color: var(--ink); font-family: "IBM Plex Mono", monospace; }
.br-stat-val.fire { color: #ef4444; }
.br-stat-val.pos { color: var(--positive); }
.br-stat-val.gold { color: var(--gold); }

/* Coming soon banner */
.br-coming-soon-banner { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: rgba(239,68,68,0.07); border: 1px solid rgba(239,68,68,0.22); border-radius: var(--radius-md); font-size: 0.76rem; color: var(--ink2); font-family: "IBM Plex Mono", monospace; }
.br-coming-soon-icon { color: #ef4444; font-size: 1rem; flex-shrink: 0; }

/* CTA card */
.br-cta-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-xl); padding: 22px; min-width: 240px; max-width: 300px; display: flex; flex-direction: column; gap: 10px; }
.br-cta-label { font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin: 0; }
.br-cta-body { font-size: 0.76rem; color: var(--ink2); line-height: 1.6; margin: 0; }
.br-cta-btn { display: block; padding: 10px 18px; border-radius: var(--radius-md); font-size: 0.84rem; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; border: none; transition: opacity 140ms; }
.br-cta-btn:hover { opacity: 0.85; }
.br-cta-primary  { background: var(--surface); border: 1px solid var(--panel-border); color: var(--ink2); }
.br-cta-fire     { background: linear-gradient(135deg,#dc2626,#ef4444); color: #fff; }
.br-cta-secondary { background: var(--surface); border: 1px solid var(--panel-border); color: var(--ink2); }
.br-cta-disclaimer { font-size: 0.62rem; color: var(--muted-alt); font-family: "IBM Plex Mono", monospace; margin: 0; text-align: center; line-height: 1.5; }

/* Burn address display */
.br-burn-address { display: flex; flex-direction: column; gap: 4px; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.18); border-radius: var(--radius-md); padding: 10px 12px; }
.br-burn-addr-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.br-burn-addr-val { font-size: 0.84rem; font-family: "IBM Plex Mono", monospace; color: #ef4444; font-weight: 600; word-break: break-all; }
.br-copy-btn { align-self: flex-start; padding: 4px 12px; font-size: 0.68rem; font-family: "IBM Plex Mono", monospace; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; border-radius: var(--radius-md); cursor: pointer; transition: background 140ms; }
.br-copy-btn:hover { background: rgba(239,68,68,0.22); }

/* Section */
.br-section { padding: 28px 0 0; }
.br-section-title { font-size: 0.82rem; font-weight: 700; color: var(--ink); letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 4px; font-family: "IBM Plex Mono", monospace; }
.br-section-sub { font-size: 0.74rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin: 0 0 14px; max-width: 720px; }

/* How-it-works */
.br-how-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap: 12px; margin-top: 16px; }
.br-how-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 18px; }
.br-how-num { font-size: 0.62rem; font-weight: 700; color: #ef4444; font-family: "IBM Plex Mono", monospace; letter-spacing: 0.1em; margin-bottom: 8px; }
.br-how-head { font-size: 0.84rem; font-weight: 700; color: var(--ink); margin-bottom: 8px; }
.br-how-body { font-size: 0.74rem; color: var(--ink2); line-height: 1.65; margin: 0; }
.br-inline-code { background: var(--surface); padding: 1px 5px; border-radius: 3px; font-size: 0.72rem; color: #ef4444; font-family: "IBM Plex Mono", monospace; }

/* Calculator */
.br-calc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.br-calc-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 16px 18px; }
.br-input-label { display: block; font-size: 0.67rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 5px; }
.br-input { width: 100%; padding: 8px 11px; background: var(--surface); border: 1px solid var(--panel-border); border-radius: var(--radius-md); color: var(--ink); font-size: 0.84rem; font-family: "IBM Plex Mono", monospace; outline: none; transition: border-color 140ms; box-sizing: border-box; }
.br-input:focus { border-color: #ef4444; }
.br-calc-results { margin-top: 12px; }
.br-calc-divider { height: 1px; background: var(--line); margin: 8px 0; }
.br-calc-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
.br-calc-row--note { font-size: 0.64rem; border-top: 1px solid var(--line); margin-top: 6px; padding-top: 8px; color: var(--muted); font-family: "IBM Plex Mono", monospace; justify-content: flex-start; }
.br-calc-label { font-size: 0.7rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.br-calc-val { font-size: 0.8rem; font-weight: 600; color: var(--ink); font-family: "IBM Plex Mono", monospace; }
.br-calc-val.fire { color: #ef4444; }
.br-calc-val.pos { color: var(--positive); }
.br-calc-section-label { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 8px; display: block; }
.br-calc-explain { font-size: 0.75rem; color: var(--ink2); line-height: 1.65; margin: 0 0 14px; }
.br-calc-supply-row { display: flex; gap: 16px; flex-wrap: wrap; }
.br-calc-supply-stat { display: flex; flex-direction: column; gap: 3px; }
.br-calc-supply-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.br-calc-supply-val { font-size: 0.88rem; font-weight: 700; color: var(--ink); font-family: "IBM Plex Mono", monospace; }
.br-calc-supply-val.fire { color: #ef4444; }
.br-calc-supply-val.pos { color: var(--positive); }

/* Milestones */
.br-milestones-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.br-milestone-list { display: flex; flex-direction: column; gap: 14px; }
.br-milestone-row { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 14px 16px; }
.br-milestone-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.br-milestone-badge { font-size: 0.7rem; font-weight: 700; font-family: "IBM Plex Mono", monospace; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); color: #ef4444; padding: 2px 8px; border-radius: 999px; }
.br-milestone-badge--reached { background: rgba(239,68,68,0.2); border-color: #ef4444; }
.br-milestone-label { font-size: 0.78rem; font-weight: 600; color: var(--ink); flex: 1; }
.br-milestone-target { font-size: 0.68rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.br-progress-track { height: 7px; background: var(--surface); border-radius: 999px; overflow: hidden; margin-bottom: 8px; }
.br-progress-fill { height: 100%; background: linear-gradient(90deg,#ef4444,#f97316); border-radius: 999px; transition: width 0.4s ease; }
.br-progress-fill--reached { background: linear-gradient(90deg,#dc2626,#ef4444); }
.br-milestone-reward { display: flex; align-items: center; gap: 6px; font-size: 0.7rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.br-milestone-reward-icon { color: #ef4444; font-size: 0.8rem; }

/* Leaderboard table */
.br-table-wrap { overflow-x: auto; margin-top: 8px; }
.br-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; font-family: "IBM Plex Mono", monospace; }
.br-table th { padding: 8px 12px; text-align: left; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); border-bottom: 1px solid var(--line); }
.br-table td { padding: 9px 12px; border-bottom: 1px solid var(--line); color: var(--ink2); }
.br-table .fire { color: #ef4444; font-weight: 600; }
.br-table .muted { color: var(--muted); }
.br-rank { font-size: 1rem; }
.br-addr { color: var(--ink2); }
.br-pct { color: var(--muted); }
.br-empty-row { text-align: center; padding: 28px 12px !important; color: var(--muted); font-size: 0.76rem; }

/* Hall of Flame */
.br-hall-grid { display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
.br-hall-card { background: var(--panel-bg); border: 1px solid rgba(239,68,68,0.2); border-radius: var(--radius-lg); padding: 20px; flex: 1; min-width: 180px; text-align: center; }
.br-hall-card--first { border-color: #ef4444; background: rgba(239,68,68,0.04); }
.br-hall-flames { font-size: 1.4rem; margin-bottom: 6px; }
.br-hall-rank { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 6px; }
.br-hall-addr { font-size: 0.8rem; color: var(--ink2); font-family: "IBM Plex Mono", monospace; word-break: break-all; margin-bottom: 8px; }
.br-hall-amount { font-size: 1.1rem; font-weight: 700; color: #ef4444; font-family: "IBM Plex Mono", monospace; margin-bottom: 2px; }
.br-hall-pct { font-size: 0.72rem; font-family: "IBM Plex Mono", monospace; }
.br-hall-pct.fire { color: #ef4444; }
.br-hall-empty { width: 100%; text-align: center; padding: 32px; color: var(--muted); font-size: 0.8rem; font-family: "IBM Plex Mono", monospace; background: var(--panel-bg); border: 1px dashed rgba(239,68,68,0.2); border-radius: var(--radius-lg); }

/* Combined overview */
.br-combined-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap: 12px; margin-top: 16px; }
.br-combined-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 20px; }
.br-combined-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 8px; }
.br-combined-icon { font-size: 1.6rem; margin-bottom: 8px; color: var(--muted); }
.br-combined-body { font-size: 0.74rem; color: var(--ink2); line-height: 1.6; margin: 0; }
.br-combined-burn { border-color: rgba(239,68,68,0.25); }

/* CTA section */
.br-cta-section { margin-top: 16px; }
.br-cta-inner { background: var(--panel-bg); border: 1px solid rgba(239,68,68,0.25); border-radius: var(--radius-xl); padding: 28px 32px; max-width: 700px; }
.br-cta-title { font-size: 1.1rem; font-weight: 700; color: var(--ink); margin: 0 0 12px; }
.br-cta-body-text { font-size: 0.86rem; color: var(--ink2); line-height: 1.7; margin: 0 0 18px; }
.br-cta-burn-address { display: flex; flex-direction: column; gap: 4px; background: rgba(239,68,68,0.05); border: 1px solid rgba(239,68,68,0.18); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 16px; }
.br-cta-btns { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.br-cta-footer-note { font-size: 0.67rem; color: var(--muted-alt); font-family: "IBM Plex Mono", monospace; margin: 0; line-height: 1.5; }

/* Mono utility */
.mono { font-family: "IBM Plex Mono", monospace; }

@media (max-width: 900px) {
  .br-page { padding-left: 14px; padding-right: 14px; }
  .br-calc-grid, .br-milestones-layout { grid-template-columns: 1fr; }
  .br-hero { flex-direction: column; gap: 20px; }
  .br-cta-card { max-width: 100%; }
  .sk-nav { display: none; }
}
@media (max-width: 600px) {
  .br-calc-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
}
`;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  const styleEl = document.createElement("style");
  styleEl.textContent = BURN_CSS;
  document.head.appendChild(styleEl);

  const app = document.querySelector("#app");
  const cachedState = readViewCache(BURN_CACHE_KEY);
  let baseState = buildBurnBaseState(cachedState ?? {});
  renderBurnPage(app, baseState, cachedState ? "cached" : "loading");

  const [liveIcpswapResult, liveBurnResult] = await Promise.allSettled([
    fetchICPSwapPrices(),
    fetchBurnProgramData(),
  ]);

  baseState = buildBurnBaseState({
    mgsnNow: liveIcpswapResult.value?.mgsnUsd ?? baseState.mgsnNow,
    burnState: liveBurnResult.value ?? baseState.burnState,
  });
  writeViewCache(BURN_CACHE_KEY, baseState);
  const hasLivePayload = Boolean(
    baseState.mgsnNow != null ||
    baseState.burnState?.status === "live" ||
    baseState.burnState?.totalBurned != null ||
    baseState.burnState?.currentSupply != null
  );
  renderBurnPage(app, baseState, hasLivePayload ? "live" : cachedState ? "cached" : "fallback");
}

bootstrap();

function fallbackBurnState() {
  return {
    status: "unavailable",
    burnAddress: BURN_PROGRAM.burnAddress,
    burnAddressBalance: null,
    currentSupply: null,
    originalSupply: null,
    totalBurned: null,
    log: [],
    note: "MGSN burn history is temporarily unavailable.",
  };
}

function buildBurnBaseState(raw = {}) {
  return {
    mgsnNow: raw.mgsnNow ?? null,
    burnState: raw.burnState ?? fallbackBurnState(),
  };
}

function renderBurnPage(app, baseState, hydrationMode) {
  const scenario = loadScenarioState();
  const prices = applyScenarioToPrices({ mgsnUsd: baseState.mgsnNow }, scenario);
  const metrics = computeBurnMetrics(prices.mgsnUsd, baseState.burnState ?? fallbackBurnState());
  const scenarioAmount = getBurnScenarioAmount(scenario);

  app.innerHTML = buildHTML(
    metrics,
    prices.mgsnUsd,
    buildScenarioHeaderHTML(
      "burn",
      buildBurnSourceChips(metrics, scenario, hydrationMode)
    ),
    scenarioAmount
  );

  renderImpactCalc(metrics, prices.mgsnUsd);
  document.getElementById("br-amount")?.addEventListener("input", () => renderImpactCalc(metrics, prices.mgsnUsd));

  renderMilestoneChart(metrics);

  function setupCopyBtn(btnId, valId) {
    const btn = document.getElementById(btnId);
    const val = document.getElementById(valId);
    if (!btn || !val) return;
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(val.textContent.trim()).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy"; }, 1800);
      }).catch(() => {});
    });
  }
  setupCopyBtn("br-copy-addr", "br-burn-addr");
  setupCopyBtn("br-copy-addr-2", "br-burn-addr-2");

  attachScenarioStudio(app, (action) => {
    if (action?.type === "refresh" || action?.type === "clear-cache") {
      window.location.reload();
      return;
    }
    renderBurnPage(app, baseState, hydrationMode);
  });

  const priceEl = document.getElementById("br-mgsn-price");
  if (priceEl) {
    priceEl.textContent = typeof prices.mgsnUsd === "number" && Number.isFinite(prices.mgsnUsd)
      ? new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD",
      minimumFractionDigits: 7, maximumFractionDigits: 7,
    }).format(prices.mgsnUsd)
      : "—";
  }
}
