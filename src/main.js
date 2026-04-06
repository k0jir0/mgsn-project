import "./styles.css";
import Chart from "chart.js/auto";

// Force any waiting service worker to activate immediately so new deploys
// take effect without requiring a manual SW unregister.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => {
      if (r.waiting) r.waiting.postMessage({ type: "SKIP_WAITING" });
      r.update();
    });
  });
}

import { createBackendActor }  from "./actor";
import { demoDashboard }       from "./demoData";
import { fetchLiveSpotPrices } from "./liveData";

// ── Color palette ─────────────────────────────────────────────────────────────

const C = {
  mgsn:     "#f97316",
  mgsnFill: "rgba(249,115,22,0.12)",
  bob:      "#3b82f6",
  bobFill:  "rgba(59,130,246,0.12)",
  icp:      "#8b5cf6",
  icpFill:  "rgba(139,92,246,0.1)",
  gold:     "#f59e0b",
  goldFill: "rgba(245,158,11,0.1)",
  pos:      "#22c55e",
  neg:      "#ef4444",
  ma:       "rgba(249,115,22,0.45)",
  maB:      "rgba(59,130,246,0.45)",
  grid:     "#1a1f3a",
  tick:     "#5a6a8a",
  tooltip: {
    bg:     "#0f1120",
    border: "#1a1f3a",
    title:  "#f0f4ff",
    body:   "#94a3b8",
  },
};

// ── Panel registry ─────────────────────────────────────────────────────────────
// Mirrors SaylorTracker sidebar order exactly
const PANELS = [
  { id: "reserve",     label: "Token Purchases",         dot: C.mgsn },
  { id: "sma",         label: "BOB & MGSN 200-SMA",      dot: C.mgsn },
  { id: "performance", label: "Performance vs. ICP",     dot: C.icp  },
  { id: "yield",       label: "MGSN Yield, Gain & Holdings", dot: C.mgsn },
  { id: "satstoshare", label: "ICP per Token",           dot: C.bob  },
  { id: "nav",         label: "mNAV Analysis",           dot: C.mgsn },
  { id: "cost",        label: "Token Cost in ICP",       dot: C.gold },
  { id: "volatility",  label: "Volatility Comparison",   dot: C.icp  },
  { id: "volume",      label: "Trading Volume & Liquidity", dot: C.bob },
  { id: "raises",      label: "Token Accumulation",      dot: C.pos  },
];

// ── State ──────────────────────────────────────────────────────────────────────

const state = {
  panelRanges: Object.fromEntries(PANELS.map((p) => [p.id, "all"])),
  visible:     new Set(PANELS.map((p) => p.id)),
  liveIcpUsd:  null,
};

const charts = {};

// ── Math helpers ───────────────────────────────────────────────────────────────

function sma(arr, period) {
  return arr.map((_, i) => {
    if (i < period - 1) return null;
    const s = arr.slice(i - period + 1, i + 1);
    return s.reduce((a, b) => a + b, 0) / period;
  });
}

function rollingStd(arr, period) {
  return arr.map((_, i) => {
    if (i < period - 1) return null;
    const s = arr.slice(i - period + 1, i + 1);
    const m = s.reduce((a, b) => a + b, 0) / period;
    return Math.sqrt(s.reduce((a, v) => a + (v - m) ** 2, 0) / period);
  });
}

function getSeries(timeline, rangeKey) {
  const map = { "1y": 12, "6m": 6, "3m": 3, "1m": 1 };
  const n = map[rangeKey];
  return n ? timeline.slice(-n) : timeline;
}

// ── Format helpers ─────────────────────────────────────────────────────────────

function fmt(v, d = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: d, maximumFractionDigits: d,
  }).format(v);
}

function compact(v) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact", maximumFractionDigits: 2,
  }).format(v);
}

function compactMoney(v) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    notation: "compact", maximumFractionDigits: 2,
  }).format(v);
}

function pct(start, end) {
  if (start === 0) return 0;
  return ((end - start) / start) * 100;
}

