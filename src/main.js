import "./styles.css";
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";

import { createBackendActor } from "./actor";
import { demoDashboard } from "./demoData";
import { fetchLiveSpotPrices } from "./liveData";

Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
  Legend,
);

// â”€â”€ Palette â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const C = {
  mgsn:     "#f97316",
  mgsnFill: "rgba(249,115,22,0.12)",
  bob:      "#3b82f6",
  bobFill:  "rgba(59,130,246,0.12)",
  icp:      "#8b5cf6",
  icpFill:  "rgba(139,92,246,0.1)",
  ma:       "rgba(249,115,22,0.45)",
  maB:      "rgba(59,130,246,0.45)",
  grid:     "#1e2447",
  tick:     "#64748b",
  tooltip: {
    bg:     "#13172e",
    border: "#2d3561",
    title:  "#f1f5f9",
    body:   "#94a3b8",
  },
};

// â”€â”€ Chart panel registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const PANELS = [
  { id: "reserve",     label: "MGSN Reserve",            dot: C.mgsn },
  { id: "sma",         label: "BOB & MGSN 200-SMA",      dot: C.mgsn },
  { id: "performance", label: "Performance vs. ICP",      dot: C.icp  },
  { id: "yield",       label: "MGSN Yield & Gain",        dot: C.mgsn },
  { id: "ratio",       label: "BOB-per-MGSN",             dot: C.bob  },
  { id: "nav",         label: "Market Cap / NAV",          dot: C.mgsn },
  { id: "cost",        label: "Token Cost in ICP",         dot: C.bob  },
  { id: "volatility",  label: "Volatility Comparison",    dot: C.icp  },
  { id: "volume",      label: "Volume & Liquidity",        dot: C.bob  },
];

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const state = {
  panelRanges: Object.fromEntries(PANELS.map((p) => [p.id, "all"])),
  visible:     new Set(PANELS.map((p) => p.id)),
  liveIcpUsd:  null,
};

const charts = {};

// â”€â”€ Math helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Shared Chart.js options factory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function baseOpts(yTickFmt = (v) => v) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 380 },
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
        grid:  { color: C.grid, lineWidth: 0.6 },
        ticks: { color: C.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 }, maxRotation: 0 },
        border: { color: C.grid },
      },
      y: {
        grid:  { color: C.grid, lineWidth: 0.6 },
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

// â”€â”€ Chart builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        { label: "MGSN Market Cap", data: mgsnCap, borderColor: C.mgsn, borderWidth: 2.5, pointRadius: 0, fill: true, backgroundColor: C.mgsnFill, tension: 0.4 },
        { label: "BOB Market Cap",  data: bobCap,  borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, fill: false, tension: 0.4 },
      ],
    },
    options: opts,
  });
}

function renderSmaChart(series) {
  const labels = series.map((p) => p.period.split(" ")[0]);
  const bob   = series.map((p) => p.bobPrice);
  const mgsn  = series.map((p) => p.mgsnPrice);
  const bobMA = sma(bob,  3);
  const mgsnMA= sma(mgsn, 3);
  const opts  = baseOpts((v) => fmt(v, 3));
  opts.plugins.tooltip.callbacks.label = (ctx) =>
    ctx.raw !== null ? ` ${ctx.dataset.label}: ${fmt(ctx.raw, 4)}` : null;
  mkChart("sma", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "BOB",      data: bob,   borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.4 },
        { label: "MGSN",     data: mgsn,  borderColor: C.mgsn, borderWidth: 2,   pointRadius: 0, tension: 0.4 },
        { label: "BOB 3-SMA",  data: bobMA,  borderColor: C.maB,  borderWidth: 1.5, pointRadius: 0, borderDash: [5, 3], tension: 0.4, spanGaps: true },
        { label: "MGSN 3-SMA", data: mgsnMA, borderColor: C.ma,   borderWidth: 1.5, pointRadius: 0, borderDash: [5, 3], tension: 0.4, spanGaps: true },
      ],
    },
    options: opts,
  });
}

