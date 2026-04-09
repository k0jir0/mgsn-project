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

import { fetchDashboardData } from "./liveData";
import {
  createUnavailableDashboard,
  getDashboardFirstPoint,
  getDashboardLastPoint,
  hasDashboardHistory,
} from "./liveDefaults.js";
import { buildPlatformHeaderHTML } from "./siteChrome.js";
import {
  applyScenarioToDashboard,
  attachScenarioStudio,
  buildDashboardSourceChips,
  buildScenarioHeaderHTML,
  loadScenarioState,
  readViewCache,
  writeViewCache,
} from "./siteState.js";

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
  mobileUiCleanup: null,
};

const charts = {};
const DASHBOARD_CACHE_KEY = "dashboard-live-v1";

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
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: d, maximumFractionDigits: d,
  }).format(v);
}

function fmtTokenUsd(v, threshold = 0.001, tinyDigits = 7, normalDigits = 4) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return fmt(v, Math.abs(v) < threshold ? tinyDigits : normalDigits);
}

function compact(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact", maximumFractionDigits: 2,
  }).format(v);
}

function compactMoney(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    notation: "compact", maximumFractionDigits: 2,
  }).format(v);
}

function fmtMaybeMoney(v, fallback = "—") {
  return v == null ? fallback : compactMoney(v);
}

function pct(start, end) {
  if (
    typeof start !== "number" ||
    !Number.isFinite(start) ||
    typeof end !== "number" ||
    !Number.isFinite(end) ||
    start === 0
  ) {
    return null;
  }
  return ((end - start) / start) * 100;
}

