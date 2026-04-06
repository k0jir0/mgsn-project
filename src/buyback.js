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

import { demoDashboard, BUYBACK_PROGRAM, TOKEN_CANISTERS } from "./demoData";
import { fetchLiveSpotPrices, fetchICPSwapPrices, fetchICPSwapPoolStats } from "./liveData";
import { fetchBuybackProgramData } from "./onChainData.js";
import {
  applyScenarioToPoolStats,
  applyScenarioToPrices,
  attachScenarioStudio,
  buildBuybackSourceChips,
  buildScenarioHeaderHTML,
  buildSimulatedBuybackState,
  loadScenarioState,
  readViewCache,
  writeViewCache,
} from "./siteState.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const ICPSWAP_SWAP_URL =
  `https://app.icpswap.com/swap?input=${TOKEN_CANISTERS.ICP}&output=${TOKEN_CANISTERS.MGSN}`;
const ICPSWAP_LP_URL =
  `https://app.icpswap.com/liquidity/add/${TOKEN_CANISTERS.ICP}/${TOKEN_CANISTERS.MGSN}`;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(v, d = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: d, maximumFractionDigits: d,
  }).format(v);
}
function compact(v) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
}
function compactMoney(v) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    notation: "compact", maximumFractionDigits: 2,
  }).format(v);
}
function fmtMaybeMoney(v, d = 2) {
  return typeof v === "number" && Number.isFinite(v) ? fmt(v, d) : "Unavailable";
}
function pct(from, to) { return from === 0 ? 0 : ((to - from) / from) * 100; }
function pctFmt(v, d = 1) { return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`; }

// ── Buyback math ──────────────────────────────────────────────────────────────

function projectBuybackSchedule(livePoolStats, depositUsd, months = 12) {
  const monthlyVol = livePoolStats?.mgsnVol30d
    ?? (livePoolStats?.mgsnVol24h ? livePoolStats.mgsnVol24h * 30 : BUYBACK_PROGRAM.monthlyVolEst);

  const poolTvl    = livePoolStats?.mgsnLiq ?? BUYBACK_PROGRAM.poolTvlUsd;
  const userShare  = depositUsd / (poolTvl + depositUsd);
  const monthlyFee = monthlyVol * BUYBACK_PROGRAM.poolFee * userShare;
  const pledgeAmt  = monthlyFee * (BUYBACK_PROGRAM.pledgePct / 100);

  const rows = [];
  let cumUsd = 0, cumMgsn = 0;
  for (let m = 1; m <= months; m++) {
    cumUsd  += pledgeAmt;
    rows.push({ month: m, pledgeUsd: pledgeAmt, cumUsd });
  }
  return {
    rows,
    monthlyFee,
    pledgeAmt,
    userShare: userShare * 100,
    volumeEstimated: livePoolStats?.mgsnVol30d == null && livePoolStats?.mgsnVol24h == null,
    liquidityEstimated: livePoolStats?.mgsnLiq == null,
  };
}

function computeTotals(log) {
  const totalUsd  = log.reduce((a, b) => a + (b.usdSpent ?? 0), 0);
  const totalMgsn = log.reduce((a, b) => a + (b.mgsnAcquired ?? 0), 0);
  return { totalUsd, totalMgsn };
}

// ── Chart ─────────────────────────────────────────────────────────────────────

let buybackChart = null;

function renderPressureChart(schedule) {
  const el = document.getElementById("chart-pressure");
  if (!el) return;
  el.width  = Math.max((el.parentElement?.clientWidth ?? 600) - 32, 280);
  el.height = 220;
  el.style.width  = el.width + "px";
  el.style.height = el.height + "px";

  if (buybackChart) buybackChart.destroy();
  buybackChart = new Chart(el, {
    type: "bar",
    data: {
      labels: schedule.rows.map((r) => `M${r.month}`),
      datasets: [
        {
          label: "Monthly buyback (USD)",
          data: schedule.rows.map((r) => r.pledgeUsd),
          backgroundColor: "rgba(249,115,22,0.65)",
          borderRadius: 4,
        },
        {
          type: "line",
          label: "Cumulative (USD)",
          data: schedule.rows.map((r) => r.cumUsd),
          borderColor: "#f59e0b",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.35,
          yAxisID: "yCum",
        },
      ],
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
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
        yCum: { position: "right", grid: { drawOnChartArea: false }, ticks: { color: "#f59e0b", font: { family: "'IBM Plex Mono', monospace", size: 10 }, callback: (v) => compactMoney(v) }, border: { color: "#1a1f3a" } },
      },
    },
  });
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function logRow(entry, idx) {
  if (!entry.date) return "";
  return `
    <div class="bb-log-row">
      <span class="bb-log-date">${entry.date}</span>
      <span class="bb-log-usd">${fmtMaybeMoney(entry.usdSpent)}</span>
      <span class="bb-log-tokens">${compact(entry.mgsnAcquired)} MGSN</span>
      <span class="bb-log-note">${entry.note ?? ""}</span>
      ${entry.txId ? `<a class="bb-log-tx" href="https://www.icpexplorer.com/transaction/${entry.txId}" target="_blank" rel="noopener noreferrer">TX ↗</a>` : `<span class="bb-log-tx bb-log-tx--na">—</span>`}
    </div>`;
}

function buildHTML(log, totals, livePoolStats, mgsnNow, icpNow, buybackState, totalSupply, scenarioHeaderHtml) {
  const hasRealVolume = livePoolStats?.mgsnVol30d != null || livePoolStats?.mgsnVol24h != null;
  const liveTag = buybackState?.status === "simulated"
    ? `<span class="bb-live-tag bb-live-tag--demo">demo showcase</span>`
    : hasRealVolume
      ? `<span class="bb-live-tag">real ICPSwap volume</span>`
      : `<span class="bb-live-tag bb-live-tag--est">estimated</span>`;

  let logSection;
  if (log.length > 0) {
    logSection = `
      <div class="bb-log-header">
        <span>Date</span><span>USD spent</span><span>MGSN acquired</span><span>Note</span><span>TX</span>
      </div>
      ${log.map(logRow).join("")}`;
  } else if (buybackState?.status === "unconfigured") {
    logSection = `<p class="bb-empty">On-chain buyback indexing is ready, but the public buyback vault address has not been published yet. Once that address is disclosed, executed buybacks will appear automatically here. The next scheduled buyback remains <strong>${BUYBACK_PROGRAM.nextBuybackDate}</strong>.</p>`;
  } else if (buybackState?.status === "unavailable") {
    logSection = `<p class="bb-empty">The MGSN ledger could not be reached, so the buyback log could not be refreshed right now.</p>`;
  } else {
    logSection = `<p class="bb-empty">No on-chain inflows into the public buyback vault have been detected yet.</p>`;
  }

  return `
    <header class="top-header">
      <div class="top-header-logo">
        <div class="logo-icon">M</div>
        <div>
          <div class="logo-title">MGSN Strategy Tracker</div>
          <div class="logo-subtitle">on Internet Computer</div>
        </div>
      </div>
      <nav class="bb-nav">
        <a class="bb-nav-link" href="/">Dashboard</a>
        <a class="bb-nav-link" href="/strategy.html">Strategy</a>
        <a class="bb-nav-link active" href="/buyback.html">Buyback</a>
        <a class="bb-nav-link" href="/staking.html">Staking</a>
        <a class="bb-nav-link" href="/burn.html">Burn</a>
      </nav>
      <div class="top-header-spacer"></div>
      <div class="top-header-badge"><div class="live-dot"></div><span class="badge-text">Price support</span></div>
      <div class="top-header-icp">
        <span class="header-price-label">MGSN/USD</span>
        <span class="header-price-val" id="bb-mgsn-price">${mgsnNow ? fmt(mgsnNow, 7) : "—"}</span>
      </div>
    </header>

    <div class="bb-page">
      ${scenarioHeaderHtml}

      <!-- Hero -->
      <section class="bb-hero">
        <div class="bb-hero-left">
          <div class="bb-hero-eyebrow">MGSN Buyback Program · LP-fee funded</div>
          <h1 class="bb-hero-title">Systematic price support<br>for $MGSN</h1>
          <p class="bb-hero-body">
            ${BUYBACK_PROGRAM.pledgePct}% of all liquidity provider fee income earned from the MGSN/ICP pool on ICPSwap is committed to purchasing MGSN from the open market and permanently removing it from circulation. Every buyback is executed on-chain, publicly logged here, and verifiable on the ICP blockchain.
          </p>
          <div class="bb-hero-stats">
            <div class="bb-stat">
              <span class="bb-stat-label">Total USD deployed</span>
              <span class="bb-stat-val ${totals.totalUsd > 0 ? "pos" : ""}">${fmt(totals.totalUsd)}</span>
            </div>
            <div class="bb-stat">
              <span class="bb-stat-label">MGSN removed</span>
              <span class="bb-stat-val mgsn">${compact(totals.totalMgsn)}</span>
            </div>
            <div class="bb-stat">
              <span class="bb-stat-label">Buybacks executed</span>
              <span class="bb-stat-val">${log.length}</span>
            </div>
            <div class="bb-stat">
              <span class="bb-stat-label">Next buyback</span>
              <span class="bb-stat-val gold">${BUYBACK_PROGRAM.nextBuybackDate}</span>
            </div>
          </div>
        </div>
        <div class="bb-hero-right">
          <div class="bb-cta-card">
            <p class="bb-cta-label">Contribute to the buyback fund</p>
            <p class="bb-cta-body">Add liquidity to the MGSN/ICP pool on ICPSwap. Your fee income automatically funds future buybacks at the ${BUYBACK_PROGRAM.pledgePct}% pledge rate.</p>
            <a class="bb-cta-btn bb-cta-primary" href="${ICPSWAP_LP_URL}" target="_blank" rel="noopener noreferrer">Add Liquidity →</a>
            <a class="bb-cta-btn bb-cta-secondary" href="${ICPSWAP_SWAP_URL}" target="_blank" rel="noopener noreferrer">Buy MGSN now</a>
            <p class="bb-cta-disclaimer">You control your keys. Executes on ICPSwap DEX.</p>
          </div>
        </div>
      </section>

      <!-- How it works -->
      <section class="bb-section">
        <h2 class="bb-section-title">How the buyback program works</h2>
        <div class="bb-how-grid">
          <div class="bb-how-card">
            <div class="bb-how-num">01</div>
            <div class="bb-how-head">LP fees accumulate</div>
            <p class="bb-how-body">Every swap through the MGSN/ICP pool on ICPSwap charges a 0.3% fee. Liquidity providers earn a proportional share of those fees continuously.</p>
          </div>
          <div class="bb-how-card">
            <div class="bb-how-num">02</div>
            <div class="bb-how-head">${BUYBACK_PROGRAM.pledgePct}% is pledged</div>
            <p class="bb-how-body">Half of all fee income attributed to this program is earmarked for buybacks. The remainder stays in the LP position, growing the pool share over time.</p>
          </div>
          <div class="bb-how-card">
            <div class="bb-how-num">03</div>
            <div class="bb-how-head">Monthly market buy</div>
            <p class="bb-how-body">Every ~${BUYBACK_PROGRAM.intervalDays} days, the pledged amount is used to buy MGSN from the open market on ICPSwap at the current price. The transaction ID is recorded here.</p>
          </div>
          <div class="bb-how-card">
            <div class="bb-how-num">04</div>
            <div class="bb-how-head">Supply reduction</div>
            <p class="bb-how-body">Acquired MGSN is held in a publicly visible wallet or burned. The total removed from circulation is shown in the log above and auditable on-chain.</p>
          </div>
        </div>
      </section>

      <!-- Buyback pressure projector -->
      <section class="bb-section">
        <h2 class="bb-section-title">Buyback pressure projector</h2>
        <p class="bb-section-sub">Estimate monthly buyback amounts based on your LP deposit and current pool activity. ${liveTag}</p>
        <div class="bb-calc-grid">
          <div class="bb-calc-card">
            <label class="bb-input-label">Your LP deposit (USD)</label>
            <input id="bb-deposit" type="number" class="bb-input" value="500" min="1" step="50" />
            <div id="bb-calc-results" class="bb-calc-results"></div>
          </div>
          <div class="bb-calc-card">
            <span class="bb-calc-section-label">12-month buyback schedule (your contribution)</span>
            <div class="bb-chart-wrap" style="height:220px"><canvas id="chart-pressure"></canvas></div>
          </div>
        </div>
      </section>

      <!-- Effect on price -->
      <section class="bb-section">
        <h2 class="bb-section-title">Why buybacks increase token value</h2>
        <div class="bb-effect-grid">
          <div class="bb-effect-card">
            <div class="bb-effect-icon">↓</div>
            <div class="bb-effect-title">Reduces circulating supply</div>
            <p class="bb-effect-body">Every buyback permanently removes MGSN from the market. With a live circulating supply of ${compact(totalSupply)} tokens, supply reduction directly improves the price-to-value ratio for remaining holders.</p>
          </div>
          <div class="bb-effect-card">
            <div class="bb-effect-icon">↑</div>
            <div class="bb-effect-title">Creates consistent buy pressure</div>
            <p class="bb-effect-body">Scheduled monthly market buys create a predictable demand floor. Unlike speculation-driven buying, this demand is mechanically linked to actual trading activity in the pool — it scales with volume.</p>
          </div>
          <div class="bb-effect-card">
            <div class="bb-effect-icon">◎</div>
            <div class="bb-effect-title">Aligns LP and holder incentives</div>
            <p class="bb-effect-body">Liquidity providers directly benefit from token price appreciation. By converting part of their fee income into buybacks, LPs strengthen the asset their own liquidity supports — a compounding alignment loop.</p>
          </div>
          <div class="bb-effect-card">
            <div class="bb-effect-icon">⧖</div>
            <div class="bb-effect-title">Compounds over time</div>
            <p class="bb-effect-body">As the MGSN price rises, the LP position appreciates, generating more fee income, which funds larger buybacks, which further support the price. The programme is self-reinforcing as pool activity grows.</p>
          </div>
        </div>
      </section>

      <!-- Public buyback log -->
      <section class="bb-section">
        <h2 class="bb-section-title">Public buyback log</h2>
        <p class="bb-section-sub">Every buyback executed under this programme, in chronological order. ${buybackState?.note ?? "Transaction indexing is pending."}</p>
        <div class="bb-log">${logSection}</div>
      </section>

      <!-- Participate -->
      <section class="bb-section bb-participate">
        <div class="bb-participate-inner">
          <h2 class="bb-participate-title">Participate in the programme</h2>
          <p class="bb-participate-body">The more liquidity in the MGSN/ICP pool, the larger the fee income, the larger the buybacks, and the stronger the price support. You do not need to do anything beyond adding liquidity — the buybacks happen automatically on a monthly schedule.</p>
          <div class="bb-participate-btns">
            <a class="bb-cta-btn bb-cta-primary" href="${ICPSWAP_LP_URL}" target="_blank" rel="noopener noreferrer">Add Liquidity on ICPSwap →</a>
            <a class="bb-cta-btn bb-cta-secondary" href="/strategy.html">View strategy signals</a>
          </div>
          <p class="bb-participate-disclaimer">Adding liquidity involves impermanent loss risk. See the Strategy Engine LP calculator for a full yield and IL analysis before depositing.</p>
        </div>
      </section>

      <div class="page-footer" style="padding:24px 0 60px">
        <p>Buyback programme is operated in good faith. Not financial advice.</p>
        <p style="margin-top:4px">Powered by <a href="https://icpswap.com" target="_blank" rel="noopener noreferrer">ICPSwap</a> · Verified on ICP mainnet</p>
      </div>
    </div>`;
}

// ── Calc renderer ─────────────────────────────────────────────────────────────

function renderCalc(livePoolStats, mgsnNow) {
  const deposit  = parseFloat(document.getElementById("bb-deposit")?.value) || 500;
  const schedule = projectBuybackSchedule(livePoolStats, deposit);
  const annual   = schedule.pledgeAmt * 12;

  const resEl = document.getElementById("bb-calc-results");
  if (resEl) {
    resEl.innerHTML = `
      <div class="bb-calc-divider"></div>
      <div class="bb-calc-row"><span class="bb-calc-label">Your pool share</span><span class="bb-calc-val">${schedule.userShare.toFixed(2)}%</span></div>
      <div class="bb-calc-row"><span class="bb-calc-label">Volume basis</span><span class="bb-calc-val">${schedule.volumeEstimated ? "Configured estimate" : "ICPSwap 30d history"}</span></div>
      <div class="bb-calc-row"><span class="bb-calc-label">Liquidity basis</span><span class="bb-calc-val">${schedule.liquidityEstimated ? "Configured TVL estimate" : "Live pool TVL"}</span></div>
      <div class="bb-calc-row"><span class="bb-calc-label">Monthly fee income</span><span class="bb-calc-val pos">${fmt(schedule.monthlyFee)}</span></div>
      <div class="bb-calc-row"><span class="bb-calc-label">Monthly buyback pledge (${BUYBACK_PROGRAM.pledgePct}%)</span><span class="bb-calc-val mgsn">${fmt(schedule.pledgeAmt)}</span></div>
      <div class="bb-calc-row"><span class="bb-calc-label">Annual buyback from your share</span><span class="bb-calc-val mgsn">${fmt(annual)}</span></div>
      ${mgsnNow ? `<div class="bb-calc-row"><span class="bb-calc-label">MGSN bought/month (est.)</span><span class="bb-calc-val">${compact(schedule.pledgeAmt / mgsnNow)} MGSN</span></div>` : ""}
      <div class="bb-calc-row"><span class="bb-calc-label">MGSN bought/year (est.)</span><span class="bb-calc-val">${mgsnNow ? compact(annual / mgsnNow) + " MGSN" : "—"}</span></div>`;
  }

  renderPressureChart(schedule);
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const BUYBACK_CSS = `
.bb-page { padding-top: var(--header-h); max-width: 1200px; margin: 0 auto; padding-left: 24px; padding-right: 24px; padding-bottom: 60px; }

/* Nav */
.bb-nav { display: flex; align-items: center; gap: 2px; margin-left: 24px; }
.bb-nav-link { padding: 6px 14px; border-radius: var(--radius-md); font-size: 0.78rem; font-weight: 500; color: var(--muted); text-decoration: none; transition: background 120ms, color 120ms; font-family: "IBM Plex Mono", monospace; letter-spacing: 0.03em; }
.bb-nav-link:hover { color: var(--ink); background: rgba(255,255,255,0.05); }
.bb-nav-link.active { color: var(--mgsn); background: rgba(249,115,22,0.1); }

/* Hero */
.bb-hero { display: flex; align-items: flex-start; gap: 32px; padding: 32px 0 28px; border-bottom: 1px solid var(--panel-border); flex-wrap: wrap; }
.bb-hero-left { flex: 1; min-width: 300px; }
.bb-hero-right { flex-shrink: 0; }
.bb-hero-eyebrow { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 10px; }
.bb-hero-title { font-size: 2.1rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 14px; color: var(--ink); }
.bb-hero-body { font-size: 0.88rem; color: var(--ink2); max-width: 540px; line-height: 1.7; margin: 0 0 20px; }
.bb-hero-stats { display: flex; gap: 24px; flex-wrap: wrap; }
.bb-stat { display: flex; flex-direction: column; gap: 3px; }
.bb-stat-label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.bb-stat-val { font-size: 1.1rem; font-weight: 700; color: var(--ink); font-family: "IBM Plex Mono", monospace; }
.bb-stat-val.mgsn { color: var(--mgsn); } .bb-stat-val.pos { color: var(--positive); } .bb-stat-val.gold { color: var(--gold); }

/* CTA card */
.bb-cta-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-xl); padding: 22px; min-width: 220px; display: flex; flex-direction: column; gap: 10px; }
.bb-cta-label { font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin: 0; }
.bb-cta-body { font-size: 0.76rem; color: var(--ink2); line-height: 1.6; margin: 0; }
.bb-cta-btn { display: block; padding: 10px 18px; border-radius: var(--radius-md); font-size: 0.84rem; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; transition: opacity 140ms; }
.bb-cta-btn:hover { opacity: 0.85; }
.bb-cta-primary { background: linear-gradient(135deg, var(--mgsn), #c2410c); color: #fff; }
.bb-cta-secondary { background: var(--surface); border: 1px solid var(--panel-border); color: var(--ink2); }
.bb-cta-disclaimer { font-size: 0.62rem; color: var(--muted-alt); font-family: "IBM Plex Mono", monospace; margin: 0; text-align: center; line-height: 1.5; }

/* Section */
.bb-section { padding: 28px 0 0; }
.bb-section-title { font-size: 0.82rem; font-weight: 700; color: var(--ink); letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 4px; font-family: "IBM Plex Mono", monospace; }
.bb-section-sub { font-size: 0.74rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin: 0 0 14px; max-width: 720px; }
.bb-live-tag { font-size: 0.62rem; padding: 2px 8px; border-radius: 4px; background: rgba(34,197,94,0.12); color: var(--positive); font-family: "IBM Plex Mono", monospace; margin-left: 4px; }
.bb-live-tag--est { background: rgba(245,158,11,0.12); color: var(--gold); }
.bb-live-tag--demo { background: rgba(249,115,22,0.12); color: var(--mgsn); }

/* How-it-works */
.bb-how-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-top: 16px; }
.bb-how-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 18px 18px 16px; }
.bb-how-num { font-size: 0.62rem; font-weight: 700; color: var(--mgsn); font-family: "IBM Plex Mono", monospace; letter-spacing: 0.1em; margin-bottom: 8px; }
.bb-how-head { font-size: 0.84rem; font-weight: 700; color: var(--ink); margin-bottom: 8px; }
.bb-how-body { font-size: 0.74rem; color: var(--ink2); line-height: 1.65; margin: 0; }