function pctFmt(v, decimals = 1) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)}%`;
}

// ── Chart.js base options ──────────────────────────────────────────────────────

function baseOpts(yTickFmt = (v) => v) {
  return {
    responsive: false,
    maintainAspectRatio: false,
    animation: false,   // draw synchronously — no requestAnimationFrame dependency
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: C.tooltip.bg,
        borderColor:     C.tooltip.border,
        borderWidth:     1,
        titleColor:      C.tooltip.title,
        bodyColor:       C.tooltip.body,
        padding:         10,
        callbacks: {},
      },
    },
    scales: {
      x: {
        grid:  { color: C.grid, lineWidth: 0.5 },
        ticks: { color: C.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 }, maxRotation: 0 },
        border: { color: C.grid },
      },
      y: {
        grid:  { color: C.grid, lineWidth: 0.5 },
        ticks: { color: C.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 }, callback: yTickFmt },
        border: { color: C.grid },
      },
    },
  };
}

function mkChart(id, config) {
  if (charts[id]) charts[id].destroy();
  const canvas = document.getElementById(`chart-${id}`);
  if (!canvas) return;
  charts[id] = new Chart(canvas, config);
}

// ── Chart builders ─────────────────────────────────────────────────────────────

// Panel 1 — Token Purchases (SaylorTracker: Bitcoin Reserve with Cash Reserve tab)
// We show cumulative MGSN market cap (filled) and BOB market cap (line)
function renderReserveChart(series) {
  const labels = series.map((p) => p.period.split(" ")[0]);
  const mgsnCap = series.map((p) => p.mgsnPrice * 77_000_000);
  const bobCap  = series.map((p) => p.bobPrice  * 210_000_000);
  const opts = baseOpts((v) => compactMoney(v));
  opts.plugins.tooltip.callbacks.label = (ctx) =>
    ` ${ctx.dataset.label}: ${compactMoney(ctx.raw)}`;
  mkChart("reserve", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "MGSN Mkt Cap", data: mgsnCap, borderColor: C.mgsn, borderWidth: 2.5,
          pointRadius: 0, fill: true, backgroundColor: C.mgsnFill, tension: 0.35 },
        { label: "BOB Mkt Cap",  data: bobCap,  borderColor: C.bob,  borderWidth: 2,
          pointRadius: 0, fill: false, tension: 0.35 },
      ],
    },
    options: opts,
  });
}

// Panel 2 — BOB & MGSN 200-SMA (SaylorTracker: Bitcoin & Strategy 200-WMA)
function renderSmaChart(series) {
  const labels  = series.map((p) => p.period.split(" ")[0]);
  const bob     = series.map((p) => p.bobPrice);
  const mgsn    = series.map((p) => p.mgsnPrice);
  const bobMA   = sma(bob,  Math.min(series.length, 8));   // monthly, so 8-period ~ 200-day-ish
  const mgsnMA  = sma(mgsn, Math.min(series.length, 8));
  const opts    = baseOpts((v) => fmt(v, 4));
  opts.plugins.tooltip.callbacks.label = (ctx) =>
    ctx.raw !== null ? ` ${ctx.dataset.label}: ${fmt(ctx.raw, 4)}` : null;
  mkChart("sma", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "BOB price",   data: bob,   borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.35 },
        { label: "MGSN price",  data: mgsn,  borderColor: C.mgsn, borderWidth: 2,   pointRadius: 0, tension: 0.35 },
        { label: "BOB 8-SMA",   data: bobMA,  borderColor: C.maB,  borderWidth: 1.5, pointRadius: 0, borderDash: [5,3], tension: 0.35, spanGaps: true },
        { label: "MGSN 8-SMA",  data: mgsnMA, borderColor: C.ma,   borderWidth: 1.5, pointRadius: 0, borderDash: [5,3], tension: 0.35, spanGaps: true },
      ],
    },
    options: opts,
  });
}

// Panel 3 — Performance vs ICP (SaylorTracker: Performance vs. Benchmarks)
function renderPerformanceChart(series) {
  const labels   = series.map((p) => p.period.split(" ")[0]);
  const base     = (arr, field) => arr.map((p) => (p[field] / arr[0][field]) * 100);
  const mgsnPerf = base(series, "mgsnPrice");
  const bobPerf  = base(series, "bobPrice");
  const icpPerf  = base(series, "icpPrice");
  const opts     = baseOpts((v) => `${v.toFixed(0)}%`);
  opts.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%`;
  mkChart("performance", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "MGSN", data: mgsnPerf, borderColor: C.mgsn, borderWidth: 2.5, pointRadius: 0, tension: 0.35 },
        { label: "BOB",  data: bobPerf,  borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.35 },
        { label: "ICP",  data: icpPerf,  borderColor: C.icp,  borderWidth: 1.5, pointRadius: 0, borderDash: [4,3], tension: 0.35 },
      ],
    },
    options: opts,
  });
}

// Panel 4 — MGSN Yield, Gain & Holdings (SaylorTracker: BTC Yield, Gain & Holdings)
// Bars = monthly % gain, Line = cumulative gain, secondary line = holdings value
function renderYieldChart(series) {
  const labels   = series.map((p) => p.period.split(" ")[0]);
  const monthGain = series.map((p, i) =>
    i === 0 ? 0 : pct(series[i - 1].mgsnPrice, p.mgsnPrice));
  const cumulative = series.map((p) => pct(series[0].mgsnPrice, p.mgsnPrice));
  const holdings   = series.map((p) => p.mgsnPrice * 77_000_000);

  const opts = {
    ...baseOpts(),
    scales: {
      x: baseOpts().scales.x,
      y: {
        ...baseOpts().scales.y,
        ticks: { ...baseOpts().scales.y.ticks, callback: (v) => `${v.toFixed(0)}%` },
      },
      y2: {
        position: "right",
        grid: { display: false },
        ticks: { color: C.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 },
          callback: (v) => compactMoney(v) },
        border: { color: C.grid },
      },
    },
  };
  mkChart("yield", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { type: "bar",  label: "Monthly Gain %",  data: monthGain,
          backgroundColor: monthGain.map((v) => v >= 0 ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"),
          borderRadius: 3, yAxisID: "y" },
        { type: "line", label: "Cumulative %",   data: cumulative, borderColor: C.mgsn,
          borderWidth: 2, pointRadius: 0, tension: 0.35, fill: false, yAxisID: "y" },
        { type: "line", label: "Holdings Value", data: holdings,   borderColor: C.bob,
          borderWidth: 1.5, pointRadius: 0, tension: 0.35, borderDash: [4,3], yAxisID: "y2" },
      ],
    },
    options: opts,
  });
}