function pctFmt(v, decimals = 1) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)}%`;
}

function safeMultiply(left, right) {
  return typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right)
    ? left * right
    : null;
}

function averageNumbers(values) {
  const valid = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function formatUpdatedAt(updatedAt) {
  if (updatedAt == null) return "—";
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
    return "—";
  }
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

function renderChartMessage(canvas, width, height, message) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (charts[canvas.id.replace("chart-", "")]) {
    charts[canvas.id.replace("chart-", "")].destroy();
    delete charts[canvas.id.replace("chart-", "")];
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#101423";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#1a1f3a";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.fillStyle = "#5a6a8a";
  ctx.font = "12px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2 - 8);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px 'IBM Plex Mono', monospace";
  ctx.fillText("No bundled snapshot is rendered in live-only mode.", width / 2, height / 2 + 14);
}

// ── Chart builders ─────────────────────────────────────────────────────────────

// Panel 1 — Token Purchases (SaylorTracker: Bitcoin Reserve with Cash Reserve tab)
// We show cumulative MGSN market cap (filled) and BOB market cap (line)
function renderReserveChart(series, dashboard) {
  const labels = series.map((p) => p.period.split(" ")[0]);
  const mgsnCap = series.map((p) => safeMultiply(p.mgsnPrice, dashboard.mgsnSupply));
  const bobCap  = series.map((p) => safeMultiply(p.bobPrice, dashboard.bobSupply));
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
function renderYieldChart(series, dashboard) {
  const labels   = series.map((p) => p.period.split(" ")[0]);
  const monthGain = series.map((p, i) =>
    i === 0 ? 0 : pct(series[i - 1].mgsnPrice, p.mgsnPrice));
  const cumulative = series.map((p) => pct(series[0].mgsnPrice, p.mgsnPrice));
  const holdings   = series.map((p) => safeMultiply(p.mgsnPrice, dashboard.mgsnSupply));

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
  opts.plugins.tooltip.callbacks.label = (ctx) => {
    if (ctx.dataset.yAxisID === "y2") return ` ${ctx.dataset.label}: ${compactMoney(ctx.raw)}`;
    return ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%`;
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
  opts2.plugins.tooltip.callbacks.label = (ctx) => {
    if (ctx.dataset.yAxisID === "y2") return ` ${ctx.dataset.label}: ${ctx.raw.toFixed(3)}×`;
    return ` ${ctx.dataset.label}: ${compactMoney(ctx.raw)}`;
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
  const liquidity = series.map((p) => {
    const bob = Number.isFinite(p.bobLiquidity) ? p.bobLiquidity : null;
    const mgsn = Number.isFinite(p.mgsnLiquidity) ? p.mgsnLiquidity : null;
    if (bob == null && mgsn == null) return null;
    return (bob ?? 0) + (mgsn ?? 0);
  });
  const hasLiquidity = liquidity.some((v) => v != null);
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
  opts.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.dataset.label}: ${compactMoney(ctx.raw)}`;
  mkChart("volume", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { type: "bar",  label: "BOB volume",      data: series.map((p) => p.bobVolume),
          backgroundColor: "rgba(59,130,246,0.5)", borderRadius: 3, yAxisID: "y" },
        { type: "bar",  label: "MGSN volume",     data: series.map((p) => p.mgsnVolume),
          backgroundColor: "rgba(249,115,22,0.5)", borderRadius: 3, yAxisID: "y" },
        ...(hasLiquidity
          ? [{ type: "line", label: "Total liquidity", data: liquidity,
              borderColor: C.pos, borderWidth: 2, pointRadius: 0, tension: 0.35, yAxisID: "y2" }]
          : []),
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
  const hasHistory = hasDashboardHistory(dashboard);

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

    if (!hasHistory) {
      renderChartMessage(canvas, w, h, "Live market history unavailable");
      return;
    }

    try {
      const series = getSeries(dashboard.timeline, state.panelRanges[id]);
      if (!series.length) {
        renderChartMessage(canvas, w, h, "Live market history unavailable");
        return;
      }
      switch (id) {
        case "reserve":     renderReserveChart(series, dashboard); break;
        case "sma":         renderSmaChart(series); break;
        case "performance": renderPerformanceChart(series); break;
        case "yield":       renderYieldChart(series, dashboard); break;
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
  const tl = Array.isArray(dashboard.timeline) ? dashboard.timeline : [];
  const last = getDashboardLastPoint(dashboard);
  const first = getDashboardFirstPoint(dashboard);
  const mgsnCap = safeMultiply(last?.mgsnPrice, dashboard.mgsnSupply);
  const bobCap = safeMultiply(last?.bobPrice, dashboard.bobSupply);
  const nav = bobCap;
  const mNavRatio = typeof nav === "number" && nav > 0 && typeof mgsnCap === "number"
    ? mgsnCap / nav
    : null;
  const navPremium = typeof mNavRatio === "number" ? (mNavRatio - 1) * 100 : null;

  const mgsnChange = pct(first?.mgsnPrice, last?.mgsnPrice);
  const bobChange = pct(first?.bobPrice, last?.bobPrice);
  const icpChange = pct(first?.icpPrice, last?.icpPrice);

  const avgCostMgsn = averageNumbers(tl.map((point) => point.mgsnPrice));
  const avgCostIcp = averageNumbers(
    tl
      .map((point) => (
        typeof point.mgsnPrice === "number" &&
        Number.isFinite(point.mgsnPrice) &&
        typeof point.icpPrice === "number" &&
        Number.isFinite(point.icpPrice) &&
        point.icpPrice > 0
          ? point.mgsnPrice / point.icpPrice
          : null
      ))
      .filter((value) => value != null)
  );
  const unrealisedUsd =
    typeof last?.mgsnPrice === "number" &&
    Number.isFinite(last.mgsnPrice) &&
    typeof avgCostMgsn === "number" &&
    Number.isFinite(avgCostMgsn) &&
    typeof dashboard.mgsnSupply === "number" &&
    Number.isFinite(dashboard.mgsnSupply)
      ? (last.mgsnPrice - avgCostMgsn) * dashboard.mgsnSupply
      : null;
  const unrealisedPct = pct(avgCostMgsn, last?.mgsnPrice);

  const liqParts = [last?.bobLiquidity, last?.mgsnLiquidity]
    .filter((value) => Number.isFinite(value));
  const fallbackLiq = liqParts.length
    ? liqParts.reduce((sum, value) => sum + value, 0)
    : null;
  const icpLive = state.liveIcpUsd ?? last?.icpPrice ?? null;

  const firstNav = safeMultiply(first?.bobPrice, dashboard.bobSupply);
  const firstMgsnCap = safeMultiply(first?.mgsnPrice, dashboard.mgsnSupply);
  const firstMNav =
    typeof firstNav === "number" && firstNav > 0 && typeof firstMgsnCap === "number"
      ? firstMgsnCap / firstNav
      : null;
  const mNavYield = pct(firstMNav, mNavRatio);

  const mgsnIcp =
    typeof last?.mgsnPrice === "number" &&
    Number.isFinite(last.mgsnPrice) &&
    typeof last?.icpPrice === "number" &&
    Number.isFinite(last.icpPrice) &&
    last.icpPrice > 0
      ? last.mgsnPrice / last.icpPrice
      : null;
  const bobIcp =
    typeof last?.bobPrice === "number" &&
    Number.isFinite(last.bobPrice) &&
    typeof last?.icpPrice === "number" &&
    Number.isFinite(last.icpPrice) &&
    last.icpPrice > 0
      ? last.bobPrice / last.icpPrice
      : null;

  return {
    hasHistory: tl.length > 0,
    last: last ?? { bobPrice: null, mgsnPrice: null, icpPrice: null },
    mgsnCap, bobCap, nav, mNavRatio, navPremium,
    mgsnChange, bobChange, icpChange,
    avgCostMgsn, avgCostIcp, unrealisedUsd, unrealisedPct,
    totalLiq: dashboard.marketStats?.totalLiquidityUsd ?? fallbackLiq, icpLive,
    mNavYield, mgsnIcp, bobIcp,
    asOf: formatUpdatedAt(dashboard.updatedAt),
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

// ── Sidebar ───────────────────────────────────────────────────────────────────

function isHydratingDashboard(hydrationMode) {
  return hydrationMode === "loading" || hydrationMode === "cached";
}

function buildSidebarHTML(dashboard, hydrationMode = "live") {
  const hydratingLive = isHydratingDashboard(hydrationMode);
  const toggles = PANELS.map((p) => `
    <label class="toggle-item">
      <input type="checkbox" data-panel="${p.id}"${state.visible.has(p.id) ? " checked" : ""}>
      <span class="toggle-dot" style="background:${p.dot}"></span>
      ${p.label}
    </label>`).join("");
  const historyLine = dashboard.marketStats?.historyStartLabel
    ? `History: ${dashboard.marketStats.historyStartLabel} - ${dashboard.marketStats.historyEndLabel}`
    : hydratingLive
      ? "History: loading ICPSwap history..."
      : "History: live feed unavailable";
  const statsLine = dashboard.marketStats?.mgsnVol24h != null || dashboard.marketStats?.bobVol24h != null
    ? `24h volume: BOB ${fmtMaybeMoney(dashboard.marketStats?.bobVol24h)} · MGSN ${fmtMaybeMoney(dashboard.marketStats?.mgsnVol24h)}`
    : hydratingLive
      ? "Refreshing live token stats..."
      : "Live token stats unavailable";

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
        <p>Data: ICPSwap canisters + official info API</p>
        <p>${historyLine}</p>
        <p>${statsLine}</p>
      </div>
    </nav>
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>`;
}

