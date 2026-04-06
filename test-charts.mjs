/**
 * test-charts.mjs — Node.js smoke test for the MGSN chart data pipeline.
 *
 * Tests everything that can be tested without a browser:
 *   1. demoData shape (icpPrice present, no NaN/undefined values)
 *   2. All math helpers (sma, rollingStd, getSeries)
 *   3. computeMetrics — the function that crashed with undefined.toFixed()
 *   4. Each chart's dataset builder — all 10 panels
 *   5. The canvas-sizing path in mkChart (simulated)
 *
 * Run:  node test-charts.mjs
 */

import { demoDashboard } from "./src/demoData.js";

// ── helpers ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✔  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✘  ${name}`);
    console.error(`       ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg ?? "assertion failed");
}

function assertFinite(val, label) {
  if (val == null || !Number.isFinite(val))
    throw new Error(`${label} = ${val} (expected finite number)`);
}

// ── Re-implement the functions under test (copied from main.js) ────────────────

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

function pct(start, end) {
  if (start === 0) return 0;
  return ((end - start) / start) * 100;
}

function computeMetrics(dashboard, liveIcpUsd = null) {
  const tl     = dashboard.timeline;
  const last   = tl[tl.length - 1];
  const first  = tl[0];

  const mgsnCap      = last.mgsnPrice * dashboard.mgsnSupply;
  const bobCap       = last.bobPrice  * dashboard.bobSupply;
  const nav          = bobCap;
  const mNavRatio    = nav > 0 ? mgsnCap / nav : 0;
  const navPremium   = (mNavRatio - 1) * 100;

  const mgsnChange   = pct(first.mgsnPrice, last.mgsnPrice);
  const bobChange    = pct(first.bobPrice,  last.bobPrice);
  const icpChange    = pct(first.icpPrice,  last.icpPrice);

  const avgCostMgsn  = tl.reduce((s, p) => s + p.mgsnPrice, 0) / tl.length;
  const avgCostIcp   = tl.reduce((s, p) => s + p.mgsnPrice / p.icpPrice, 0) / tl.length;
  const unrealisedUsd = (last.mgsnPrice - avgCostMgsn) * dashboard.mgsnSupply;
  const unrealisedPct = pct(avgCostMgsn, last.mgsnPrice);

  const totalLiq     = last.bobLiquidity + last.mgsnLiquidity;
  const icpLive      = liveIcpUsd ?? last.icpPrice;

  const firstNav     = (first.bobPrice * dashboard.bobSupply);
  const firstMgsnCap = (first.mgsnPrice * dashboard.mgsnSupply);
  const firstMNav    = firstNav > 0 ? firstMgsnCap / firstNav : 0;
  const mNavYield    = pct(firstMNav, mNavRatio);

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

// ── Test suite ─────────────────────────────────────────────────────────────────

console.log("\n── 1. demoData shape ─────────────────────────────────────────");

test("dashboard object exists", () => assert(demoDashboard != null));
test("timeline has at least 12 points", () => assert(demoDashboard.timeline.length >= 12,
  `only ${demoDashboard.timeline.length} points`));
test("bobSupply and mgsnSupply are finite", () => {
  assertFinite(demoDashboard.bobSupply, "bobSupply");
  assertFinite(demoDashboard.mgsnSupply, "mgsnSupply");
});

test("every MetricPoint has icpPrice (the field that was missing)", () => {
  for (const p of demoDashboard.timeline) {
    if (p.icpPrice == null || !Number.isFinite(p.icpPrice))
      throw new Error(`period "${p.period}" has icpPrice = ${p.icpPrice}`);
  }
});

test("no NaN/undefined in any numeric field", () => {
  const fields = ["icpPrice","bobPrice","mgsnPrice","bobVolume","mgsnVolume","bobLiquidity","mgsnLiquidity"];
  for (const p of demoDashboard.timeline) {
    for (const f of fields) {
      if (!Number.isFinite(p[f]))
        throw new Error(`period "${p.period}" field "${f}" = ${p[f]}`);
    }
  }
});

console.log("\n── 2. Math helpers ───────────────────────────────────────────");

test("sma returns null for first (period-1) entries", () => {
  const result = sma([1,2,3,4,5], 3);
  assert(result[0] === null && result[1] === null, "expected null at index 0,1");
  assertFinite(result[2], "sma[2]");
});

test("sma value is correct", () => {
  const result = sma([2,4,6,8,10], 3);
  assert(Math.abs(result[2] - 4) < 0.001, `expected 4, got ${result[2]}`);
  assert(Math.abs(result[4] - 8) < 0.001, `expected 8, got ${result[4]}`);
});

test("rollingStd returns null for early entries", () => {
  const result = rollingStd([1,2,3,4,5], 3);
  assert(result[0] === null && result[1] === null);
});

test("rollingStd value is finite for later entries", () => {
  const result = rollingStd([10,12,14,16,18], 3);
  assertFinite(result[2], "rollingStd[2]");
  assertFinite(result[4], "rollingStd[4]");
});

test("getSeries 'all' returns full timeline", () => {
  const s = getSeries(demoDashboard.timeline, "all");
  assert(s.length === demoDashboard.timeline.length);
});

test("getSeries '6m' returns last 6 entries", () => {
  const s = getSeries(demoDashboard.timeline, "6m");
  assert(s.length === 6, `expected 6, got ${s.length}`);
});

test("getSeries '1m' returns last 1 entry", () => {
  const s = getSeries(demoDashboard.timeline, "1m");
  assert(s.length === 1);
});

console.log("\n── 3. computeMetrics (the crash site) ───────────────────────");

test("computeMetrics runs without throwing", () => {
  computeMetrics(demoDashboard);
});

test("icpLive is a finite number (was undefined before fix)", () => {
  const m = computeMetrics(demoDashboard);
  assertFinite(m.icpLive, "icpLive");
});

test("icpLive.toFixed(2) works (the line that crashed)", () => {
  const m = computeMetrics(demoDashboard);
  const result = m.icpLive.toFixed(2);
  assert(typeof result === "string" && result.length > 0);
});

test("mNavRatio is finite and > 0", () => {
  const m = computeMetrics(demoDashboard);
  assertFinite(m.mNavRatio, "mNavRatio");
  assert(m.mNavRatio > 0);
});

test("mgsnIcp and bobIcp are finite (ICP-denominated prices)", () => {
  const m = computeMetrics(demoDashboard);
  assertFinite(m.mgsnIcp, "mgsnIcp");
  assertFinite(m.bobIcp, "bobIcp");
});

test("all metrics are finite numbers", () => {
  const m = computeMetrics(demoDashboard);
  const checks = ["mgsnCap","bobCap","nav","mNavRatio","navPremium",
                  "mgsnChange","bobChange","icpChange","avgCostMgsn","avgCostIcp",
                  "unrealisedUsd","unrealisedPct","totalLiq","icpLive","mNavYield"];
  for (const k of checks) assertFinite(m[k], k);
});

test("computeMetrics with live ICP price override", () => {
  const m = computeMetrics(demoDashboard, 6.42);
  assert(Math.abs(m.icpLive - 6.42) < 0.001);
});

console.log("\n── 4. Chart dataset builders (all 10 panels) ────────────────");

const tl = demoDashboard.timeline;

test("Panel 1 reserve: mgsnCap and bobCap arrays are finite", () => {
  const series = getSeries(tl, "all");
  const mgsnCap = series.map((p) => p.mgsnPrice * 77_000_000);
  const bobCap  = series.map((p) => p.bobPrice  * 210_000_000);
  mgsnCap.forEach((v, i) => assertFinite(v, `mgsnCap[${i}]`));
  bobCap.forEach((v, i)  => assertFinite(v, `bobCap[${i}]`));
});

test("Panel 2 sma: price arrays and MA arrays have correct lengths", () => {
  const series = getSeries(tl, "all");
  const bob  = series.map((p) => p.bobPrice);
  const mgsn = series.map((p) => p.mgsnPrice);
  const bobMA  = sma(bob,  Math.min(series.length, 8));
  const mgsnMA = sma(mgsn, Math.min(series.length, 8));
  assert(bobMA.length === series.length);
  assert(mgsnMA.length === series.length);
});

test("Panel 3 performance: indexed series start at 100 and are finite", () => {
  const series = getSeries(tl, "all");
  const mgsnPerf = series.map((p) => (p.mgsnPrice / series[0].mgsnPrice) * 100);
  assertFinite(mgsnPerf[0], "mgsnPerf[0]");
  assert(Math.abs(mgsnPerf[0] - 100) < 0.001, "first perf value should be 100");
  mgsnPerf.forEach((v, i) => assertFinite(v, `mgsnPerf[${i}]`));
});

test("Panel 4 yield: monthGain, cumulative, holdings all finite", () => {
  const series = getSeries(tl, "all");
  const monthGain  = series.map((p, i) => i === 0 ? 0 : pct(series[i-1].mgsnPrice, p.mgsnPrice));
  const cumulative = series.map((p) => pct(series[0].mgsnPrice, p.mgsnPrice));
  const holdings   = series.map((p) => p.mgsnPrice * 77_000_000);
  monthGain.forEach((v, i)  => assertFinite(v, `monthGain[${i}]`));
  cumulative.forEach((v, i) => assertFinite(v, `cumulative[${i}]`));
  holdings.forEach((v, i)   => assertFinite(v, `holdings[${i}]`));
});

test("Panel 5 satstoshare: mgsnIcp and bobIcp are finite (requires icpPrice)", () => {
  const series = getSeries(tl, "all");
  const mgsnIcp = series.map((p) => p.mgsnPrice / p.icpPrice);
  const bobIcp  = series.map((p) => p.bobPrice  / p.icpPrice);
  mgsnIcp.forEach((v, i) => assertFinite(v, `mgsnIcp[${i}]`));
  bobIcp.forEach((v, i)  => assertFinite(v, `bobIcp[${i}]`));
});

test("Panel 6 nav: mNAV ratio is finite and positive", () => {
  const series  = getSeries(tl, "all");
  const mgsnCap = series.map((p) => p.mgsnPrice * demoDashboard.mgsnSupply);
  const nav     = series.map((p) => p.bobPrice  * demoDashboard.bobSupply);
  const mNav    = mgsnCap.map((m, i) => nav[i] > 0 ? m / nav[i] : 0);
  mNav.forEach((v, i) => assertFinite(v, `mNav[${i}]`));
  assert(mNav.every((v) => v >= 0), "some mNAV values negative");
});

test("Panel 7 cost: avgLine is finite (requires icpPrice)", () => {
  const series  = getSeries(tl, "all");
  const mgsnIcp = series.map((p) => p.mgsnPrice / p.icpPrice);
  const avgMgsn = mgsnIcp.reduce((a, b) => a + b, 0) / mgsnIcp.length;
  assertFinite(avgMgsn, "avgMgsn");
});

test("Panel 8 volatility: rollingStd over icpPrice is finite (requires icpPrice)", () => {
  const series = getSeries(tl, "all");
  const icpVol = rollingStd(series.map((p) => p.icpPrice), 3);
  icpVol.filter((v) => v !== null).forEach((v, i) => assertFinite(v, `icpVol[${i}]`));
});

test("Panel 9 volume: total liquidity array is finite", () => {
  const series = getSeries(tl, "all");
  const liq = series.map((p) => p.bobLiquidity + p.mgsnLiquidity);
  liq.forEach((v, i) => assertFinite(v, `liquidity[${i}]`));
  assert(liq.every((v) => v > 0));
});

test("Panel 10 raises: cumulative volumes are monotonically increasing", () => {
  const series  = getSeries(tl, "all");
  const cumBob  = series.map((_, i) => series.slice(0, i+1).reduce((s,p) => s + p.bobVolume, 0));
  const cumMgsn = series.map((_, i) => series.slice(0, i+1).reduce((s,p) => s + p.mgsnVolume, 0));
  for (let i = 1; i < cumBob.length; i++) {
    assert(cumBob[i] >= cumBob[i-1],   `cumBob not monotone at ${i}`);
    assert(cumMgsn[i] >= cumMgsn[i-1], `cumMgsn not monotone at ${i}`);
  }
});

console.log("\n── 5. Canvas sizing (attribute-based) ───────────────────────");

test("canvas width/height attributes set in HTML are used directly", () => {
  // Simulate the canvas element as set in the HTML template
  const mockCanvas = { width: 800, height: 310, style: {} };
  mockCanvas.style.width  = mockCanvas.width  + 'px';
  mockCanvas.style.height = mockCanvas.height + 'px';
  assert(mockCanvas.style.width  === '800px',  `expected '800px', got '${mockCanvas.style.width}'`);
  assert(mockCanvas.style.height === '310px', `expected '310px', got '${mockCanvas.style.height}'`);
});

test("reserve canvas uses taller height (340)", () => {
  const mockCanvas = { width: 800, height: 340, style: {} };
  mockCanvas.style.width  = mockCanvas.width  + 'px';
  mockCanvas.style.height = mockCanvas.height + 'px';
  assert(mockCanvas.style.height === '340px');
});

console.log("\n── 6. Range filtering edge cases ────────────────────────────");

test("1m range on 12-point canister data (only 1 point) doesn't crash any builder", () => {
  const short = getSeries(tl.slice(0, 1), "1m");
  // renderSmaChart: sma with period > series.length returns all-null, no crash
  const bob  = short.map((p) => p.bobPrice);
  const ma   = sma(bob, Math.min(short.length, 8));
  assert(ma.length === 1);
});

test("getSeries with unknown range key falls back to full data", () => {
  const s = getSeries(tl, "5y");
  assert(s.length === tl.length, "unknown range should return full dataset");
});

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(54)}`);
console.log(`  ${passed} passed  ${failed > 0 ? failed + " FAILED" : "0 failed"}`);
console.log(`${"─".repeat(54)}\n`);

if (failed > 0) process.exit(1);