// Panel 5 — ICP per Token (SaylorTracker: Sats per Share)
// Shows how many ICP units = 1 MGSN token and 1 BOB token over time
function renderSatsChart(series) {
  const labels  = series.map((p) => p.period.split(" ")[0]);
  // ICP is about $2-$14; tokens are sub-dollar → ICP-per-token < 1
  const mgsnIcp = series.map((p) => p.mgsnPrice / p.icpPrice);
  const bobIcp  = series.map((p) => p.bobPrice  / p.icpPrice);
  const mgsnMA  = sma(mgsnIcp, Math.min(series.length, 5));
  const opts    = baseOpts((v) => `${v.toFixed(4)} ICP`);
  opts.plugins.tooltip.callbacks.label = (ctx) =>
    ctx.raw !== null ? ` ${ctx.dataset.label}: ${ctx.raw.toFixed(5)} ICP` : null;
  mkChart("satstoshare", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "MGSN/ICP",     data: mgsnIcp, borderColor: C.mgsn, borderWidth: 2.5, pointRadius: 0, fill: true, backgroundColor: C.mgsnFill, tension: 0.35 },
        { label: "BOB/ICP",      data: bobIcp,  borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.35 },
        { label: "MGSN 5-SMA",   data: mgsnMA,  borderColor: C.ma,   borderWidth: 1.5, pointRadius: 0, borderDash: [4,3], tension: 0.35, spanGaps: true },
      ],
    },
    options: opts,
  });
}

// Panel 6 — mNAV Analysis (SaylorTracker: mNAV Analysis)
// mNAV = Market Cap / NAV. For us: MGSN mkt cap / (BOB backing value implied)
// We model NAV as BOB market cap since BOB is the "reserve asset"
function renderNavChart(series, dashboard) {
  const labels   = series.map((p) => p.period.split(" ")[0]);
  const mgsnCap  = series.map((p) => p.mgsnPrice * dashboard.mgsnSupply);
  const nav      = series.map((p) => p.bobPrice  * dashboard.bobSupply);   // implied NAV
  const mNav     = mgsnCap.map((m, i) => nav[i] > 0 ? m / nav[i] : 0);

  const opts2 = {
    ...baseOpts(),
    scales: {
      x: baseOpts().scales.x,
      y: {
        ...baseOpts().scales.y,
        ticks: { ...baseOpts().scales.y.ticks, callback: (v) => compactMoney(v) },
      },
      y2: {
        position: "right",
        grid: { display: false },
        ticks: { color: C.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 },
          callback: (v) => `${v.toFixed(3)}×` },
        border: { color: C.grid },
      },
    },
  };
  mkChart("nav", {
    type: "line",
    data: {
      labels,
      datasets: [
        { type: "line", label: "MGSN Mkt Cap", data: mgsnCap, borderColor: C.mgsn, borderWidth: 2.5, pointRadius: 0, fill: true, backgroundColor: C.mgsnFill, tension: 0.35, yAxisID: "y" },
        { type: "line", label: "Implied NAV",  data: nav,     borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.35, yAxisID: "y" },
        { type: "line", label: "mNAV ratio",   data: mNav,    borderColor: C.gold, borderWidth: 2,   pointRadius: 0, borderDash: [5,3], tension: 0.35, yAxisID: "y2" },
      ],
    },
    options: opts2,
  });
}

// Panel 7 — Token Cost in ICP (SaylorTracker: Share Cost in Satoshis)
// ICP cost basis per token (how many ICP to buy 1 MGSN at each period's price)
function renderCostChart(series) {
  const labels  = series.map((p) => p.period.split(" ")[0]);
  const mgsnIcp = series.map((p) => p.mgsnPrice / p.icpPrice);
  const bobIcp  = series.map((p) => p.bobPrice  / p.icpPrice);
  const avgMgsn = mgsnIcp.reduce((a, b) => a + b, 0) / mgsnIcp.length;
  const avgLine = mgsnIcp.map(() => avgMgsn);  // horizontal avg cost line like SaylorTracker
  const opts    = baseOpts((v) => `${v.toFixed(4)} ICP`);
  opts.plugins.tooltip.callbacks.label = (ctx) =>
    ctx.raw !== null ? ` ${ctx.dataset.label}: ${ctx.raw.toFixed(6)} ICP` : null;
  mkChart("cost", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "MGSN cost (ICP)", data: mgsnIcp, borderColor: C.mgsn, borderWidth: 2.5, pointRadius: 0, tension: 0.35, fill: true, backgroundColor: C.mgsnFill },
        { label: "BOB cost (ICP)",  data: bobIcp,  borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.35 },
        { label: "Avg MGSN cost",   data: avgLine, borderColor: C.gold, borderWidth: 1.5, pointRadius: 0, borderDash: [6,3] },
      ],
    },
    options: opts,
  });
}