// ── Main Content ──────────────────────────────────────────────────────────────

function buildMainHTML(dashboard, m, scenarioHeaderHtml, hydrationMode = "live") {
  const hydratingLive = isHydratingDashboard(hydrationMode);
  const hasUnrealised = typeof m.unrealisedPct === "number" && Number.isFinite(m.unrealisedPct);
  const changeClass = !hasUnrealised ? "" : m.unrealisedPct >= 0 ? "positive" : "negative";
  const changeArrow = !hasUnrealised ? "" : m.unrealisedPct >= 0 ? "▲" : "▼";
  const pnlSign = !hasUnrealised ? "" : m.unrealisedPct >= 0 ? "+" : "";
  const hasNavPremium = typeof m.navPremium === "number" && Number.isFinite(m.navPremium);
  const navPremCls = !hasNavPremium ? "" : m.navPremium >= 0 ? "premium" : "discount";
  const navPremText = !hasNavPremium
    ? "NAV unavailable"
    : m.navPremium >= 0
      ? `+${m.navPremium.toFixed(2)}% premium to NAV`
      : `${m.navPremium.toFixed(2)}% discount to NAV`;

  const historySummary = dashboard.marketStats?.historyStartLabel
    ? `${dashboard.marketStats.historyStartLabel} - ${dashboard.marketStats.historyEndLabel} monthly closes + live spot`
    : hydratingLive
      ? "Loading ICPSwap history and live spot..."
      : "Live market history unavailable";
  const volatilitySource = dashboard.marketStats?.historyStartLabel
    ? "ICPSwap monthly OHLC history"
    : hydratingLive
      ? "Loading live ICPSwap history"
      : "Live market history unavailable";
  const volumeChips = [
    { label: "BOB 24h vol", value: fmtMaybeMoney(dashboard.marketStats?.bobVol24h), cls: "bob" },
    { label: "MGSN 24h vol", value: fmtMaybeMoney(dashboard.marketStats?.mgsnVol24h), cls: "mgsn" },
    { label: "MGSN 30d vol", value: fmtMaybeMoney(dashboard.marketStats?.mgsnVol30d) },
    { label: "Liquidity", value: fmtMaybeMoney(m.totalLiq, "Unavailable") },
  ];

  // Panel 1: Reserve (SaylorTracker's top panel with hero stats)
  const reserveSection = `
    <div class="chart-panel chart-panel--reserve${state.visible.has("reserve") ? "" : " hidden"}" id="panel-reserve" data-panel="reserve">
      ${panelHeader("Token Purchases", "Cumulative MGSN & BOB market capitalization", "reserve",
          ["Token Reserve", "Market Value"])}
      <div class="chart-canvas-wrapper"><canvas id="chart-reserve" width="800" height="340"></canvas></div>
      <div class="reserve-stats-row">
        <div class="reserve-main-stat">
          <span class="reserve-share-label">MGSN Reserve Value</span>
          <span class="reserve-amount">${compactMoney(m.mgsnCap)}</span>
          <span class="reserve-tokens">${dashboard.mgsnSupply != null ? `◈ ${compact(dashboard.mgsnSupply)} MGSN circulating` : "Circulating supply unavailable"}</span>
        </div>
        <div class="reserve-meta-list">
          <div class="meta-item">
            <span class="meta-label">Avg Cost</span>
            <span class="meta-value">${fmtTokenUsd(m.avgCostMgsn)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Unrealised P&L</span>
            <span class="meta-value ${changeClass}">${hasUnrealised ? `${changeArrow}${pnlSign}${m.unrealisedPct.toFixed(2)}% (${compactMoney(Math.abs(m.unrealisedUsd))})` : "Unavailable"}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">mNAV</span>
            <span class="meta-value">${typeof m.mNavRatio === "number" && Number.isFinite(m.mNavRatio) ? `${m.mNavRatio.toFixed(3)}×` : "Unavailable"}
              <span class="nav-pill ${navPremCls}">${navPremText}</span>
            </span>
          </div>
          <div class="meta-item">
            <span class="meta-label">As of</span>
            <span class="meta-date">${m.asOf}</span>
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

  const firstPoint = getDashboardFirstPoint(dashboard);
  const bobChg = pct(firstPoint?.bobPrice, m.last.bobPrice);
  const icpChg = pct(firstPoint?.icpPrice, m.last.icpPrice);

  return `
    <main class="main-content">
      <div class="main-header">
        <div class="main-header-row">
          <div>
            <h2 class="main-title">Financial Charts</h2>
            <p class="main-subtitle">Interactive analysis with individual time controls • ${historySummary}</p>
          </div>
        </div>
      </div>
      <div class="chart-panels">
        ${scenarioHeaderHtml}

        ${reserveSection}

        ${cp("sma", "BOB & MGSN 200-SMA", "Spot prices with long-term moving average overlay", [
          { label: "BOB spot",    value: fmt(m.last.bobPrice,  4), cls: "bob"  },
          { label: "MGSN spot",   value: fmtTokenUsd(m.last.mgsnPrice), cls: "mgsn" },
          { label: "BOB Δ",       value: pctFmt(bobChg),           cls: typeof bobChg === "number" && bobChg >= 0 ? "pos" : typeof bobChg === "number" ? "neg" : "" },
          { label: "MGSN Δ",      value: pctFmt(m.mgsnChange),     cls: typeof m.mgsnChange === "number" && m.mgsnChange >= 0 ? "pos" : typeof m.mgsnChange === "number" ? "neg" : "" },
        ])}

        ${cp("performance", "Performance vs. Benchmarks", "Indexed to 100 at first data point — MGSN · BOB · ICP", [
          { label: "MGSN total return", value: pctFmt(m.mgsnChange), cls: typeof m.mgsnChange === "number" && m.mgsnChange >= 0 ? "pos" : typeof m.mgsnChange === "number" ? "neg" : "" },
          { label: "BOB total return",  value: pctFmt(bobChg),       cls: typeof bobChg === "number" && bobChg >= 0 ? "pos" : typeof bobChg === "number" ? "neg" : "" },
          { label: "ICP total return",  value: pctFmt(icpChg),       cls: typeof icpChg === "number" && icpChg >= 0 ? "pos" : typeof icpChg === "number" ? "neg" : "" },
        ])}

        ${cp("yield", "MGSN Yield, Gain & Holdings", "Monthly gain % (bars) · cumulative return · holdings value", [
          { label: "Cumulative return",   value: pctFmt(m.mgsnChange),      cls: typeof m.mgsnChange === "number" && m.mgsnChange >= 0 ? "pos" : typeof m.mgsnChange === "number" ? "neg" : "" },
          { label: "mNAV yield",          value: pctFmt(m.mNavYield),       cls: typeof m.mNavYield === "number" && m.mNavYield >= 0 ? "pos" : typeof m.mNavYield === "number" ? "neg" : "" },
          { label: "Holdings value",      value: compactMoney(m.mgsnCap),   cls: "mgsn" },
        ])}

        ${cp("satstoshare", "ICP per Token", "How many ICP units equal 1 MGSN or 1 BOB token over time", [
          { label: "MGSN/ICP",    value: typeof m.mgsnIcp === "number" && Number.isFinite(m.mgsnIcp) ? `${m.mgsnIcp.toFixed(5)} ICP` : "—", cls: "mgsn" },
          { label: "BOB/ICP",     value: typeof m.bobIcp === "number" && Number.isFinite(m.bobIcp) ? `${m.bobIcp.toFixed(5)} ICP` : "—",  cls: "bob"  },
          { label: "Avg MGSN/ICP",value: typeof m.avgCostIcp === "number" && Number.isFinite(m.avgCostIcp) ? `${m.avgCostIcp.toFixed(5)} ICP` : "—" },
        ])}

        ${cp("nav", "mNAV Analysis", "MGSN market cap vs implied NAV (BOB market cap) — mNAV ratio on right axis", [
          { label: "MGSN mkt cap", value: compactMoney(m.mgsnCap),       cls: "mgsn" },
          { label: "Implied NAV",  value: compactMoney(m.nav),           cls: "bob"  },
          { label: "mNAV ratio",   value: typeof m.mNavRatio === "number" && Number.isFinite(m.mNavRatio) ? `${m.mNavRatio.toFixed(3)}×` : "—",  cls: "gold" },
          { label: "Premium/Disc", value: typeof m.navPremium === "number" && Number.isFinite(m.navPremium) ? `${m.navPremium >= 0 ? "+" : ""}${m.navPremium.toFixed(2)}%` : "—",
            cls: typeof m.navPremium === "number" && m.navPremium >= 0 ? "pos" : typeof m.navPremium === "number" ? "neg" : "" },
        ])}

        ${cp("cost", "Token Cost in ICP", "MGSN and BOB acquisition cost expressed in ICP units — avg cost line", [
          { label: "MGSN cost",    value: typeof m.mgsnIcp === "number" && Number.isFinite(m.mgsnIcp) ? `${m.mgsnIcp.toFixed(6)} ICP` : "—", cls: "mgsn" },
          { label: "BOB cost",     value: typeof m.bobIcp === "number" && Number.isFinite(m.bobIcp) ? `${m.bobIcp.toFixed(6)} ICP` : "—",  cls: "bob"  },
          { label: "Avg cost (ICP)", value: typeof m.avgCostIcp === "number" && Number.isFinite(m.avgCostIcp) ? `${m.avgCostIcp.toFixed(6)} ICP` : "—" },
          { label: "ICP/USD",      value: typeof m.icpLive === "number" && Number.isFinite(m.icpLive) ? `$${m.icpLive.toFixed(2)}` : "—",   cls: state.liveIcpUsd ? "pos" : "" },
        ])}

        ${cp("volatility", "Volatility Comparison", "Rolling 3-period standard deviation · MGSN · BOB · ICP", [
          { label: "Source",    value: volatilitySource },
          { label: "ICP vol",   value: "Benchmark reference", cls: "icp" },
        ])}

        ${cp("volume", "Trading Volume & Liquidity", "Monthly on-chain volume history with current ICPSwap token-volume snapshots", volumeChips)}

        ${cp("raises", "Token Accumulation", "Cumulative trading volume — proxy for total on-chain accumulation activity", [
          { label: "Cumul. BOB vol",  value: compactMoney(dashboard.timeline.reduce((s, p) => s + p.bobVolume, 0)),  cls: "bob"  },
          { label: "Cumul. MGSN vol", value: compactMoney(dashboard.timeline.reduce((s, p) => s + p.mgsnVolume, 0)), cls: "mgsn" },
        ])}

      </div>
      <div class="page-footer">
        <p>Powered by <a href="https://icpswap.com" target="_blank" rel="noopener noreferrer">ICPSwap</a> · Spot and pool stats from the official ICPSwap data API</p>
        <p style="margin-top:4px">For on-chain analytics, visit <a href="https://dashboard.internetcomputer.org" target="_blank" rel="noopener noreferrer">ICP Dashboard</a></p>
      </div>
    </main>`;
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function attachEvents(app, dashboard) {
  state.mobileUiCleanup?.();
  state.mobileUiCleanup = null;

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

  const setSidebarOpen = (open) => {
    if (!sidebar || !backdrop) return;
    sidebar.classList.toggle("open", open);
    backdrop.classList.toggle("open", open);
    document.body.classList.toggle("sidebar-open", open);
    mobileBtn?.setAttribute("aria-expanded", String(open));
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
  };

  const mobileBtn = app.querySelector("#mobile-menu-btn");
  mobileBtn?.setAttribute("aria-expanded", "false");
  mobileBtn?.addEventListener("click", () => {
    const nextOpen = !sidebar?.classList.contains("open");
    setSidebarOpen(nextOpen);
  });

  backdrop?.addEventListener("click", closeSidebar);

  const handleKeydown = (event) => {
    if (event.key === "Escape") {
      closeSidebar();
    }
  };

  const handleResize = () => {
    if (window.innerWidth > 900) {
      closeSidebar();
    }
  };

  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", handleResize);

  state.mobileUiCleanup = () => {
    sidebar.classList.remove("open");
    backdrop.classList.remove("open");
    document.body.classList.remove("sidebar-open");
    window.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("resize", handleResize);
  };
}

// ── Render ────────────────────────────────────────────────────────────────────

function updateSidebarPrices(m) {
  const sidebar = document.querySelector("#sidebar");
  if (!sidebar) return;
  const bobEl  = sidebar.querySelector(".sidebar-bob-val");
  const mgsnEl = sidebar.querySelector(".sidebar-mgsn-val");
  const icpEl  = sidebar.querySelector("#sidebar-icp-val");
  if (icpEl) icpEl.textContent = typeof m.icpLive === "number" && Number.isFinite(m.icpLive) ? `$${m.icpLive.toFixed(2)}` : "—";
  if (bobEl)  bobEl.textContent  = fmt(m.last.bobPrice,  4);
  if (mgsnEl) mgsnEl.textContent = fmtTokenUsd(m.last.mgsnPrice);
}

function render(app, dashboard, hydrationMode = "live") {
  state.mobileUiCleanup?.();
  state.mobileUiCleanup = null;
  const scenario = loadScenarioState();
  const displayDashboard = applyScenarioToDashboard(dashboard, scenario);
  const m = computeMetrics(displayDashboard);
  state.liveIcpUsd = m.icpLive ?? state.liveIcpUsd;
  app.innerHTML =
    buildPlatformHeaderHTML({
      activePage: "dashboard",
      badgeText: "Real-time analytics",
      priceLabel: "ICP/USD",
      priceValue: m.icpLive ? `$${m.icpLive.toFixed(2)}` : "—",
      priceId: "icp-price-val",
      priceClass: state.liveIcpUsd ? "live" : "",
      mobileActions: [{ id: "mobile-menu-btn", label: "Charts", ariaExpanded: false }],
    }) +
    `<div class="page-body">
       ${buildSidebarHTML(displayDashboard, hydrationMode)}
       ${buildMainHTML(
         displayDashboard,
         m,
         buildScenarioHeaderHTML(
           "dashboard",
           buildDashboardSourceChips(displayDashboard, scenario, hydrationMode)
         ),
         hydrationMode
       )}
     </div>`;
  attachEvents(app, displayDashboard);
  attachScenarioStudio(app, (action) => {
    if (action?.type === "refresh" || action?.type === "clear-cache") {
      window.location.reload();
      return;
    }
    render(app, dashboard, hydrationMode);
  });
  updateSidebarPrices(m);
  // Canvas elements are in the DOM with explicit width/height attributes.
  // Call synchronously — no timing hacks needed.
  renderAllCharts(displayDashboard);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  const app = document.querySelector("#app");
  const cachedDashboard = readViewCache(DASHBOARD_CACHE_KEY);
  let dashboard = cachedDashboard ?? createUnavailableDashboard();
  if (dashboard.marketStats?.icpSpotLive) {
    state.liveIcpUsd = dashboard.timeline.at(-1)?.icpPrice ?? null;
  }

  try {
    render(app, dashboard, cachedDashboard ? "cached" : "loading");
  } catch (e) {
    app.innerHTML = `<pre style="color:#ef4444;padding:20px;background:#0f1120;font-size:12px;white-space:pre-wrap">${e}</pre>`;
    return;
  }

  const liveDashboard = await fetchDashboardData();
  if (liveDashboard) {
    dashboard = liveDashboard;
    writeViewCache(DASHBOARD_CACHE_KEY, dashboard);
    state.liveIcpUsd = dashboard.marketStats?.icpSpotLive
      ? dashboard.timeline.at(-1)?.icpPrice ?? state.liveIcpUsd
      : state.liveIcpUsd;
    render(app, dashboard, "live");
  } else if (!cachedDashboard) {
    render(app, dashboard, "fallback");
  }

  setInterval(async () => {
    const nextDashboard = await fetchDashboardData(true);
    if (nextDashboard) {
      writeViewCache(DASHBOARD_CACHE_KEY, nextDashboard);
      state.liveIcpUsd = nextDashboard.marketStats?.icpSpotLive
        ? nextDashboard.timeline.at(-1)?.icpPrice ?? state.liveIcpUsd
        : state.liveIcpUsd;
      render(app, nextDashboard, "live");
    }
  }, 60_000);
}

bootstrap();