function renderPerformanceChart(series) {
  const labels = series.map((p) => p.period.split(" ")[0]);
  const base = (arr, field) => arr.map((p) => (p[field] / arr[0][field]) * 100);
  const mgsnPerf = base(series, "mgsnPrice");
  const bobPerf  = base(series, "bobPrice");
  const icpPerf  = base(series, "icpPrice");
  const opts = baseOpts((v) => `${v.toFixed(0)}%`);
  opts.plugins.tooltip.callbacks.label = (ctx) =>
    ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%`;
  mkChart("performance", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "MGSN", data: mgsnPerf, borderColor: C.mgsn, borderWidth: 2.5, pointRadius: 0, tension: 0.4 },
        { label: "BOB",  data: bobPerf,  borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.4 },
        { label: "ICP",  data: icpPerf,  borderColor: C.icp,  borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3], tension: 0.4 },
      ],
    },
    options: opts,
  });
}

function renderYieldChart(series) {
  const labels = series.map((p) => p.period.split(" ")[0]);
  const monthGain = series.map((p, i) =>
    i === 0 ? 0 : pct(series[i - 1].mgsnPrice, p.mgsnPrice)
  );
  const cumulative = series.map((p) => pct(series[0].mgsnPrice, p.mgsnPrice));
  const opts = {
    ...baseOpts(),
    scales: {
      x: baseOpts().scales.x,
      y: { ...baseOpts().scales.y, ticks: { ...baseOpts().scales.y.ticks, callback: (v) => `${v.toFixed(0)}%` } },
      y2: {
        position: "right",
        grid: { display: false },
        ticks: { color: C.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 }, callback: (v) => `${v.toFixed(0)}%` },
        border: { color: C.grid },
      },
    },
  };
  mkChart("yield", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { type: "bar",  label: "Monthly Gain %", data: monthGain, backgroundColor: monthGain.map((v) => v >= 0 ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)"), borderRadius: 4, yAxisID: "y" },
        { type: "line", label: "Cumulative %",   data: cumulative, borderColor: C.mgsn, borderWidth: 2, pointRadius: 0, tension: 0.4, fill: false, yAxisID: "y2" },
      ],
    },
    options: opts,
  });
}

function renderRatioChart(series) {
  const labels = series.map((p) => p.period.split(" ")[0]);
  const ratio  = series.map((p) => p.bobPrice / p.mgsnPrice);
  const opts   = baseOpts((v) => `${v.toFixed(1)}x`);
  opts.plugins.tooltip.callbacks.label = (ctx) => ` BOB-per-MGSN: ${ctx.raw.toFixed(2)}x`;
  mkChart("ratio", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "BOB per MGSN", data: ratio, borderColor: C.bob, borderWidth: 2.5, pointRadius: 0, fill: true, backgroundColor: C.bobFill, tension: 0.4 },
      ],
    },
    options: opts,
  });
}

function renderNavChart(series, dashboard) {
  const labels   = series.map((p) => p.period.split(" ")[0]);
  const mgsnCap  = series.map((p) => p.mgsnPrice * dashboard.mgsnSupply);
  const bobCap   = series.map((p) => p.bobPrice  * dashboard.bobSupply);
  const navRatio = mgsnCap.map((m, i) => (bobCap[i] > 0 ? m / bobCap[i] : 0));
  const opts2    = {
    ...baseOpts(),
    scales: {
      x: baseOpts().scales.x,
      y: { ...baseOpts().scales.y, ticks: { ...baseOpts().scales.y.ticks, callback: (v) => compactMoney(v) } },
      y2: {
        position: "right",
        grid: { display: false },
        ticks: { color: C.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 }, callback: (v) => `${v.toFixed(2)}Ã—` },
        border: { color: C.grid },
      },
    },
  };
  mkChart("nav", {
    type: "line",
    data: {
      labels,
      datasets: [
        { type: "line", label: "MGSN Mkt Cap", data: mgsnCap, borderColor: C.mgsn, borderWidth: 2.5, pointRadius: 0, fill: true, backgroundColor: C.mgsnFill, tension: 0.4, yAxisID: "y" },
        { type: "line", label: "BOB Mkt Cap",  data: bobCap,  borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.4, yAxisID: "y" },
        { type: "line", label: "NAV Ratio",    data: navRatio,borderColor: "rgba(139,92,246,0.7)", borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3], tension: 0.4, yAxisID: "y2" },
      ],
    },
    options: opts2,
  });
}

function renderCostChart(series) {
  const labels   = series.map((p) => p.period.split(" ")[0]);
  const mgsnIcp  = series.map((p) => p.mgsnPrice / p.icpPrice);
  const bobIcp   = series.map((p) => p.bobPrice  / p.icpPrice);
  const opts     = baseOpts((v) => `${v.toFixed(4)} ICP`);
  opts.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(6)} ICP`;
  mkChart("cost", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "MGSN/ICP", data: mgsnIcp, borderColor: C.mgsn, borderWidth: 2.5, pointRadius: 0, tension: 0.4 },
        { label: "BOB/ICP",  data: bobIcp,  borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.4 },
      ],
    },
    options: opts,
  });
}