/* Effect grid */
.bb-effect-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 16px; }
.bb-effect-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 18px; }
.bb-effect-icon { font-size: 1.4rem; margin-bottom: 8px; color: var(--mgsn); }
.bb-effect-title { font-size: 0.84rem; font-weight: 700; color: var(--ink); margin-bottom: 8px; }
.bb-effect-body { font-size: 0.74rem; color: var(--ink2); line-height: 1.65; margin: 0; }

/* Calculator */
.bb-calc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.bb-calc-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 16px 18px; }
.bb-input-label { display: block; font-size: 0.67rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 5px; }
.bb-input { width: 100%; padding: 8px 11px; background: var(--surface); border: 1px solid var(--panel-border); border-radius: var(--radius-md); color: var(--ink); font-size: 0.84rem; font-family: "IBM Plex Mono", monospace; outline: none; transition: border-color 140ms; }
.bb-input:focus { border-color: var(--mgsn); }
.bb-calc-results { margin-top: 12px; }
.bb-calc-divider { height: 1px; background: var(--line); margin: 8px 0; }
.bb-calc-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
.bb-calc-label { font-size: 0.7rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.bb-calc-val { font-size: 0.8rem; font-weight: 600; color: var(--ink); font-family: "IBM Plex Mono", monospace; }
.bb-calc-val.mgsn { color: var(--mgsn); } .bb-calc-val.pos { color: var(--positive); }
.bb-calc-section-label { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 8px; display: block; }
.bb-chart-wrap { position: relative; overflow: hidden; }
.bb-chart-wrap canvas { display: block; }

/* Log */
.bb-log { margin-top: 12px; }
.bb-empty { font-size: 0.84rem; color: var(--ink2); font-family: "IBM Plex Mono", monospace; padding: 16px 0; }
.bb-log-header { display: grid; grid-template-columns: 6rem 5rem 7rem 1fr 3.5rem; gap: 8px; padding: 6px 10px; background: var(--surface); border-radius: var(--radius-sm); font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 4px; }
.bb-log-row { display: grid; grid-template-columns: 6rem 5rem 7rem 1fr 3.5rem; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); font-size: 0.74rem; font-family: "IBM Plex Mono", monospace; align-items: center; }
.bb-log-date { color: var(--muted); }
.bb-log-usd { color: var(--positive); font-weight: 600; }
.bb-log-tokens { color: var(--mgsn); font-weight: 600; }
.bb-log-note { color: var(--ink2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bb-log-tx { color: var(--bob); text-decoration: none; font-size: 0.68rem; }
.bb-log-tx:hover { text-decoration: underline; }
.bb-log-tx--na { color: var(--muted-alt); }

/* Participate */
.bb-participate { margin-top: 16px; }
.bb-participate-inner { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-xl); padding: 28px 32px; max-width: 700px; }
.bb-participate-title { font-size: 1.1rem; font-weight: 700; color: var(--ink); margin: 0 0 12px; }
.bb-participate-body { font-size: 0.86rem; color: var(--ink2); line-height: 1.7; margin: 0 0 18px; }
.bb-participate-btns { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.bb-participate-disclaimer { font-size: 0.67rem; color: var(--muted-alt); font-family: "IBM Plex Mono", monospace; margin: 0; line-height: 1.5; }

@media (max-width: 900px) {
  .bb-page { padding-left: 14px; padding-right: 14px; }
  .bb-calc-grid { grid-template-columns: 1fr; }
  .bb-hero { flex-direction: column; gap: 20px; }
}
@media (max-width: 600px) {
  .bb-nav { display: none; }
}
`;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  const styleEl = document.createElement("style");
  styleEl.textContent = BUYBACK_CSS;
  document.head.appendChild(styleEl);

  const app = document.querySelector("#app");
  const cachedState = readViewCache("buyback-page");
  let baseState = buildBasePageState(cachedState ?? {});
  renderBuybackPage(app, baseState, cachedState ? "cached" : "fallback");

  const [liveSpotResult, liveIcpswapResult, livePoolResult, liveBuybackResult] = await Promise.allSettled([
    fetchLiveSpotPrices(),
    fetchICPSwapPrices(),
    fetchICPSwapPoolStats(),
    fetchBuybackProgramData(),
  ]);

  baseState = buildBasePageState({
    mgsnNow: liveIcpswapResult.value?.mgsnUsd ?? baseState.mgsnNow,
    icpNow: liveSpotResult.value?.icpUsd ?? baseState.icpNow,
    livePoolStats: livePoolResult.value ?? baseState.livePoolStats,
    buybackState: liveBuybackResult.value ?? baseState.buybackState,
  });
  writeViewCache("buyback-page", baseState);
  renderBuybackPage(app, baseState, "live");
}

bootstrap();

function fallbackBuybackState() {
  return {
    status: "unavailable",
    log: [],
    note: "The MGSN ledger could not be reached to verify buybacks.",
    currentSupply: demoDashboard.mgsnSupply,
  };
}

function buildBasePageState(raw = {}) {
  return {
    mgsnNow: raw.mgsnNow ?? demoDashboard.timeline.at(-1).mgsnPrice,
    icpNow: raw.icpNow ?? demoDashboard.timeline.at(-1).icpPrice,
    livePoolStats: raw.livePoolStats ?? {},
    buybackState: raw.buybackState ?? fallbackBuybackState(),
  };
}

function renderBuybackPage(app, baseState, hydrationMode) {
  const scenario = loadScenarioState();
  const prices = applyScenarioToPrices(
    { mgsnUsd: baseState.mgsnNow, icpUsd: baseState.icpNow },
    scenario
  );
  const livePoolStats = applyScenarioToPoolStats(baseState.livePoolStats, scenario);
  const simulatedState = buildSimulatedBuybackState(
    baseState.buybackState?.currentSupply ?? demoDashboard.mgsnSupply,
    prices.mgsnUsd,
    scenario
  );
  const buybackState = simulatedState ?? baseState.buybackState ?? fallbackBuybackState();
  const buybackLog = buybackState.log ?? [];
  const totalSupply = buybackState.currentSupply ?? demoDashboard.mgsnSupply;
  const totals = computeTotals(buybackLog);

  app.innerHTML = buildHTML(
    buybackLog,
    totals,
    livePoolStats,
    prices.mgsnUsd,
    prices.icpUsd,
    buybackState,
    totalSupply,
    buildScenarioHeaderHTML(
      "buyback",
      buildBuybackSourceChips(buybackState, scenario, hydrationMode)
    )
  );

  renderCalc(livePoolStats, prices.mgsnUsd);
  document.getElementById("bb-deposit")?.addEventListener("input", () => {
    renderCalc(livePoolStats, prices.mgsnUsd);
  });

  attachScenarioStudio(app, () => {
    renderBuybackPage(app, baseState, loadScenarioState().demoMode ? "demo" : hydrationMode);
  });

  if (prices.mgsnUsd) {
    const el = document.getElementById("bb-mgsn-price");
    if (el) el.textContent = fmt(prices.mgsnUsd, 7);
  }
}