// Panel 8 — Volatility Comparison (same as SaylorTracker)
function renderVolatilityChart(series) {
  const labels  = series.map((p) => p.period.split(" ")[0]);
  const mgsnVol = rollingStd(series.map((p) => p.mgsnPrice), 3);
  const bobVol  = rollingStd(series.map((p) => p.bobPrice),  3);
  const icpVol  = rollingStd(series.map((p) => p.icpPrice),  3);
  const opts    = baseOpts((v) => (v === null ? "" : `$${v.toFixed(3)}`));
  opts.plugins.tooltip.callbacks.label = (ctx) =>
    ctx.raw !== null ? ` ${ctx.dataset.label}: $${ctx.raw.toFixed(4)}` : null;
  mkChart("volatility", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "MGSN vol", data: mgsnVol, borderColor: C.mgsn, borderWidth: 2.5, pointRadius: 0, tension: 0.35, spanGaps: true },
        { label: "BOB vol",  data: bobVol,  borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.35, spanGaps: true },
        { label: "ICP vol",  data: icpVol,  borderColor: C.icp,  borderWidth: 1.5, pointRadius: 0, borderDash: [4,3], tension: 0.35, spanGaps: true },
      ],
    },
    options: opts,
  });
}

// Panel 9 — Trading Volume & Liquidity (same as SaylorTracker)
function renderVolumeChart(series) {
  const labels = series.map((p) => p.period.split(" ")[0]);
  const opts = {
    ...baseOpts(),
    scales: {
      x: baseOpts().scales.x,
      y: {
        ...baseOpts().scales.y,
        ticks: { ...baseOpts().scales.y.ticks, callback: (v) => compactMoney(v) },
        stacked: false,
      },
      y2: {
        position: "right",
        grid: { display: false },
        ticks: { color: C.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 },
          callback: (v) => compactMoney(v) },
        border: { color: C.grid },
      },
    },
  };
  mkChart("volume", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { type: "bar",  label: "BOB volume",      data: series.map((p) => p.bobVolume),
          backgroundColor: "rgba(59,130,246,0.5)", borderRadius: 3, yAxisID: "y" },
        { type: "bar",  label: "MGSN volume",     data: series.map((p) => p.mgsnVolume),
          backgroundColor: "rgba(249,115,22,0.5)", borderRadius: 3, yAxisID: "y" },
        { type: "line", label: "Total liquidity", data: series.map((p) => p.bobLiquidity + p.mgsnLiquidity),
          borderColor: C.pos, borderWidth: 2, pointRadius: 0, tension: 0.35, yAxisID: "y2" },
      ],
    },
    options: opts,
  });
}