function renderVolatilityChart(series) {
  const labels  = series.map((p) => p.period.split(" ")[0]);
  const mgsnVol = rollingStd(series.map((p) => p.mgsnPrice), 3);
  const bobVol  = rollingStd(series.map((p) => p.bobPrice),  3);
  const opts    = baseOpts((v) => (v === null ? "" : `$${v.toFixed(4)}`));
  opts.plugins.tooltip.callbacks.label = (ctx) =>
    ctx.raw !== null ? ` ${ctx.dataset.label}: $${ctx.raw.toFixed(5)}` : null;
  mkChart("volatility", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "MGSN Vol", data: mgsnVol, borderColor: C.mgsn, borderWidth: 2.5, pointRadius: 0, tension: 0.4, spanGaps: true },
        { label: "BOB Vol",  data: bobVol,  borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.4, spanGaps: true },
      ],
    },
    options: opts,
  });
}

function renderVolumeChart(series) {
  const labels = series.map((p) => p.period.split(" ")[0]);
  const opts = {
    ...baseOpts(),
    scales: {
      x: baseOpts().scales.x,
      y: { ...baseOpts().scales.y, ticks: { ...baseOpts().scales.y.ticks, callback: (v) => compactMoney(v) } },
      y2: {
        position: "right",
        grid: { display: false },
        ticks: { color: C.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 }, callback: (v) => compactMoney(v) },
        border: { color: C.grid },
      },
    },
  };
  mkChart("volume", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { type: "bar",  label: "BOB Volume",       data: series.map((p) => p.bobVolume),  backgroundColor: "rgba(59,130,246,0.55)",  borderRadius: 3, yAxisID: "y" },
        { type: "bar",  label: "MGSN Volume",       data: series.map((p) => p.mgsnVolume), backgroundColor: "rgba(249,115,22,0.55)", borderRadius: 3, yAxisID: "y" },
        { type: "line", label: "Total Liquidity",   data: series.map((p) => p.bobLiquidity + p.mgsnLiquidity), borderColor: "#22c55e", borderWidth: 2, pointRadius: 0, tension: 0.4, yAxisID: "y2" },
      ],
    },
    options: opts,
  });
}

// â”€â”€ Render all charts for current state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function renderAllCharts(dashboard) {
  PANELS.forEach(({ id }) => {
    const series = getSeries(dashboard.timeline, state.panelRanges[id]);
    switch (id) {
      case "reserve":     renderReserveChart(series); break;
      case "sma":         renderSmaChart(series); break;
      case "performance": renderPerformanceChart(series); break;
      case "yield":       renderYieldChart(series); break;
      case "ratio":       renderRatioChart(series); break;
      case "nav":         renderNavChart(series, dashboard); break;
      case "cost":        renderCostChart(series); break;
      case "volatility":  renderVolatilityChart(series); break;
      case "volume":      renderVolumeChart(series); break;
    }
  });
}

// â”€â”€ Compute latest-point metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function computeMetrics(dashboard) {
  const tl   = dashboard.timeline;
  const last  = tl[tl.length - 1];
  const first = tl[0];
  const mgsnCap    = last.mgsnPrice * dashboard.mgsnSupply;
  const bobCap     = last.bobPrice  * dashboard.bobSupply;
  const mgsnChange = pct(first.mgsnPrice, last.mgsnPrice);
  const avgCost    = tl.reduce((s, p) => s + p.mgsnPrice, 0) / tl.length;
  const unrealisedUsd = (last.mgsnPrice - avgCost) * dashboard.mgsnSupply;
  const totalLiq   = last.bobLiquidity + last.mgsnLiquidity;
  const icpLive    = state.liveIcpUsd ?? last.icpPrice;
  return { last, mgsnCap, bobCap, mgsnChange, avgCost, unrealisedUsd, totalLiq, icpLive };
}

// â”€â”€ HTML builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function tfGroup(panelId) {
  const cur = state.panelRanges[panelId];
  return ["all", "1y", "6m", "3m", "1m"]
    .map((r) => {
      const label = r === "all" ? "All Time" : r.toUpperCase();
      return `<button class="tf${r === cur ? " active" : ""}" data-panel="${panelId}" data-range="${r}">${label}</button>`;
    })
    .join("");
}