// Panel 10 — Token Accumulation (SaylorTracker: ATM Raises)
// Bar chart of cumulative MGSN & BOB acquired (using volume as proxy for accumulation activity)
function renderRaisesChart(series) {
  const labels = series.map((p) => p.period.split(" ")[0]);
  const cumBob  = series.map((_, i) => series.slice(0, i + 1).reduce((s, p) => s + p.bobVolume, 0));
  const cumMgsn = series.map((_, i) => series.slice(0, i + 1).reduce((s, p) => s + p.mgsnVolume, 0));
  const opts    = baseOpts((v) => compactMoney(v));
  opts.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.dataset.label}: ${compactMoney(ctx.raw)}`;
  mkChart("raises", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Cumul. BOB Volume",  data: cumBob,  backgroundColor: "rgba(59,130,246,0.55)", borderRadius: 3 },
        { label: "Cumul. MGSN Volume", data: cumMgsn, backgroundColor: "rgba(249,115,22,0.55)", borderRadius: 3 },
      ],
    },
    options: opts,
  });
}

// ── Render all charts ─────────────────────────────────────────────────────────

// ── Render all charts ────────────────────────────────────────────────────────
function renderAllCharts(dashboard) {
  PANELS.forEach(({ id }) => {
    const canvas = document.getElementById(`chart-${id}`);
    if (!canvas) return;

    const panel = document.getElementById(`panel-${id}`);
    const w     = panel ? Math.max(panel.clientWidth - 44, 300) : 800;
    const h     = id === 'reserve' ? 340 : 310;
    canvas.width        = w;
    canvas.height       = h;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';

    try {
      const series = getSeries(dashboard.timeline, state.panelRanges[id]);
      switch (id) {
        case "reserve":     renderReserveChart(series); break;
        case "sma":         renderSmaChart(series); break;
        case "performance": renderPerformanceChart(series); break;
        case "yield":       renderYieldChart(series); break;
        case "satstoshare": renderSatsChart(series); break;
        case "nav":         renderNavChart(series, dashboard); break;
        case "cost":        renderCostChart(series); break;
        case "volatility":  renderVolatilityChart(series); break;
        case "volume":      renderVolumeChart(series); break;
        case "raises":      renderRaisesChart(series); break;
      }
    } catch (e) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px monospace';
        ctx.fillText(`[${id}] ${e}`, 12, 28);
      }
    }
  });
}

// ── Compute latest-point metrics ──────────────────────────────────────────────

function computeMetrics(dashboard) {
  const tl     = dashboard.timeline;
  const last   = tl[tl.length - 1];
  const first  = tl[0];

  const mgsnCap      = last.mgsnPrice * dashboard.mgsnSupply;
  const bobCap       = last.bobPrice  * dashboard.bobSupply;
  const nav          = bobCap;   // implied NAV = BOB market cap
  const mNavRatio    = nav > 0 ? mgsnCap / nav : 0;
  const navPremium   = (mNavRatio - 1) * 100;  // % premium/discount to NAV

  const mgsnChange   = pct(first.mgsnPrice, last.mgsnPrice);
  const bobChange    = pct(first.bobPrice,  last.bobPrice);
  const icpChange    = pct(first.icpPrice,  last.icpPrice);

  const avgCostMgsn  = tl.reduce((s, p) => s + p.mgsnPrice, 0) / tl.length;
  const avgCostIcp   = tl.reduce((s, p) => s + p.mgsnPrice / p.icpPrice, 0) / tl.length;
  const unrealisedUsd = (last.mgsnPrice - avgCostMgsn) * dashboard.mgsnSupply;
  const unrealisedPct = pct(avgCostMgsn, last.mgsnPrice);

  const totalLiq     = last.bobLiquidity + last.mgsnLiquidity;
  const icpLive      = state.liveIcpUsd ?? last.icpPrice;

  // BTC-Yield equivalent: % change in mNAV ratio from first to last
  const firstNav     = (first.bobPrice * dashboard.bobSupply);
  const firstMgsnCap = (first.mgsnPrice * dashboard.mgsnSupply);
  const firstMNav    = firstNav > 0 ? firstMgsnCap / firstNav : 0;
  const mNavYield    = pct(firstMNav, mNavRatio);

  // ICP-per-token (sats-per-share equivalent)
  const mgsnIcp      = last.mgsnPrice / last.icpPrice;
  const bobIcp       = last.bobPrice  / last.icpPrice;

  return {
    last, mgsnCap, bobCap, nav, mNavRatio, navPremium,
    mgsnChange, bobChange, icpChange,
    avgCostMgsn, avgCostIcp, unrealisedUsd, unrealisedPct,
    totalLiq, icpLive,
    mNavYield, mgsnIcp, bobIcp,
  };
}

// ── HTML builders ─────────────────────────────────────────────────────────────

function tfGroup(panelId) {
  const cur = state.panelRanges[panelId];
  return ["all", "1y", "6m", "3m", "1m"]
    .map((r) => {
      const label = r === "all" ? "All Time" : r.toUpperCase();
      return `<button class="tf${r === cur ? " active" : ""}" data-panel="${panelId}" data-range="${r}">${label}</button>`;
    })
    .join("");
}

function panelHeader(title, subtitle, panelId, tabPair = null) {
  const titleHtml = tabPair
    ? `<div class="panel-tabs">
        <span class="panel-tab">${tabPair[0]}</span>
        <span class="panel-tab-sep">|</span>
        <span class="panel-tab" style="color:var(--muted)">${tabPair[1]}</span>
       </div>`
    : `<div class="panel-tabs"><span class="panel-tab">${title}</span></div>`;

  return `
    <div class="panel-header">
      <div class="panel-header-left">
        ${titleHtml}
        <p class="panel-subtitle">${subtitle}</p>
      </div>
      <div class="panel-controls">
        <span class="time-range-label">Time Range:</span>
        <div class="tf-group">${tfGroup(panelId)}</div>
      </div>
    </div>`;
}

function panelStatsFooter(chips) {
  return `
    <div class="panel-stats-footer">
      ${chips.map((c) => `
        <div class="stat-chip">
          <span class="stat-chip-label">${c.label}</span>
          <span class="stat-chip-value ${c.cls ?? ""}">${c.value}</span>
        </div>`).join("")}
    </div>`;
}

// ── Top Header ────────────────────────────────────────────────────────────────

function buildTopHeaderHTML(m) {
  const icpVal = m.icpLive ? `$${m.icpLive.toFixed(2)}` : "—";
  const icpCls = state.liveIcpUsd ? "live" : "";
  return `
    <header class="top-header">
      <div class="top-header-logo">
        <div class="logo-icon">M</div>
        <div>
          <div class="logo-title">MGSN Strategy Tracker</div>
          <div class="logo-subtitle">on Internet Computer</div>
        </div>
      </div>
      <nav class="s-nav" style="margin-left:20px;display:flex;align-items:center;gap:2px">
        <a style="padding:5px 10px;border-radius:7px;font-size:0.76rem;font-weight:500;color:var(--mgsn);background:rgba(249,115,22,0.1);text-decoration:none;font-family:'IBM Plex Mono',monospace;letter-spacing:0.03em" href="/">Dashboard</a>
        <a style="padding:5px 10px;border-radius:7px;font-size:0.76rem;font-weight:500;color:var(--muted);text-decoration:none;font-family:'IBM Plex Mono',monospace;letter-spacing:0.03em;transition:background 120ms,color 120ms" href="/strategy.html">Strategy</a>
        <a style="padding:5px 10px;border-radius:7px;font-size:0.76rem;font-weight:500;color:var(--muted);text-decoration:none;font-family:'IBM Plex Mono',monospace;letter-spacing:0.03em;transition:background 120ms,color 120ms" href="/buyback.html">Buyback</a>
        <a style="padding:5px 10px;border-radius:7px;font-size:0.76rem;font-weight:500;color:var(--muted);text-decoration:none;font-family:'IBM Plex Mono',monospace;letter-spacing:0.03em;transition:background 120ms,color 120ms" href="/staking.html">Staking</a>
        <a style="padding:5px 10px;border-radius:7px;font-size:0.76rem;font-weight:500;color:var(--muted);text-decoration:none;font-family:'IBM Plex Mono',monospace;letter-spacing:0.03em;transition:background 120ms,color 120ms" href="/burn.html">Burn</a>
      </nav>
      <div class="top-header-spacer"></div>
      <div class="top-header-badge">
        <div class="live-dot"></div>
        <span class="badge-text">Real-time analytics</span>
      </div>
      <div class="top-header-icp">
        <span class="header-price-label">ICP/USD</span>
        <span class="header-price-val ${icpCls}" id="icp-price-val">${icpVal}</span>
      </div>
      <button class="header-mobile-btn" id="mobile-menu-btn">☰ Charts</button>
    </header>`;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function buildSidebarHTML() {
  const toggles = PANELS.map((p) => `
    <label class="toggle-item">
      <input type="checkbox" data-panel="${p.id}"${state.visible.has(p.id) ? " checked" : ""}>
      <span class="toggle-dot" style="background:${p.dot}"></span>
      ${p.label}
    </label>`).join("");

  return `
    <nav class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-icon">M</div>
        <div>
          <div class="sidebar-logo-name">MGSN Strategy Tracker</div>
          <div class="sidebar-logo-sub">on Internet Computer</div>
        </div>
      </div>

      <div class="sidebar-section">
        <p class="sidebar-section-title">Dashboard Settings</p>
        <div class="toggle-list">${toggles}</div>
      </div>

      <div class="sidebar-section">
        <p class="sidebar-section-title">Quick Actions</p>
        <div class="quick-actions">
          <button class="qa-btn" id="select-all">Select All</button>
          <button class="qa-btn" id="clear-all">Clear All</button>
        </div>
      </div>

      <div class="sidebar-section sidebar-prices">
        <p class="sidebar-section-title">Live Prices</p>
        <div class="price-row">
          <span class="price-symbol">ICP</span>
          <span class="price-val" id="sidebar-icp-val">—</span>
        </div>
        <div class="price-row">
          <span class="price-symbol">BOB</span>
          <span class="price-val sidebar-bob-val">—</span>
        </div>
        <div class="price-row">
          <span class="price-symbol">MGSN</span>
          <span class="price-val sidebar-mgsn-val">—</span>
        </div>
      </div>

      <div class="sidebar-footer">
        <p>Data: ICPSwap · CoinGecko</p>
        <p>ICPSwap TVL: $3.22M · Pairs: 1,951</p>
      </div>
    </nav>
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>`;
}

// ── Main Content ──────────────────────────────────────────────────────────────

function buildMainHTML(dashboard, m) {
  const changeClass = m.unrealisedPct >= 0 ? "positive" : "negative";
  const changeArrow = m.unrealisedPct >= 0 ? "▲" : "▼";
  const pnlSign     = m.unrealisedPct >= 0 ? "+" : "";
  const navPremCls  = m.navPremium >= 0 ? "premium" : "discount";
  const navPremText = m.navPremium >= 0
    ? `+${m.navPremium.toFixed(2)}% premium to NAV`
    : `${m.navPremium.toFixed(2)}% discount to NAV`;

  // Panel 1: Reserve (SaylorTracker's top panel with hero stats)
  const reserveSection = `
    <div class="chart-panel chart-panel--reserve${state.visible.has("reserve") ? "" : " hidden"}" id="panel-reserve" data-panel="reserve">
      ${panelHeader("Token Purchases", "Cumulative MGSN & BOB market capitalization", "reserve",
          ["Token Reserve", "Market Value"])}
      <div class="chart-canvas-wrapper"><canvas id="chart-reserve" width="800" height="340"></canvas></div>
      <p class="drag-hint">Drag the handles or selection area to zoom into different time periods</p>
      <div class="reserve-stats-row">
        <div class="reserve-main-stat">
          <span class="reserve-share-label">MGSN Reserve Value</span>
          <span class="reserve-amount">${compactMoney(m.mgsnCap)}</span>
          <span class="reserve-tokens">◈ ${compact(dashboard.mgsnSupply)} MGSN circulating</span>
        </div>
        <div class="reserve-meta-list">
          <div class="meta-item">
            <span class="meta-label">Avg Cost</span>
            <span class="meta-value">${fmt(m.avgCostMgsn, 4)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Unrealised P&L</span>
            <span class="meta-value ${changeClass}">${changeArrow}${pnlSign}${m.unrealisedPct.toFixed(2)}% (${compactMoney(Math.abs(m.unrealisedUsd))})</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">mNAV</span>
            <span class="meta-value">${m.mNavRatio.toFixed(3)}×
              <span class="nav-pill ${navPremCls}">${navPremText}</span>
            </span>
          </div>
          <div class="meta-item">
            <span class="meta-label">As of</span>
            <span class="meta-date">Apr 5, 2026</span>
          </div>
        </div>
      </div>
    </div>`;

  function cp(id, titleArg, subtitle, chips = [], tabPair = null) {
    return `
      <div class="chart-panel${state.visible.has(id) ? "" : " hidden"}" id="panel-${id}" data-panel="${id}">
        ${panelHeader(titleArg, subtitle, id, tabPair)}
        <div class="chart-canvas-wrapper"><canvas id="chart-${id}" width="800" height="310"></canvas></div>
        ${chips.length ? panelStatsFooter(chips) : ""}
      </div>`;
  }

  const bobChg    = pct(dashboard.timeline[0].bobPrice,  m.last.bobPrice);
  const icpChg    = pct(dashboard.timeline[0].icpPrice,  m.last.icpPrice);

  return `
    <main class="main-content">
      <div class="main-header">
        <div class="main-header-row">
          <div>
            <h2 class="main-title">Financial Charts</h2>
            <p class="main-subtitle">Interactive analysis with individual time controls • Drag on charts to select ranges</p>
          </div>
        </div>
      </div>
      <div class="chart-panels">

        ${reserveSection}

        ${cp("sma", "BOB & MGSN 200-SMA", "Spot prices with long-term moving average overlay", [
          { label: "BOB spot",    value: fmt(m.last.bobPrice,  4), cls: "bob"  },
          { label: "MGSN spot",   value: fmt(m.last.mgsnPrice, 4), cls: "mgsn" },
          { label: "BOB Δ",       value: pctFmt(bobChg),           cls: bobChg  >= 0 ? "pos" : "neg" },
          { label: "MGSN Δ",      value: pctFmt(m.mgsnChange),     cls: m.mgsnChange >= 0 ? "pos" : "neg" },
        ])}

        ${cp("performance", "Performance vs. Benchmarks", "Indexed to 100 at first data point — MGSN · BOB · ICP", [
          { label: "MGSN total return", value: pctFmt(m.mgsnChange), cls: m.mgsnChange >= 0 ? "pos" : "neg" },
          { label: "BOB total return",  value: pctFmt(bobChg),       cls: bobChg  >= 0 ? "pos" : "neg"  },
          { label: "ICP total return",  value: pctFmt(icpChg),       cls: icpChg  >= 0 ? "pos" : "neg"  },
        ])}

        ${cp("yield", "MGSN Yield, Gain & Holdings", "Monthly gain % (bars) · cumulative return · holdings value", [
          { label: "Cumulative return",   value: pctFmt(m.mgsnChange),      cls: m.mgsnChange >= 0 ? "pos" : "neg" },
          { label: "mNAV yield",          value: pctFmt(m.mNavYield),       cls: m.mNavYield  >= 0 ? "pos" : "neg" },
          { label: "Holdings value",      value: compactMoney(m.mgsnCap),   cls: "mgsn" },
        ])}

        ${cp("satstoshare", "ICP per Token", "How many ICP units equal 1 MGSN or 1 BOB token over time", [
          { label: "MGSN/ICP",    value: `${m.mgsnIcp.toFixed(5)} ICP`, cls: "mgsn" },
          { label: "BOB/ICP",     value: `${m.bobIcp.toFixed(5)} ICP`,  cls: "bob"  },
          { label: "Avg MGSN/ICP",value: `${m.avgCostIcp.toFixed(5)} ICP` },
        ])}

        ${cp("nav", "mNAV Analysis", "MGSN market cap vs implied NAV (BOB market cap) — mNAV ratio on right axis", [
          { label: "MGSN mkt cap", value: compactMoney(m.mgsnCap),       cls: "mgsn" },
          { label: "Implied NAV",  value: compactMoney(m.nav),           cls: "bob"  },
          { label: "mNAV ratio",   value: `${m.mNavRatio.toFixed(3)}×`,  cls: "gold" },
          { label: "Premium/Disc", value: `${m.navPremium >= 0 ? "+" : ""}${m.navPremium.toFixed(2)}%`,
            cls: m.navPremium >= 0 ? "pos" : "neg" },
        ])}

        ${cp("cost", "Token Cost in ICP", "MGSN and BOB acquisition cost expressed in ICP units — avg cost line", [
          { label: "MGSN cost",    value: `${m.mgsnIcp.toFixed(6)} ICP`, cls: "mgsn" },
          { label: "BOB cost",     value: `${m.bobIcp.toFixed(6)} ICP`,  cls: "bob"  },
          { label: "Avg cost (ICP)", value: `${m.avgCostIcp.toFixed(6)} ICP` },
          { label: "ICP/USD",      value: `$${m.icpLive.toFixed(2)}`,   cls: state.liveIcpUsd ? "pos" : "" },
        ])}

        ${cp("volatility", "Volatility Comparison", "Rolling 3-period standard deviation · MGSN · BOB · ICP", [
          { label: "Source",    value: "ICPSwap seeded data" },
          { label: "ICP vol",   value: "Benchmark reference", cls: "icp" },
        ])}

        ${cp("volume", "Trading Volume & Liquidity", "Monthly trading volumes · total ICPSwap liquidity depth", [
          { label: "Total liquidity", value: compactMoney(m.totalLiq) },
          { label: "ICPSwap TVL",     value: "$3.22M" },
          { label: "Total pairs",     value: "1,951" },
        ])}

        ${cp("raises", "Token Accumulation", "Cumulative trading volume — proxy for total on-chain accumulation activity", [
          { label: "Cumul. BOB vol",  value: compactMoney(dashboard.timeline.reduce((s, p) => s + p.bobVolume, 0)),  cls: "bob"  },
          { label: "Cumul. MGSN vol", value: compactMoney(dashboard.timeline.reduce((s, p) => s + p.mgsnVolume, 0)), cls: "mgsn" },
        ])}

      </div>
      <div class="page-footer">
        <p>Powered by <a href="https://icpswap.com" target="_blank" rel="noopener noreferrer">ICPSwap</a> · ICP/USD from <a href="https://coingecko.com" target="_blank" rel="noopener noreferrer">CoinGecko</a></p>
        <p style="margin-top:4px">For on-chain analytics, visit <a href="https://dashboard.internetcomputer.org" target="_blank" rel="noopener noreferrer">ICP Dashboard</a></p>
      </div>
    </main>`;
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function attachEvents(app, dashboard) {
  // Sidebar panel toggles
  app.querySelectorAll(".toggle-item input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.panel;
      if (cb.checked) state.visible.add(id); else state.visible.delete(id);
      document.getElementById(`panel-${id}`)?.classList.toggle("hidden", !cb.checked);
    });
  });

  // Select All / Clear All
  app.querySelector("#select-all")?.addEventListener("click", () => {
    PANELS.forEach(({ id }) => {
      state.visible.add(id);
      const el = app.querySelector(`input[data-panel="${id}"]`);
      if (el) el.checked = true;
      document.getElementById(`panel-${id}`)?.classList.remove("hidden");
    });
  });

  app.querySelector("#clear-all")?.addEventListener("click", () => {
    PANELS.forEach(({ id }) => {
      state.visible.delete(id);
      const el = app.querySelector(`input[data-panel="${id}"]`);
      if (el) el.checked = false;
      document.getElementById(`panel-${id}`)?.classList.add("hidden");
    });
  });

  // Time range buttons
  app.addEventListener("click", (e) => {
    const btn = e.target.closest(".tf[data-range]");
    if (!btn) return;
    const { panel, range } = btn.dataset;
    state.panelRanges[panel] = range;
    btn.closest(".tf-group").querySelectorAll(".tf").forEach((b) => {
      b.classList.toggle("active", b.dataset.range === range);
    });
    const series = getSeries(dashboard.timeline, range);
    switch (panel) {
      case "reserve":     renderReserveChart(series); break;
      case "sma":         renderSmaChart(series); break;
      case "performance": renderPerformanceChart(series); break;
      case "yield":       renderYieldChart(series); break;
      case "satstoshare": renderSatsChart(series); break;
      case "nav":         renderNavChart(series, dashboard); break;
      case "cost":        renderCostChart(series); break;
      case "volatility":  renderVolatilityChart(series); break;
      case "volume":      renderVolumeChart(series); break;
      case "raises":      renderRaisesChart(series); break;
    }
  });

  // Mobile sidebar toggle
  const sidebar  = app.querySelector("#sidebar");
  const backdrop = app.querySelector("#sidebar-backdrop");
  app.querySelector("#mobile-menu-btn")?.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    backdrop.classList.toggle("open");
  });
  backdrop?.addEventListener("click", () => {
    sidebar.classList.remove("open");
    backdrop.classList.remove("open");
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function updateSidebarPrices(m) {
  const sidebar = document.querySelector("#sidebar");
  if (!sidebar) return;
  const bobEl  = sidebar.querySelector(".sidebar-bob-val");
  const mgsnEl = sidebar.querySelector(".sidebar-mgsn-val");
  const icpEl  = sidebar.querySelector("#sidebar-icp-val");
  if (icpEl && m.icpLive != null) icpEl.textContent = `$${m.icpLive.toFixed(2)}`;
  if (bobEl)  bobEl.textContent  = fmt(m.last.bobPrice,  4);
  if (mgsnEl) mgsnEl.textContent = fmt(m.last.mgsnPrice, 4);
}

function render(app, dashboard) {
  const m = computeMetrics(dashboard);
  app.innerHTML =
    buildTopHeaderHTML(m) +
    `<div class="page-body">
       ${buildSidebarHTML()}
       ${buildMainHTML(dashboard, m)}
     </div>`;
  attachEvents(app, dashboard);
  updateSidebarPrices(m);
  // Canvas elements are in the DOM with explicit width/height attributes.
  // Call synchronously — no timing hacks needed.
  renderAllCharts(dashboard);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="loading-screen">
      <div class="loading-logo">M</div>
      <span class="loading-text">Loading MGSN Strategy Tracker…</span>
    </div>`;

  // Try the live canister first; fall back to demoDashboard if unavailable.
  // MetricPoint now includes icpPrice so all derived metrics work correctly.
  let dashboard = demoDashboard;
  const actor = createBackendActor();
  if (actor) {
    try {
      const live = await actor.getDashboard();
      // Validate the first timeline entry has icpPrice before switching
      if (live?.timeline?.length && live.timeline[0].icpPrice != null) {
        dashboard = live;
      }
    } catch { /* canister unreachable — fall through to demoDashboard */ }
  }

  try {
    render(app, dashboard);
  } catch (e) {
    app.innerHTML = `<pre style="color:#ef4444;padding:20px;background:#0f1120;font-size:12px;white-space:pre-wrap">${e}</pre>`;
    return;
  }

  // Non-blocking live ICP price (CSP allows 'self' only — fetch may be blocked;
  // the catch inside fetchLiveSpotPrices handles that gracefully)
  fetchLiveSpotPrices().then(({ icpUsd }) => {
    if (icpUsd) {
      state.liveIcpUsd = icpUsd;
      document.querySelectorAll("#icp-price-val, #sidebar-icp-val").forEach((el) => {
        el.textContent = `$${icpUsd.toFixed(2)}`;
        el.classList.add("live");
      });
    }
  });

  // Poll every 60 s
  setInterval(async () => {
    const { icpUsd } = await fetchLiveSpotPrices();
    if (icpUsd) {
      state.liveIcpUsd = icpUsd;
      document.querySelectorAll("#icp-price-val, #sidebar-icp-val").forEach((el) => {
        el.textContent = `$${icpUsd.toFixed(2)}`;
        el.classList.add("live");
      });
    }
  }, 60_000);
}

bootstrap();