function panelHeader(title, subtitle, panelId) {
  return `
    <div class="panel-header">
      <div>
        <h3 class="panel-title">${title}</h3>
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

function buildSidebarHTML(m) {
  const toggles = PANELS.map((p) => `
    <label class="toggle-item">
      <input type="checkbox" data-panel="${p.id}"${state.visible.has(p.id) ? " checked" : ""}>
      <span class="toggle-dot" style="background:${p.dot}"></span>
      ${p.label}
    </label>`).join("");

  const icpDisplay  = m.icpLive    !== null ? `$${m.icpLive.toFixed(2)}` : "â€”";
  const bobDisplay  = m.last.bobPrice  ? fmt(m.last.bobPrice,  4) : "â€”";
  const mgsnDisplay = m.last.mgsnPrice ? fmt(m.last.mgsnPrice, 4) : "â€”";

  return `
    <nav class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        <div class="logo-mark">M</div>
        <div>
          <div class="logo-name">MGSN Strategy Tracker</div>
          <div class="logo-sub">on Internet Computer</div>
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
          <span class="price-val${state.liveIcpUsd ? " live" : ""}" id="icp-price-val">${icpDisplay}</span>
        </div>
        <div class="price-row">
          <span class="price-symbol">BOB</span>
          <span class="price-val">${bobDisplay}</span>
        </div>
        <div class="price-row">
          <span class="price-symbol">MGSN</span>
          <span class="price-val">${mgsnDisplay}</span>
        </div>
      </div>

      <div class="sidebar-footer">
        <p>Data: ICPSwap Â· CoinGecko</p>
        <p style="margin-top:4px">ICPSwap TVL: $3.22M</p>
      </div>
    </nav>
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>`;
}

function buildMainHTML(dashboard, m) {
  const changeClass = m.mgsnChange >= 0 ? "positive" : "negative";
  const changeArrow = m.mgsnChange >= 0 ? "â–²" : "â–¼";

  const reserveSection = `
    <div class="chart-panel chart-panel--reserve${state.visible.has("reserve") ? "" : " hidden"}" id="panel-reserve" data-panel="reserve">
      ${panelHeader("MGSN Reserve", "Cash Reserve", "reserve")}
      <div class="chart-canvas-wrapper"><canvas id="chart-reserve"></canvas></div>
      <p class="drag-hint">Drag to select ranges â€¢ time filter buttons above each panel control data window</p>
      <div class="reserve-stats-row">
        <div class="reserve-main-stat">
          <span class="reserve-label">MGSN Reserve Value</span>
          <span class="reserve-amount">${compactMoney(m.mgsnCap)}</span>
          <span class="reserve-tokens">â¬¡ ${compact(dashboard.mgsnSupply)} MGSN circulating</span>
        </div>
        <div class="reserve-meta-list">
          <div class="meta-item">
            <span class="meta-label">Avg Cost</span>
            <span class="meta-value">${fmt(m.avgCost, 4)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Unrealised P&L</span>
            <span class="meta-value ${changeClass}">${changeArrow} ${pctFmt(m.mgsnChange)} (${compactMoney(Math.abs(m.unrealisedUsd))})</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">As of</span>
            <span class="meta-date">Apr 5, 2026</span>
          </div>
        </div>
      </div>
    </div>`;

  function cp(id, title, subtitle, chips = []) {
    return `
      <div class="chart-panel${state.visible.has(id) ? "" : " hidden"}" id="panel-${id}" data-panel="${id}">
        ${panelHeader(title, subtitle, id)}
        <div class="chart-canvas-wrapper"><canvas id="chart-${id}"></canvas></div>
        ${chips.length ? panelStatsFooter(chips) : ""}
      </div>`;
  }

  const ratio   = m.last.bobPrice / m.last.mgsnPrice;
  const bobChg  = pct(dashboard.timeline[0].bobPrice, m.last.bobPrice);
  const mgsnChg = pct(dashboard.timeline[0].mgsnPrice, m.last.mgsnPrice);

  return `
    <main class="main-content">
      <div class="main-header">
        <div class="main-header-row">
          <div>
            <h2 class="main-title">Financial Charts</h2>
            <p class="main-subtitle">Interactive analysis with individual time controls</p>
          </div>
          <button class="mobile-menu-btn" id="mobile-menu-btn">â˜° Charts</button>
        </div>
      </div>
      <div class="chart-panels">
        ${reserveSection}
        ${cp("sma",         "BOB & MGSN 3-SMA",          "Spot prices with short-term moving average overlay.",
          [{ label: "BOB spot",  value: fmt(m.last.bobPrice,  4), cls: "bob"  },
           { label: "MGSN spot", value: fmt(m.last.mgsnPrice, 4), cls: "mgsn" },
           { label: "BOB change",  value: pctFmt(bobChg),  cls: bobChg  >= 0 ? "pos" : "neg" },
           { label: "MGSN change", value: pctFmt(mgsnChg), cls: mgsnChg >= 0 ? "pos" : "neg" }])}
        ${cp("performance", "Performance vs. ICP",         "Indexed to 100 at oldest available data point.",
          [{ label: "MGSN",   value: pctFmt(mgsnChg), cls: mgsnChg >= 0 ? "pos" : "neg" },
           { label: "BOB",    value: pctFmt(bobChg),  cls: bobChg  >= 0 ? "pos" : "neg" },
           { label: "ICP",    value: pctFmt(pct(dashboard.timeline[0].icpPrice, m.last.icpPrice)), cls: "neg" }])}
        ${cp("yield",       "MGSN Yield & Gain",           "Monthly gain % (bars) and cumulative return (line).",
          [{ label: "Cumulative return", value: pctFmt(mgsnChg), cls: mgsnChg >= 0 ? "pos" : "neg" },
           { label: "MGSN price",        value: fmt(m.last.mgsnPrice, 4), cls: "mgsn" }])}
        ${cp("ratio",       "BOB-per-MGSN",                "How many BOB tokens one MGSN unit buys over time.",
          [{ label: "Current ratio", value: `${ratio.toFixed(2)}Ã—`, cls: "bob" },
           { label: "BOB dominance", value: `${(m.bobCap / (m.bobCap + m.mgsnCap) * 100).toFixed(1)}%` }])}
        ${cp("nav",         "Market Cap / NAV",            "MGSN and BOB market caps alongside NAV ratio.",
          [{ label: "MGSN mkt cap", value: compactMoney(m.mgsnCap), cls: "mgsn" },
           { label: "BOB mkt cap",  value: compactMoney(m.bobCap),  cls: "bob"  },
           { label: "Pair total",   value: compactMoney(m.mgsnCap + m.bobCap) }])}
        ${cp("cost",        "Token Cost in ICP",           "USD price of BOB and MGSN denominated in ICP units.",
          [{ label: "MGSN/ICP", value: `${(m.last.mgsnPrice / m.last.icpPrice).toFixed(6)} ICP`, cls: "mgsn" },
           { label: "BOB/ICP",  value: `${(m.last.bobPrice  / m.last.icpPrice).toFixed(6)} ICP`, cls: "bob"  },
           { label: "ICP/USD",  value: `$${m.icpLive.toFixed(2)}`, cls: state.liveIcpUsd ? "pos" : "" }])}
        ${cp("volatility",  "Volatility Comparison",       "Rolling 3-period standard deviation of spot price.",
          [{ label: "Source", value: "ICPSwap seeded data" }])}
        ${cp("volume",      "Volume & Liquidity",          "Trading volume breakdown and pooled liquidity depth.",
          [{ label: "Total liquidity", value: compactMoney(m.totalLiq) },
           { label: "ICPSwap TVL",     value: "$3.22M" },
           { label: "Total pairs",     value: "1,951" }])}
      </div>
    </main>`;
}

// â”€â”€ Event wiring â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function attachEvents(app, dashboard) {
  // Sidebar checkbox toggles
  app.querySelectorAll(".toggle-item input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.panel;
      if (cb.checked) state.visible.add(id); else state.visible.delete(id);
      const panel = document.getElementById(`panel-${id}`);
      if (panel) panel.classList.toggle("hidden", !cb.checked);
    });
  });

  // Select All / Clear All
  app.querySelector("#select-all")?.addEventListener("click", () => {
    PANELS.forEach(({ id }) => {
      state.visible.add(id);
      app.querySelector(`input[data-panel="${id}"]`)?.setAttribute("checked", "");
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
    // Update active class within this tf-group
    btn.closest(".tf-group").querySelectorAll(".tf").forEach((b) => {
      b.classList.toggle("active", b.dataset.range === range);
    });
    // Re-render just that chart
    const series = getSeries(dashboard.timeline, range);
    switch (panel) {
      case "reserve":     renderReserveChart(series); break;
      case "sma":         renderSmaChart(series); break;
      case "performance": renderPerformanceChart(series); break;
      case "yield":       renderYieldChart(series); break;
      case "ratio":       renderRatioChart(series); break;
      case "nav":         renderNavChart(series, dashboard); break;
      case "cost":        renderCostChart(series); break;
      case "volatility":  renderVolatilityChart(series); break;
      case "volume":      renderVolumeChart(series); break;
    }
  });

  // Mobile menu toggle
  const menuBtn  = app.querySelector("#mobile-menu-btn");
  const sidebar  = app.querySelector("#sidebar");
  const backdrop = app.querySelector("#sidebar-backdrop");
  menuBtn?.addEventListener("click",  () => { sidebar.classList.toggle("open"); backdrop.classList.toggle("open"); });
  backdrop?.addEventListener("click", () => { sidebar.classList.remove("open"); backdrop.classList.remove("open"); });
}

// â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function render(app, dashboard) {
  const m = computeMetrics(dashboard);
  app.innerHTML = `
    <div class="app-layout">
      ${buildSidebarHTML(m)}
      ${buildMainHTML(dashboard, m)}
    </div>`;
  attachEvents(app, dashboard);
  // Charts need the DOM to be ready
  requestAnimationFrame(() => renderAllCharts(dashboard));
}

// â”€â”€ Bootstrap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function bootstrap() {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="loading-screen">
      <div class="loading-logo">M</div>
      <span class="loading-text">Loading MGSN Strategy Trackerâ€¦</span>
    </div>`;

  // Load canister data or demo fallback
  let dashboard = demoDashboard;
  const actor = createBackendActor();
  if (actor) {
    try {
      dashboard = await actor.getDashboard();
    } catch {
      // fall through to demo
    }
  }

  // Live ICP price (non-blocking, update after initial render)
  fetchLiveSpotPrices().then(({ icpUsd }) => {
    if (icpUsd) {
      state.liveIcpUsd = icpUsd;
      const el = document.getElementById("icp-price-val");
      if (el) {
        el.textContent = `$${icpUsd.toFixed(2)}`;
        el.classList.add("live");
      }
    }
  });

  render(app, dashboard);

  // Auto-refresh live ICP price every 60 s
  setInterval(async () => {
    const { icpUsd } = await fetchLiveSpotPrices();
    if (icpUsd) {
      state.liveIcpUsd = icpUsd;
      const el = document.getElementById("icp-price-val");
      if (el) { el.textContent = `$${icpUsd.toFixed(2)}`; el.classList.add("live"); }
    }
  }, 60_000);
}

bootstrap();


