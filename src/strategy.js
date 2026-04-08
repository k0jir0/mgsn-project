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

import { TOKEN_CANISTERS } from "./demoData";
import {
  createUnavailableDashboard,
  getDashboardLastPoint,
  hasDashboardHistory,
} from "./liveDefaults.js";
import {
  fetchDashboardData,
  fetchLiveSpotPrices,
  fetchICPSwapPrices,
  fetchICPSwapPoolStats,
} from "./liveData";
import { buildPlatformHeaderHTML } from "./siteChrome.js";
import {
  applyScenarioToDashboard,
  applyScenarioToPoolStats,
  applyScenarioToPrices,
  attachScenarioStudio,
  buildDashboardSourceChips,
  buildScenarioHeaderHTML,
  getPortfolioDefaults,
  loadScenarioState,
  readViewCache,
  writeViewCache,
} from "./siteState.js";

// ── Constants ────────────────────────────────────────────────────────────────

const ICPSWAP_SWAP_URL =
  `https://app.icpswap.com/swap?input=${TOKEN_CANISTERS.ICP}&output=${TOKEN_CANISTERS.MGSN}`;
const ICPSWAP_LP_URL =
  `https://app.icpswap.com/liquidity/add/${TOKEN_CANISTERS.ICP}/${TOKEN_CANISTERS.MGSN}`;
const ICPSWAP_INFO_MGSN =
  `https://info.icpswap.com/token/details/${TOKEN_CANISTERS.MGSN}`;
const ICPSWAP_INFO_BOB =
  `https://info.icpswap.com/token/details/${TOKEN_CANISTERS.BOB}`;

// ICPSwap fee tier for MGSN/ICP pool (0.3%)
const POOL_FEE = 0.003;
// Conservative estimate: MGSN pool daily volume ≈ 5 % of BOB peak volume
const MGSN_VOL_SHARE = 0.05;

const C = {
  mgsn:     "#f97316",
  mgsnFill: "rgba(249,115,22,0.12)",
  bob:      "#3b82f6",
  bobFill:  "rgba(59,130,246,0.12)",
  icp:      "#8b5cf6",
  pos:      "#22c55e",
  posFill:  "rgba(34,197,94,0.12)",
  neg:      "#ef4444",
  gold:     "#f59e0b",
  goldFill: "rgba(245,158,11,0.1)",
  neutral:  "#64748b",
  grid:     "#1a1f3a",
  tick:     "#5a6a8a",
  tooltip: { bg: "#0f1120", border: "#1a1f3a", title: "#f0f4ff", body: "#94a3b8" },
};

const charts = {};

// ── Math helpers ─────────────────────────────────────────────────────────────

function sma(arr, period) {
  return arr.map((_, i) => {
    if (i < period - 1) return null;
    const s = arr.slice(i - period + 1, i + 1);
    return s.reduce((a, b) => a + b, 0) / period;
  });
}

/** Wilder RSI adapted for monthly data (period = 5 by default). */
function rsiSeries(arr, period = 5) {
  if (arr.length < period + 1) return arr.map(() => null);
  const result = arr.map(() => null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = arr[i] - arr[i - 1];
    if (d > 0) avgGain += d; else avgLoss += -d;
  }
  avgGain /= period;
  avgLoss /= period;
  if (avgLoss === 0) result[period] = 100;
  else result[period] = 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    if (avgLoss === 0) result[i] = 100;
    else result[i] = 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function pct(from, to) {
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}

// ── MACD ─────────────────────────────────────────────────────────────────────
/** Exponential Moving Average */
function ema(arr, period) {
  const k = 2 / (period + 1);
  const result = arr.map(() => null);
  let startIdx = 0;
  while (startIdx < arr.length && arr[startIdx] == null) startIdx++;
  if (startIdx >= arr.length) return result;
  result[startIdx] = arr[startIdx];
  for (let i = startIdx + 1; i < arr.length; i++) {
    if (arr[i] == null) { result[i] = result[i - 1]; continue; }
    result[i] = arr[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * Returns { macd, signal, hist } each as an array the same length as arr.
 * Using short=3, long=8, signal=5 (adapted for monthly data).
 */
function macdSeries(arr, short = 3, long = 8, sig = 5) {
  const emaShort  = ema(arr, short);
  const emaLong   = ema(arr, long);
  const macdLine  = arr.map((_, i) =>
    emaShort[i] !== null && emaLong[i] !== null ? emaShort[i] - emaLong[i] : null
  );
  const sigLine   = ema(macdLine, sig);
  const hist      = macdLine.map((m, i) =>
    m !== null && sigLine[i] !== null ? m - sigLine[i] : null
  );
  return { macd: macdLine, signal: sigLine, hist };
}

// ── Bollinger Bands ───────────────────────────────────────────────────────────
/**
 * Returns { upper, mid, lower } each an array.
 * period=8, stdMult=2.0 (standard), adapted for monthly.
 */
function bollingerBands(arr, period = 8, mult = 2) {
  return arr.map((_, i) => {
    if (i < period - 1) return { upper: null, mid: null, lower: null, pctB: null };
    const slice = arr.slice(i - period + 1, i + 1).filter((v) => v != null);
    if (slice.length < period) return { upper: null, mid: null, lower: null, pctB: null };
    const mid    = slice.reduce((a, b) => a + b, 0) / slice.length;
    const std    = Math.sqrt(slice.reduce((a, v) => a + (v - mid) ** 2, 0) / slice.length);
    const upper  = mid + mult * std;
    const lower  = mid - mult * std;
    const pctB   = std > 0 ? (arr[i] - lower) / (upper - lower) : 0.5;
    return { upper, mid, lower, pctB };
  });
}

// ── Kelly Criterion ───────────────────────────────────────────────────────────
/**
 * Optimal fraction of bankroll to risk per period.
 * f* = (p*b - q) / b  where p=winRate, q=1-p, b=avgWin/avgLoss ratio.
 * Capped at 0.25 (quarter-Kelly) for safety.
 */
function kellyCriterion(wins, losses) {
  if (wins.length === 0 || losses.length === 0) return { fraction: 0, note: "Insufficient data" };
  const p       = wins.length / (wins.length + losses.length);
  const avgWin  = wins.reduce((a, b) => a + b, 0) / wins.length;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
  if (avgLoss === 0) return { fraction: 0.25, note: "No losses recorded" };
  const b       = Math.abs(avgWin / avgLoss);
  const q       = 1 - p;
  const fullKelly = (p * b - q) / b;
  const fraction  = Math.min(Math.max(fullKelly * 0.25, 0), 0.25); // quarter-Kelly
  return { fraction, fullKelly, p, b, note: `Win rate ${(p * 100).toFixed(1)}% | Avg W/L ${b.toFixed(2)}x` };
}

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

function pctFmt(v, d = 1) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}

// ── Signal Engine ────────────────────────────────────────────────────────────
/**
 * All signals are derived from the real BOB price history (22 months) and the
 * live MGSN spot price. MGSN has no stored price history on ICPSwap as of
 * Apr 2026, so ecosystem momentum (BOB) drives the accumulation signal.
 *
 * Live MGSN/BOB prices from ICPSwap NodeIndex override the demo values when
 * available.
 */
function computeSignals(dashboard, liveIcp, liveMgsn, liveBob) {
  const tl   = dashboard.timeline;
  const last = tl[tl.length - 1];
  const icpNow   = liveIcp  ?? last.icpPrice;
  const mgsnNow  = liveMgsn ?? last.mgsnPrice;
  const bobNow   = liveBob  ?? last.bobPrice;

  const bobPrices = tl.map((p) => p.bobPrice);

  // ── Signal 1: BOB RSI (5-period monthly) ──────────────────────────────────
  const bobRsi   = rsiSeries(bobPrices, 5);
  const lastRsi  = bobRsi.filter((v) => v !== null).at(-1) ?? 50;

  let rsiScore, rsiLabel, rsiNote;
  if (lastRsi < 30)       { rsiScore = 90; rsiLabel = "OVERSOLD";   rsiNote = `RSI ${lastRsi.toFixed(1)} — strong reversal zone`; }
  else if (lastRsi < 40)  { rsiScore = 75; rsiLabel = "WEAK";       rsiNote = `RSI ${lastRsi.toFixed(1)} — accumulation zone`; }
  else if (lastRsi < 50)  { rsiScore = 60; rsiLabel = "NEUTRAL–";   rsiNote = `RSI ${lastRsi.toFixed(1)} — mildly bearish`; }
  else if (lastRsi < 60)  { rsiScore = 40; rsiLabel = "NEUTRAL+";   rsiNote = `RSI ${lastRsi.toFixed(1)} — mild positive momentum`; }
  else if (lastRsi < 70)  { rsiScore = 25; rsiLabel = "ELEVATED";   rsiNote = `RSI ${lastRsi.toFixed(1)} — reduce new buys`; }
  else                    { rsiScore = 10; rsiLabel = "OVERBOUGHT"; rsiNote = `RSI ${lastRsi.toFixed(1)} — take partial profit`; }

  // ── Signal 2: BOB SMA Crossover (fast-3 vs slow-8) ────────────────────────
  const bobFast = sma(bobPrices, 3);
  const bobSlow = sma(bobPrices, 8);
  const fastNow = bobFast.at(-1);
  const slowNow = bobSlow.at(-1);
  const crossover = fastNow !== null && slowNow !== null
    ? ((fastNow - slowNow) / slowNow) * 100
    : 0;

  let smaScore, smaLabel, smaCross;
  if (crossover < -15)     { smaScore = 90; smaLabel = "DEEP BEAR";  smaCross = `Fast ${fastNow.toFixed(4)} ↓ ${Math.abs(crossover).toFixed(1)}% below slow`; }
  else if (crossover < -5) { smaScore = 70; smaLabel = "BEAR CROSS"; smaCross = `Fast ↓ ${Math.abs(crossover).toFixed(1)}% below slow SMA`; }
  else if (crossover < 0)  { smaScore = 55; smaLabel = "NEUTRAL–";   smaCross = `Spread: ${crossover.toFixed(1)}%`; }
  else if (crossover < 5)  { smaScore = 45; smaLabel = "NEUTRAL+";   smaCross = `Spread: +${crossover.toFixed(1)}%`; }
  else if (crossover < 15) { smaScore = 30; smaLabel = "BULL CROSS"; smaCross = `Fast ↑ ${crossover.toFixed(1)}% above slow SMA`; }
  else                     { smaScore = 15; smaLabel = "STRONG BULL";smaCross = `Fast ↑ ${crossover.toFixed(1)}% above slow SMA`; }

  // ── Signal 3: mNAV Ratio ──────────────────────────────────────────────────
  const mgsnCap  = mgsnNow  * dashboard.mgsnSupply;
  const bobCap   = bobNow   * dashboard.bobSupply;
  const mNav     = bobCap > 0 ? mgsnCap / bobCap : 0;

  const navHistory = tl.map((p) => {
    const mc = p.mgsnPrice * dashboard.mgsnSupply;
    const bc = p.bobPrice  * dashboard.bobSupply;
    return bc > 0 ? mc / bc : 0;
  }).filter((v) => v > 0);
  const avgNav  = navHistory.reduce((a, b) => a + b, 0) / navHistory.length;
  const navDev  = ((mNav - avgNav) / avgNav) * 100;

  let navScore, navLabel, navNote;
  if (navDev < -50)      { navScore = 90; navLabel = "DEEP DISCOUNT"; navNote = `${navDev.toFixed(1)}% below historical avg`; }
  else if (navDev < -20) { navScore = 70; navLabel = "DISCOUNT";      navNote = `${navDev.toFixed(1)}% below historical avg`; }
  else if (navDev < 10)  { navScore = 50; navLabel = "FAIR VALUE";    navNote = `Near historical avg (${avgNav.toFixed(4)}×)`; }
  else if (navDev < 40)  { navScore = 30; navLabel = "PREMIUM";       navNote = `+${navDev.toFixed(1)}% above avg`; }
  else                   { navScore = 10; navLabel = "HIGH PREMIUM";  navNote = `+${navDev.toFixed(1)}% above avg — take profit`; }

  // ── Signal 4: MGSN/ICP Relative Value ─────────────────────────────────────
  const mgsnIcpNow  = mgsnNow / icpNow;
  const mgsnIcpHist = tl.map((p) => p.mgsnPrice / p.icpPrice);
  const avgMgsnIcp  = mgsnIcpHist.reduce((a, b) => a + b, 0) / mgsnIcpHist.length;
  const icpDev      = ((mgsnIcpNow - avgMgsnIcp) / avgMgsnIcp) * 100;

  let icpValScore, icpValLabel, icpValNote;
  if (icpDev < -60)      { icpValScore = 95; icpValLabel = "VERY CHEAP";  icpValNote = `${icpDev.toFixed(1)}% below avg ICP-cost`; }
  else if (icpDev < -30) { icpValScore = 75; icpValLabel = "CHEAP";       icpValNote = `${icpDev.toFixed(1)}% below avg ICP-cost`; }
  else if (icpDev < 0)   { icpValScore = 55; icpValLabel = "FAIR";        icpValNote = `Near avg ICP-cost`; }
  else if (icpDev < 30)  { icpValScore = 35; icpValLabel = "PRICEY";      icpValNote = `+${icpDev.toFixed(1)}% above avg`; }
  else                   { icpValScore = 15; icpValLabel = "EXPENSIVE";   icpValNote = `+${icpDev.toFixed(1)}% above avg — wait`; }

  // ── Signal 5: MACD on BOB ─────────────────────────────────────────────────
  const macdData  = macdSeries(bobPrices);
  const histNow   = macdData.hist.filter((v) => v !== null).at(-1) ?? 0;
  const histPrev  = macdData.hist.filter((v) => v !== null).at(-2) ?? 0;
  const macdTrend = histNow - histPrev;

  let macdScore, macdLabel, macdNote;
  if (histNow < 0 && macdTrend > 0)        { macdScore = 80; macdLabel = "DIVERGING ↑";  macdNote = `Histogram turning up from negative — early reversal`; }
  else if (histNow < 0 && macdTrend <= 0)  { macdScore = 70; macdLabel = "BEARISH";       macdNote = `Histogram ${histNow.toFixed(5)} and falling`; }
  else if (histNow > 0 && macdTrend < 0)   { macdScore = 35; macdLabel = "FADING ↓";     macdNote = `Histogram turning down from positive — momentum waning`; }
  else                                      { macdScore = 25; macdLabel = "BULLISH";       macdNote = `Histogram ${histNow.toFixed(5)} and rising`; }

  // ── Signal 6: Bollinger Band %B on BOB ───────────────────────────────────
  const bb      = bollingerBands(bobPrices, 8, 2);
  const bbNow   = bb.at(-1);
  const pctB    = bbNow?.pctB ?? 0.5;

  let bbScore, bbLabel, bbNote;
  if (pctB < 0.05)       { bbScore = 92; bbLabel = "BELOW BAND";  bbNote = `%B ${(pctB * 100).toFixed(1)}% — extreme compression near lower band`; }
  else if (pctB < 0.20)  { bbScore = 78; bbLabel = "LOWER ZONE";  bbNote = `%B ${(pctB * 100).toFixed(1)}% — near lower band, high probability bounce`; }
  else if (pctB < 0.40)  { bbScore = 62; bbLabel = "LOWER HALF";  bbNote = `%B ${(pctB * 100).toFixed(1)}% — below midline`; }
  else if (pctB < 0.60)  { bbScore = 50; bbLabel = "MID BAND";    bbNote = `%B ${(pctB * 100).toFixed(1)}% — at midline`; }
  else if (pctB < 0.80)  { bbScore = 35; bbLabel = "UPPER HALF";  bbNote = `%B ${(pctB * 100).toFixed(1)}% — above midline`; }
  else if (pctB < 0.95)  { bbScore = 22; bbLabel = "UPPER ZONE";  bbNote = `%B ${(pctB * 100).toFixed(1)}% — near upper band`; }
  else                   { bbScore = 8;  bbLabel = "ABOVE BAND";  bbNote = `%B ${(pctB * 100).toFixed(1)}% — above upper band, overbought`; }

  // ── Composite score ────────────────────────────────────────────────────────
  // Weights: RSI 20%, SMA 15%, mNAV 20%, ICP-value 15%, MACD 15%, BB 15%
  const composite = rsiScore * 0.20 + smaScore * 0.15 + navScore * 0.20 +
                    icpValScore * 0.15 + macdScore * 0.15 + bbScore * 0.15;

  let action, actionClass, actionNote, confidence;
  if (composite >= 75)      { action = "STRONG BUY";  actionClass = "signal-strong-buy";  confidence = "High";   actionNote = "All 6 indicators aligned — maximum DCA multiplier"; }
  else if (composite >= 62) { action = "BUY";          actionClass = "signal-buy";          confidence = "High";   actionNote = "Bullish ecosystem divergence + MGSN cost discount"; }
  else if (composite >= 50) { action = "ACCUMULATE";   actionClass = "signal-accumulate";   confidence = "Medium"; actionNote = "Mild tailwind — standard DCA allocation"; }
  else if (composite >= 38) { action = "HOLD";         actionClass = "signal-hold";         confidence = "Medium"; actionNote = "Mixed signals — hold current position"; }
  else                      { action = "REDUCE";       actionClass = "signal-reduce";       confidence = "Low";    actionNote = "Premium valuation / overbought — consider lightening"; }

  // ── Kelly sizing from backtest win/loss distribution ───────────────────────
  const monthlyReturns = bobPrices.slice(1).map((p, i) => (p - bobPrices[i]) / bobPrices[i]);
  const wins    = monthlyReturns.filter((r) => r > 0);
  const losses  = monthlyReturns.filter((r) => r < 0).map((r) => Math.abs(r));
  const kelly   = kellyCriterion(wins, losses);

  return {
    composite, action, actionClass, confidence, actionNote,
    rsi:    { score: rsiScore,    label: rsiLabel,    note: rsiNote,    value: lastRsi },
    sma:    { score: smaScore,    label: smaLabel,    note: smaCross,   crossover },
    nav:    { score: navScore,    label: navLabel,    note: navNote,    ratio: mNav, avg: avgNav },
    icpVal: { score: icpValScore, label: icpValLabel, note: icpValNote, current: mgsnIcpNow, avg: avgMgsnIcp },
    macd:   { score: macdScore,   label: macdLabel,   note: macdNote,   hist: histNow, trend: macdTrend },
    bb:     { score: bbScore,     label: bbLabel,     note: bbNote,     pctB },
    kelly,
    bobRsiSeries: bobRsi, bobFast, bobSlow,
    macdData, bbData: bb,
    mgsnNow, bobNow, icpNow, mgsnCap, bobCap,
  };
}

// ── DCA Backtest Engine ───────────────────────────────────────────────────────
/**
 * Projects MGSN price using BOB correlation, simulates three strategies
 * over the 22-month historical window.
 */
function runDCABacktest(dashboard, monthlyBudget = 100, liveMgsn = null, liveBob = null) {
  const tl      = dashboard.timeline;
  const bobRef  = liveBob  ?? tl.at(-1).bobPrice;
  const mgsnRef = liveMgsn ?? tl.at(-1).mgsnPrice;

  const projected = tl.map((p) => ({
    ...p,
    mgsnProjected: mgsnRef * (p.bobPrice / bobRef),
  }));

  const bobPrices = tl.map((p) => p.bobPrice);
  const btRsi     = rsiSeries(bobPrices, 5);
  const btFast    = sma(bobPrices, 3);
  const btSlow    = sma(bobPrices, 8);
  const btMacd    = macdSeries(bobPrices);
  const btBb      = bollingerBands(bobPrices, 8, 2);

  let flatTokens = 0, flatInvested = 0;
  let sigTokens  = 0, sigInvested  = 0;
  let lumpTokens = 0;
  const flatHistory = [], sigHistory = [], lumpHistory = [];

  const totalBudget = monthlyBudget * tl.length;
  lumpTokens = totalBudget / projected[0].mgsnProjected;

  for (let i = 0; i < projected.length; i++) {
    const p    = projected[i];
    const rsi  = btRsi[i];
    const fast = btFast[i];
    const slow = btSlow[i];
    const hist = btMacd.hist[i];
    const bb   = btBb[i];

    flatInvested += monthlyBudget;
    flatTokens   += monthlyBudget / p.mgsnProjected;

    // Signal DCA — composite multiplier from RSI + SMA + MACD + BB
    let rsiMult = 1, smaMult = 1, macdMult = 1, bbMult = 1;
    if (rsi  !== null) rsiMult  = rsi < 35 ? 2 : rsi < 50 ? 1.5 : rsi > 65 ? 0.5 : 1;
    if (fast !== null && slow !== null) {
      const xo = ((fast - slow) / slow) * 100;
      smaMult = xo < -10 ? 2 : xo < 0 ? 1.5 : xo > 10 ? 0.5 : 1;
    }
    if (hist !== null) macdMult = hist < 0 ? 1.5 : 0.75;
    if (bb?.pctB !== undefined) bbMult = bb.pctB < 0.2 ? 1.5 : bb.pctB > 0.8 ? 0.6 : 1;

    const multiplier = Math.min(Math.max(
      (rsiMult * 0.3 + smaMult * 0.3 + macdMult * 0.2 + bbMult * 0.2), 0.25
    ), 2.5);

    sigInvested += monthlyBudget * multiplier;
    sigTokens   += (monthlyBudget * multiplier) / p.mgsnProjected;

    flatHistory.push({ label: p.period, invested: flatInvested, value: flatTokens * p.mgsnProjected });
    sigHistory.push({  label: p.period, invested: sigInvested,  value: sigTokens  * p.mgsnProjected });
    lumpHistory.push({ label: p.period, invested: totalBudget,  value: lumpTokens * p.mgsnProjected });
  }

  return {
    flatHistory, sigHistory, lumpHistory,
    flat:   { tokens: flatTokens, invested: flatInvested, value: flatHistory.at(-1).value,   roi: pct(flatInvested, flatHistory.at(-1).value) },
    signal: { tokens: sigTokens,  invested: sigInvested,  value: sigHistory.at(-1).value,    roi: pct(sigInvested,  sigHistory.at(-1).value) },
    lump:   { tokens: lumpTokens, invested: totalBudget,  value: lumpHistory.at(-1).value,   roi: pct(totalBudget,  lumpHistory.at(-1).value) },
    projectedNow: projected.at(-1).mgsnProjected,
  };
}

// ── LP Yield Estimator + Compound Projector ───────────────────────────────────

function estimateLPYield(mgsnUsd, icpUsd, totalDepositUsd, dashboard, livePoolStats = {}) {
  const realVols = dashboard.timeline.map((p) => p.bobVolume).filter((v) => v > 0);
  const avgBobMonthlyVol = realVols.length
    ? realVols.reduce((a, b) => a + b, 0) / realVols.length
    : 3_000_000;

  // Use live pool stats if available, otherwise estimate from BOB proxy
  const liveVol = livePoolStats.mgsnVol30d ?? (livePoolStats.mgsnVol24h ? livePoolStats.mgsnVol24h * 30 : null);
  const liveLiq  = livePoolStats.mgsnLiq ?? null;
  const estPoolTvl  = liveLiq ?? 30_000;
  const baseVolume  = liveVol ?? (avgBobMonthlyVol * MGSN_VOL_SHARE);

  const cons_vol = baseVolume * 0.4;
  const opti_vol = baseVolume * 3;
  const userShare = totalDepositUsd / (estPoolTvl + totalDepositUsd);

  function annualFees(mv) { return mv * POOL_FEE * 12 * userShare; }
  const feesCons = annualFees(cons_vol);
  const feesBase = annualFees(baseVolume);
  const feesOpti = annualFees(opti_vol);

  function il(r) {
    if (r <= 0) return -100;
    return ((2 * Math.sqrt(r) / (1 + r)) - 1) * 100;
  }

  // LP compound projection: reinvest base fee monthly for N months
  function compoundProjection(depositUsd, months, monthlyFee) {
    let total = depositUsd;
    const history = [];
    for (let m = 0; m < months; m++) {
      // Earning from current position + reinvested fees
      const earned = total * (monthlyFee / depositUsd);
      total += earned;
      history.push({ month: m + 1, total, earned });
    }
    return history;
  }

  const monthlyBase = feesBase / 12;
  const compound12  = compoundProjection(totalDepositUsd, 12, monthlyBase);
  const compound24  = compoundProjection(totalDepositUsd, 24, monthlyBase);
  const compound36  = compoundProjection(totalDepositUsd, 36, monthlyBase);

  return {
    apr:     { conservative: totalDepositUsd > 0 ? (feesCons / totalDepositUsd) * 100 : 0,
               base:         totalDepositUsd > 0 ? (feesBase / totalDepositUsd) * 100 : 0,
               optimistic:   totalDepositUsd > 0 ? (feesOpti / totalDepositUsd) * 100 : 0 },
    monthly: { conservative: feesCons / 12, base: monthlyBase, optimistic: feesOpti / 12 },
    il:      { minus75: il(0.25), minus50: il(0.50), neutral: 0, plus100: il(2.0), plus300: il(4.0) },
    userShare: userShare * 100,
    compound12, compound24, compound36,
    liveDataUsed: !!(livePoolStats.mgsnVol30d ?? livePoolStats.mgsnVol24h),
    volumeEstimated: livePoolStats.mgsnVol30d == null && livePoolStats.mgsnVol24h == null,
    liquidityEstimated: livePoolStats.mgsnLiq == null,
  };
}

// ── Portfolio P&L Tracker ─────────────────────────────────────────────────────

function computePortfolioPnl(holdings, avgCostUsd, currentMgsnUsd, btProjectedNow) {
  if (!holdings || holdings <= 0) return null;
  const cost        = holdings * avgCostUsd;
  const valueNow    = holdings * currentMgsnUsd;
  const unrealised  = valueNow - cost;
  const unrealisedPct = pct(cost, valueNow);
  const projValue   = holdings * btProjectedNow;

  // Price targets
  const targets = [0.0001, 0.001, 0.01, 0.1].map((p) => ({
    price: p, value: holdings * p, gain: pct(cost, holdings * p),
  }));

  return { holdings, avgCostUsd, cost, valueNow, unrealised, unrealisedPct, targets, projValue };
}

// ── Arbitrage Detector ────────────────────────────────────────────────────────
/**
 * Detects price discrepancies between the ICPSwap NodeIndex live price and
 * the BOB-correlated projected price. A meaningful gap (>10%) is an opportunity.
 */
function computeArbitrageScore(mgsnLive, mgsnProjected, mgsnHistorical) {
  if (!mgsnLive || !mgsnProjected) {
    return { available: false, note: "Live ICPSwap price not yet fetched — connect to mainnet to enable." };
  }
  const spreadVsProj = pct(mgsnProjected, mgsnLive);   // live vs BOB-implied
  const spreadVsHist = pct(mgsnHistorical, mgsnLive);  // live vs historical avg
  const abs = Math.abs(spreadVsProj);

  let opportunity, color, action;
  if (spreadVsProj < -20) {
    opportunity = "BUY SIGNAL";   color = "pos";
    action = `MGSN trades ${spreadVsProj.toFixed(1)}% below BOB-implied price. Buy on ICPSwap now.`;
  } else if (spreadVsProj > 20) {
    opportunity = "SELL / LP";    color = "neg";
    action = `MGSN trades ${spreadVsProj.toFixed(1)}% above BOB-implied price. Consider LP or partial exit.`;
  } else {
    opportunity = "FAIRLY PRICED"; color = "";
    action = `Spread vs BOB-implied: ${spreadVsProj.toFixed(1)}%. No major arbitrage gap.`;
  }

  return {
    available: true,
    mgsnLive, mgsnProjected, mgsnHistorical,
    spreadVsProj, spreadVsHist, abs,
    opportunity, color, action,
  };
}

// ── Alert Builder ─────────────────────────────────────────────────────────────

function buildAlerts(sig, bt, portfolio) {
  const alerts = [];

  if (sig.composite >= 75)
    alerts.push({ level: "high", icon: "🔥", text: `STRONG BUY — all 6 signals aligned. Use ${(sig.kelly.fraction * 100).toFixed(1)}% Kelly position sizing.` });
  else if (sig.composite >= 62)
    alerts.push({ level: "high", icon: "⬆", text: `BUY signal active. Next DCA window: add ${(sig.kelly.fraction * 100).toFixed(1)}% of liquid capital to MGSN.` });

  if (sig.rsi.value < 35)
    alerts.push({ level: "high", icon: "📉", text: `BOB RSI at ${sig.rsi.value.toFixed(1)} — below 35, historically the optimal MGSN accumulation zone.` });

  if (sig.macd.hist < 0 && sig.macd.trend > 0)
    alerts.push({ level: "med", icon: "↗", text: "MACD histogram turning positive from below zero — early upside divergence on BOB." });

  if (sig.bb.pctB < 0.15)
    alerts.push({ level: "high", icon: "⬡", text: `Bollinger %B at ${(sig.bb.pctB * 100).toFixed(1)}% — BOB near lower band. Historically high-probability reversal.` });

  if (sig.nav.ratio < sig.nav.avg * 0.6)
    alerts.push({ level: "med", icon: "◈", text: `mNAV at ${sig.nav.ratio.toFixed(4)}× — ${((1 - sig.nav.ratio / sig.nav.avg) * 100).toFixed(0)}% below historical avg. Deep discount.` });

  if (portfolio?.unrealisedPct !== undefined && portfolio.unrealisedPct < -30)
    alerts.push({ level: "med", icon: "⚠", text: `Portfolio down ${portfolio.unrealisedPct.toFixed(1)}%. Current signal: ${sig.action}. DCA lower to reduce average cost.` });

  if (alerts.length === 0)
    alerts.push({ level: "low", icon: "–", text: "No high-priority alerts. Signals are neutral — hold existing position and await next signal." });

  return alerts;
}

// ── Chart helpers ─────────────────────────────────────────────────────────────

function baseOpts(yFmt = (v) => v) {
  return {
    responsive: false,
    maintainAspectRatio: false,
    animation: false,
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
        ticks: { color: C.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 }, callback: yFmt },
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

function sizeCanvas(id, w, h) {
  const el = document.getElementById(`chart-${id}`);
  if (!el) return;
  el.width = w; el.height = h;
  el.style.width = w + "px"; el.style.height = h + "px";
}

function chartW(id, fallback = 700) {
  return Math.max((document.getElementById(`chart-${id}`)?.parentElement?.clientWidth ?? fallback) - 36, 280);
}

// ── Chart: DCA Backtest ────────────────────────────────────────────────────────

function renderBacktestChart(bt) {
  const labels = bt.flatHistory.map((d) => d.label.split(" ")[0]);
  const w = chartW("backtest");
  sizeCanvas("backtest", w, 300);
  const opts = baseOpts((v) => compactMoney(v));
  opts.plugins.tooltip.callbacks = { label: (ctx) => ` ${ctx.dataset.label}: ${compactMoney(ctx.raw)}` };
  opts.plugins.legend = { display: true, position: "top",
    labels: { color: C.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 }, boxWidth: 12, padding: 16 } };
  mkChart("backtest", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Signal DCA",    data: bt.sigHistory.map((d) => d.value),    borderColor: C.mgsn, borderWidth: 2.5, pointRadius: 0, fill: true, backgroundColor: C.mgsnFill, tension: 0.35 },
        { label: "Flat DCA",      data: bt.flatHistory.map((d) => d.value),   borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.35 },
        { label: "Lump Sum",      data: bt.lumpHistory.map((d) => d.value),   borderColor: C.gold, borderWidth: 1.5, pointRadius: 0, borderDash: [5, 3], tension: 0.35 },
        { label: "Invested",      data: bt.sigHistory.map((d) => d.invested), borderColor: C.neutral, borderWidth: 1, pointRadius: 0, borderDash: [3, 4] },
      ],
    },
    options: opts,
  });
}

// ── Chart: RSI ────────────────────────────────────────────────────────────────

function renderRsiChart(sig, timeline) {
  const labels  = timeline.map((p) => p.period.split(" ")[0]);
  const rsiVals = sig.bobRsiSeries.map((v) => (v !== null ? +v.toFixed(1) : null));
  sizeCanvas("rsi", chartW("rsi"), 200);
  const opts = baseOpts((v) => `${v.toFixed(0)}`);
  opts.scales.y.min = 0; opts.scales.y.max = 100;
  opts.plugins.tooltip.callbacks = { label: (ctx) => ctx.raw !== null ? ` RSI: ${ctx.raw.toFixed(1)}` : null };
  mkChart("rsi", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { type: "bar", label: "RSI(5)", data: rsiVals,
          backgroundColor: rsiVals.map((v) => v === null ? "transparent" : v < 40 ? "rgba(34,197,94,0.6)" : v > 60 ? "rgba(239,68,68,0.6)" : "rgba(99,102,241,0.5)"),
          borderRadius: 2, spanGaps: true },
        { type: "line", label: "Buy (40)",  data: rsiVals.map(() => 40),  borderColor: "rgba(34,197,94,0.35)", borderWidth: 1, pointRadius: 0, borderDash: [6, 3] },
        { type: "line", label: "Sell (60)", data: rsiVals.map(() => 60),  borderColor: "rgba(239,68,68,0.35)", borderWidth: 1, pointRadius: 0, borderDash: [6, 3] },
      ],
    },
    options: opts,
  });
}

// ── Chart: MACD ───────────────────────────────────────────────────────────────

function renderMacdChart(sig, timeline) {
  const labels   = timeline.map((p) => p.period.split(" ")[0]);
  const { macd, signal: sigLine, hist } = sig.macdData;
  sizeCanvas("macd", chartW("macd"), 200);
  const opts = baseOpts((v) => v.toFixed(4));
  opts.plugins.tooltip.callbacks = { label: (ctx) => ctx.raw !== null ? ` ${ctx.dataset.label}: ${ctx.raw.toFixed(5)}` : null };
  mkChart("macd", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { type: "bar",  label: "Histogram", data: hist,    backgroundColor: hist.map((v) => v === null ? "transparent" : v >= 0 ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)"), borderRadius: 2, spanGaps: true },
        { type: "line", label: "MACD line", data: macd,    borderColor: C.mgsn,  borderWidth: 1.5, pointRadius: 0, tension: 0.35, spanGaps: true },
        { type: "line", label: "Signal",    data: sigLine, borderColor: C.gold,  borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3], tension: 0.35, spanGaps: true },
      ],
    },
    options: opts,
  });
}

// ── Chart: Bollinger Bands ───────────────────────────────────────────────────

function renderBollingerChart(sig, timeline) {
  const labels = timeline.map((p) => p.period.split(" ")[0]);
  const bob    = timeline.map((p) => p.bobPrice);
  const upper  = sig.bbData.map((b) => b.upper);
  const mid    = sig.bbData.map((b) => b.mid);
  const lower  = sig.bbData.map((b) => b.lower);
  sizeCanvas("bb", chartW("bb"), 200);
  const opts = baseOpts((v) => fmt(v, 3));
  opts.plugins.tooltip.callbacks = { label: (ctx) => ctx.raw !== null ? ` ${ctx.dataset.label}: ${fmt(ctx.raw, 4)}` : null };
  mkChart("bb", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Upper Band", data: upper, borderColor: "rgba(249,115,22,0.35)", borderWidth: 1, pointRadius: 0, spanGaps: true, fill: false },
        { label: "Mid SMA",    data: mid,   borderColor: C.gold, borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3], spanGaps: true, fill: false },
        { label: "Lower Band", data: lower, borderColor: "rgba(59,130,246,0.35)", borderWidth: 1, pointRadius: 0, spanGaps: true, fill: false },
        { label: "BOB price",  data: bob,   borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.35 },
      ],
    },
    options: opts,
  });
}

// ── Chart: LP Compound Projection ────────────────────────────────────────────

function renderCompoundChart(lp) {
  const labels12 = lp.compound12.map((d) => `M${d.month}`);
  sizeCanvas("compound", chartW("compound"), 200);
  const opts = baseOpts((v) => compactMoney(v));
  opts.plugins.tooltip.callbacks = { label: (ctx) => ` ${ctx.dataset.label}: ${compactMoney(ctx.raw)}` };
  opts.plugins.legend = { display: true, position: "top",
    labels: { color: C.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 }, boxWidth: 12, padding: 12 } };
  const depositVal = document.getElementById("lp-deposit") ? parseFloat(document.getElementById("lp-deposit").value) || 500 : 500;
  mkChart("compound", {
    type: "line",
    data: {
      labels: labels12,
      datasets: [
        { label: "Compounded LP",  data: lp.compound12.map((d) => d.total),    borderColor: C.pos, borderWidth: 2.5, pointRadius: 2, fill: true, backgroundColor: C.posFill, tension: 0.35 },
        { label: "No-compound",    data: lp.compound12.map(() => depositVal),  borderColor: C.neutral, borderWidth: 1, pointRadius: 0, borderDash: [4, 4] },
      ],
    },
    options: opts,
  });
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function signalCard(title, label, score, note, colorClass) {
  return `
    <div class="s-signal-card">
      <div class="s-signal-card-head">
        <span class="s-signal-card-title">${title}</span>
        <span class="s-signal-label ${colorClass}">${label}</span>
      </div>
      <div class="s-score-bar"><div class="s-score-fill ${colorClass}" style="width:${Math.round(score)}%"></div></div>
      <p class="s-signal-note">${note}</p>
    </div>`;
}

function signalColorClass(score) {
  if (score >= 70) return "sig-buy";
  if (score >= 50) return "sig-neutral";
  return "sig-sell";
}

function dcaRow(label, val, cls = "") {
  return `<div class="s-calc-row"><span class="s-calc-label">${label}</span><span class="s-calc-val ${cls}">${val}</span></div>`;
}

// ── Main HTML builder ─────────────────────────────────────────────────────────

function buildHTML(dashboard, sig, bt, lp, arb, alerts, portfolio, scenarioHeaderHtml) {
  const icpVal  = sig.icpNow ? `$${sig.icpNow.toFixed(2)}` : "—";
  const icpCls  = liveIcpUsd ? "live" : "";
  const compBar = Math.round(sig.composite);

  const alertsHTML = alerts.map((a) => `
    <div class="s-alert s-alert--${a.level}">
      <span class="s-alert-icon">${a.icon}</span>
      <span class="s-alert-text">${a.text}</span>
    </div>`).join("");

  const arbSection = arb.available ? `
    <div class="s-arb-result">
      <div class="s-arb-label">Opportunity</div>
      <div class="s-arb-oppty ${arb.color}">${arb.opportunity}</div>
      <p class="s-arb-action">${arb.action}</p>
      <div class="s-arb-meta">
        <div class="s-arb-meta-item"><span>ICPSwap live</span><span class="mgsn">${fmt(arb.mgsnLive, 7)}</span></div>
        <div class="s-arb-meta-item"><span>BOB-implied</span><span class="bob">${fmt(arb.mgsnProjected, 7)}</span></div>
        <div class="s-arb-meta-item"><span>Spread</span><span class="${arb.spreadVsProj < 0 ? "pos" : "neg"}">${arb.spreadVsProj.toFixed(1)}%</span></div>
      </div>
    </div>` : `<p class="s-section-sub" style="padding:12px 0">${arb.note}</p>`;

  const kellyHTML = `
    <div class="s-kelly-card">
      <div class="s-kelly-fraction">${(sig.kelly.fraction * 100).toFixed(1)}%</div>
      <div class="s-kelly-label">Quarter-Kelly position size</div>
      <p class="s-kelly-note">${sig.kelly.note}</p>
      <div class="s-kelly-meta">
        <div><span>Full Kelly</span><span>${(sig.kelly.fullKelly * 100).toFixed(1)}%</span></div>
        <div><span>Applied (1/4)</span><span class="pos">${(sig.kelly.fraction * 100).toFixed(1)}%</span></div>
      </div>
    </div>`;

  const portfolioSection = portfolio ? `
    <div class="s-port-grid">
      <div class="s-port-stat"><span class="s-port-label">Holdings</span><span class="s-port-val mgsn">${compact(portfolio.holdings)} MGSN</span></div>
      <div class="s-port-stat"><span class="s-port-label">Avg Cost</span><span class="s-port-val">${fmt(portfolio.avgCostUsd, 7)}</span></div>
      <div class="s-port-stat"><span class="s-port-label">Total Cost</span><span class="s-port-val">${fmt(portfolio.cost)}</span></div>
      <div class="s-port-stat"><span class="s-port-label">Value Now</span><span class="s-port-val">${fmt(portfolio.valueNow)}</span></div>
      <div class="s-port-stat"><span class="s-port-label">Unrealised P&L</span>
        <span class="s-port-val ${portfolio.unrealised >= 0 ? "pos" : "neg"}">${portfolio.unrealised >= 0 ? "+" : ""}${fmt(portfolio.unrealised)} (${pctFmt(portfolio.unrealisedPct)})</span></div>
    </div>
    <div class="s-port-targets">
      <span class="s-calc-section-label">Price target scenarios</span>
      ${portfolio.targets.map((t) => `
        <div class="s-port-target-row">
          <span class="s-sched-month">${fmt(t.price, t.price < 0.001 ? 7 : 4)}</span>
          <span class="s-port-target-val">${fmt(t.value)}</span>
          <span class="s-sched-mult ${t.gain > 0 ? "sig-buy" : "sig-sell"}">${pctFmt(t.gain, 0)}</span>
        </div>`).join("")}
    </div>` : `
    <p class="s-section-sub">Enter your MGSN holdings below to see P&L and price targets.</p>`;

  return `
    ${buildPlatformHeaderHTML({
      activePage: "strategy",
      badgeText: "Live signals",
      priceLabel: "ICP/USD",
      priceValue: icpVal,
      priceId: "s-icp-price",
      priceClass: icpCls,
    })}

    <div class="s-page">
      ${scenarioHeaderHtml}

      <!-- Alert board -->
      <section class="s-section" style="padding-top:20px">
        <div class="s-alert-board">${alertsHTML}</div>
      </section>

      <!-- Hero -->
      <section class="s-hero">
        <div class="s-hero-left">
          <div class="s-hero-eyebrow">MGSN Autonomous Strategy Engine | 6-factor composite</div>
          <div class="s-hero-signal ${sig.actionClass}">${sig.action}</div>
          <p class="s-hero-note">${sig.actionNote}</p>
          <div class="s-hero-meta">
            <div class="s-hero-meta-item"><span class="s-hero-meta-label">Score</span><span class="s-hero-meta-val">${sig.composite.toFixed(0)}/100</span></div>
            <div class="s-hero-meta-item"><span class="s-hero-meta-label">Confidence</span><span class="s-hero-meta-val">${sig.confidence}</span></div>
            <div class="s-hero-meta-item"><span class="s-hero-meta-label">MGSN</span><span class="s-hero-meta-val mgsn" id="s-mgsn-price">${fmt(sig.mgsnNow, 6)}</span></div>
            <div class="s-hero-meta-item"><span class="s-hero-meta-label">BOB</span><span class="s-hero-meta-val bob" id="s-bob-price">${fmt(sig.bobNow, 4)}</span></div>
            <div class="s-hero-meta-item"><span class="s-hero-meta-label">Kelly Size</span><span class="s-hero-meta-val pos">${(sig.kelly.fraction * 100).toFixed(1)}%</span></div>
          </div>
          <div class="s-composite-bar-wrap">
            <div class="s-composite-bar"><div class="s-composite-fill ${sig.actionClass}" style="width:${compBar}%"></div></div>
            <span class="s-composite-labels"><span>Sell</span><span>Hold</span><span>Accum.</span><span>Buy</span><span>Strong Buy</span></span>
          </div>
        </div>
        <div class="s-hero-right">
          <div class="s-cta-block">
            <p class="s-cta-label">Execute on ICPSwap</p>
            <a class="s-cta-btn s-cta-primary" href="${ICPSWAP_SWAP_URL}" target="_blank" rel="noopener noreferrer">Buy MGSN →</a>
            <a class="s-cta-btn s-cta-secondary" href="${ICPSWAP_LP_URL}" target="_blank" rel="noopener noreferrer">Add Liquidity</a>
            <a class="s-cta-btn s-cta-secondary" href="${ICPSWAP_INFO_MGSN}" target="_blank" rel="noopener noreferrer">View MGSN on ICPSwap</a>
            <button id="share-signal-btn" class="s-cta-btn s-cta-secondary">&#128203; Copy Signal</button>
            <p class="s-cta-disclaimer">Executes on ICPSwap DEX. You control your keys. Not financial advice.</p>
          </div>
        </div>
      </section>

      <!-- 6-Signal breakdown -->
      <section class="s-section">
        <h3 class="s-section-title">Signal Breakdown — 6 Factors</h3>
        <div class="s-signal-grid">
          ${signalCard("BOB RSI (5-month)",     sig.rsi.label,    sig.rsi.score,    sig.rsi.note,    signalColorClass(sig.rsi.score))}
          ${signalCard("BOB SMA Crossover",     sig.sma.label,    sig.sma.score,    sig.sma.note,    signalColorClass(sig.sma.score))}
          ${signalCard("MACD on BOB",           sig.macd.label,   sig.macd.score,   sig.macd.note,   signalColorClass(sig.macd.score))}
          ${signalCard("Bollinger %B",          sig.bb.label,     sig.bb.score,     sig.bb.note,     signalColorClass(sig.bb.score))}
          ${signalCard("mNAV Ratio",            sig.nav.label,    sig.nav.score,    sig.nav.note,    signalColorClass(sig.nav.score))}
          ${signalCard("MGSN/ICP Cost Basis",   sig.icpVal.label, sig.icpVal.score, sig.icpVal.note, signalColorClass(sig.icpVal.score))}
        </div>
      </section>

      <!-- Kelly Criterion -->
      <section class="s-section">
        <h3 class="s-section-title">Kelly Criterion — Optimal Position Sizing</h3>
        <p class="s-section-sub">Quarter-Kelly fraction — mathematically maximises long-run capital growth from the BOB 22-month win/loss distribution.</p>
        ${kellyHTML}
      </section>

      <!-- Arbitrage detector -->
      <section class="s-section">
        <h3 class="s-section-title">Price Arbitrage Detector</h3>
        <p class="s-section-sub">Compares ICPSwap NodeIndex live MGSN price against BOB-correlated implied value. Gaps &gt;10% are actionable.</p>
        ${arbSection}
      </section>

      <!-- Market charts (3 panels) -->
      <section class="s-section">
        <h3 class="s-section-title">Technical Context — BOB Ecosystem</h3>
        <div class="s-charts-row">
          <div class="s-chart-panel">
            <div class="s-chart-head"><span class="s-chart-title">RSI (5-period)</span><span class="s-chart-sub">Green &lt;40 = buy, red &gt;60 = sell</span></div>
            <div class="s-chart-wrap" style="height:200px"><canvas id="chart-rsi"></canvas></div>
          </div>
          <div class="s-chart-panel">
            <div class="s-chart-head"><span class="s-chart-title">MACD (3/8/5 monthly)</span><span class="s-chart-sub">Histogram turning green = early reversal signal</span></div>
            <div class="s-chart-wrap" style="height:200px"><canvas id="chart-macd"></canvas></div>
          </div>
        </div>
        <div class="s-charts-row" style="margin-top:12px">
          <div class="s-chart-panel">
            <div class="s-chart-head"><span class="s-chart-title">Bollinger Bands (8-period, 2σ)</span><span class="s-chart-sub">Price near lower band = buy zone</span></div>
            <div class="s-chart-wrap" style="height:200px"><canvas id="chart-bb"></canvas></div>
          </div>
          <div class="s-chart-panel">
            <div class="s-chart-head"><span class="s-chart-title">SMA Crossover (3m fast / 8m slow)</span><span class="s-chart-sub">Orange crosses below yellow = accumulate</span></div>
            <div class="s-chart-wrap" style="height:200px"><canvas id="chart-sma"></canvas></div>
          </div>
        </div>
      </section>

      <!-- Backtest -->
      <section class="s-section">
        <h3 class="s-section-title">Strategy Backtest — Signal DCA vs Flat DCA vs Lump Sum</h3>
        <p class="s-section-sub">Signal DCA uses 4-factor multiplier (RSI + SMA + MACD + BB). MGSN price projected from BOB price correlation.</p>
        <div class="s-chart-panel">
          <div class="s-chart-wrap" style="height:300px"><canvas id="chart-backtest"></canvas></div>
          <div class="s-backtest-stats">
            <div class="s-stat-group"><span class="s-stat-label">Signal DCA</span><span class="s-stat-val mgsn">${fmt(bt.signal.value)}</span><span class="s-stat-sub">${pctFmt(bt.signal.roi)} ROI | ${compactMoney(bt.signal.invested)} invested</span></div>
            <div class="s-stat-group"><span class="s-stat-label">Flat DCA</span><span class="s-stat-val bob">${fmt(bt.flat.value)}</span><span class="s-stat-sub">${pctFmt(bt.flat.roi)} ROI | ${compactMoney(bt.flat.invested)} invested</span></div>
            <div class="s-stat-group"><span class="s-stat-label">Lump Sum</span><span class="s-stat-val gold">${fmt(bt.lump.value)}</span><span class="s-stat-sub">${pctFmt(bt.lump.roi)} ROI | ${compactMoney(bt.lump.invested)} upfront</span></div>
            <div class="s-stat-group"><span class="s-stat-label">Projected MGSN</span><span class="s-stat-val">${fmt(bt.projectedNow, 7)}</span><span class="s-stat-sub">BOB-correlated price</span></div>
          </div>
        </div>
      </section>

      <!-- DCA calculator -->
      <section class="s-section">
        <h3 class="s-section-title">DCA Accumulation Calculator</h3>
        <p class="s-section-sub">Adaptive multiplier: 0.25×–2.5× based on live composite signal strength.</p>
        <div class="s-calc-grid">
          <div class="s-calc-card">
            <label class="s-input-label">Monthly Budget (USD)</label>
            <input id="dca-budget" type="number" class="s-input" value="100" min="1" max="100000" step="10" />
            <label class="s-input-label" style="margin-top:14px">Strategy</label>
            <select id="dca-strategy" class="s-input">
              <option value="signal">Signal DCA (adaptive)</option>
              <option value="flat">Flat DCA (fixed)</option>
            </select>
            <label class="s-input-label" style="margin-top:14px">Price Target Scenario</label>
            <select id="dca-scenario" class="s-input">
              <option value="0.0001">MGSN = $0.0001 (7× off current)</option>
              <option value="0.001">MGSN = $0.001 (71× — BOB parity era)</option>
              <option value="0.01">MGSN = $0.01 (715× — bull case)</option>
              <option value="0.0000140">MGSN = $0.0000140 (flat)</option>
            </select>
            <div id="dca-results" class="s-calc-results"></div>
          </div>
          <div class="s-calc-card s-dca-schedule">
            <span class="s-calc-section-label">12-Month Schedule</span>
            <div id="dca-schedule"></div>
          </div>
        </div>
      </section>

      <!-- Portfolio P&L tracker -->
      <section class="s-section">
        <h3 class="s-section-title">Portfolio P&L Tracker</h3>
        <p class="s-section-sub">Track your MGSN position against current price and target scenarios.</p>
        <div class="s-calc-grid">
          <div class="s-calc-card">
            <label class="s-input-label">MGSN Holdings (tokens)</label>
            <input id="port-holdings" type="number" class="s-input" value="1000000" min="0" step="100000" />
            <label class="s-input-label" style="margin-top:14px">Avg Buy Price (USD)</label>
            <input id="port-avgcost" type="number" class="s-input" value="0.0000140" min="0" step="0.000001" />
            <div id="port-results" class="s-calc-results"></div>
          </div>
          <div class="s-calc-card" id="port-targets-card">
            ${portfolioSection}
          </div>
        </div>
      </section>

      <!-- LP yield + compound -->
      <section class="s-section">
        <h3 class="s-section-title">LP Yield Calculator + Compound Projector</h3>
        <p class="s-section-sub">ICPSwap MGSN/ICP pool | 0.3% fee tier | fee income compounded monthly.</p>
        <div class="s-calc-grid">
          <div class="s-calc-card">
            <label class="s-input-label">Total Deposit Value (USD)</label>
            <input id="lp-deposit" type="number" class="s-input" value="500" min="1" step="50" />
            <p class="s-lp-note">Split equally: 50% ICP + 50% MGSN</p>
            <div id="lp-results" class="s-calc-results"></div>
          </div>
          <div class="s-calc-card">
            <span class="s-calc-section-label">12-Month Fee Compounding</span>
            <div class="s-chart-wrap" style="height:200px"><canvas id="chart-compound"></canvas></div>
          </div>
        </div>
        <div class="s-calc-grid" style="margin-top:12px">
          <div class="s-calc-card">
            <span class="s-calc-section-label">Impermanent Loss Reference</span>
            <table class="s-il-table">
              <thead><tr><th>MGSN/ICP change</th><th>IL</th></tr></thead>
              <tbody id="il-table-body"></tbody>
            </table>
          </div>
          <div class="s-calc-card">
            <span class="s-calc-section-label">Compound Growth Milestones</span>
            <div id="compound-milestones"></div>
            <a class="s-cta-btn s-cta-secondary" style="margin-top:14px;display:block;text-align:center" href="${ICPSWAP_LP_URL}" target="_blank" rel="noopener noreferrer">Add Liquidity on ICPSwap →</a>
          </div>
        </div>
      </section>

      <div class="page-footer" style="padding:24px 0 60px">
        <p>Signals are informational only and do not constitute financial advice.</p>
        <p style="margin-top:4px">Powered by <a href="https://icpswap.com" target="_blank" rel="noopener noreferrer">ICPSwap</a> | Spot and pool stats from the official ICPSwap data API</p>
      </div>
    </div>`;
}

function buildUnavailableHTML(prices, livePoolStats, scenarioHeaderHtml) {
  const volume30d = livePoolStats?.mgsnVol30d ?? (livePoolStats?.mgsnVol24h ? livePoolStats.mgsnVol24h * 30 : null);
  return `
    ${buildPlatformHeaderHTML({
      activePage: "strategy",
      badgeText: "Live signals",
      priceLabel: "ICP/USD",
      priceValue: prices.icpUsd ? `$${prices.icpUsd.toFixed(2)}` : "—",
      priceId: "s-icp-price",
      priceClass: prices.icpUsd ? "live" : "",
    })}

    <div class="s-page">
      ${scenarioHeaderHtml}

      <section class="s-section" style="padding-top:20px">
        <div class="s-calc-card">
          <span class="s-calc-section-label">Strategy feed unavailable</span>
          <h2 class="main-title" style="margin:0 0 10px">Live market history is unavailable</h2>
          <p class="main-subtitle" style="max-width:780px">The strategy engine only scores live ICPSwap market history. It does not synthesize composite signals, backtests, or arbitrage scores from bundled snapshots. Refresh this page once overlapping MGSN and BOB history is available again.</p>
          <div class="s-port-grid" style="margin-top:16px">
            <div class="s-port-stat"><span class="s-port-label">MGSN spot</span><span class="s-port-val mgsn">${prices.mgsnUsd ? fmt(prices.mgsnUsd, 7) : "—"}</span></div>
            <div class="s-port-stat"><span class="s-port-label">BOB spot</span><span class="s-port-val">${prices.bobUsd ? fmt(prices.bobUsd, 4) : "—"}</span></div>
            <div class="s-port-stat"><span class="s-port-label">ICP spot</span><span class="s-port-val">${prices.icpUsd ? fmt(prices.icpUsd, 2) : "—"}</span></div>
            <div class="s-port-stat"><span class="s-port-label">MGSN 30d volume</span><span class="s-port-val">${volume30d != null ? compactMoney(volume30d) : "Unavailable"}</span></div>
            <div class="s-port-stat"><span class="s-port-label">Pool liquidity</span><span class="s-port-val">${livePoolStats?.mgsnLiq != null ? compactMoney(livePoolStats.mgsnLiq) : "Unavailable"}</span></div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
            <a class="s-cta-btn s-cta-primary" href="${ICPSWAP_SWAP_URL}" target="_blank" rel="noopener noreferrer">Buy MGSN →</a>
            <a class="s-cta-btn s-cta-secondary" href="${ICPSWAP_LP_URL}" target="_blank" rel="noopener noreferrer">Add Liquidity</a>
            <a class="s-cta-btn s-cta-secondary" href="${ICPSWAP_INFO_MGSN}" target="_blank" rel="noopener noreferrer">View MGSN on ICPSwap</a>
          </div>
        </div>
      </section>

      <div class="page-footer" style="padding:24px 0 60px">
        <p>The strategy engine resumes automatically when live ICPSwap history is available again.</p>
        <p style="margin-top:4px">Powered by <a href="https://icpswap.com" target="_blank" rel="noopener noreferrer">ICPSwap</a> | No bundled market snapshot is shown here.</p>
      </div>
    </div>`;
}

// ── DCA calculator logic ──────────────────────────────────────────────────────

function buildDCASchedule(budget, strategy, sig, dashboard) {
  const mgsnNow   = sig.mgsnNow;
  const bobPrices = dashboard.timeline.map((p) => p.bobPrice);
  const lastRsi   = rsiSeries(bobPrices, 5).filter((v) => v !== null).at(-1) ?? 50;
  const lastFast  = sma(bobPrices, 3).at(-1);
  const lastSlow  = sma(bobPrices, 8).at(-1);
  const months    = ["May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr"];
  let totalTokens = 0, totalInvested = 0;
  const rows = [];

  for (let i = 0; i < 12; i++) {
    let multiplier = 1;
    if (strategy === "signal") {
      const rsi  = i === 0 ? lastRsi  : 50;
      const fast = i === 0 ? lastFast : null;
      const slow = i === 0 ? lastSlow : null;
      const rsiSig = rsi < 35 ? 2 : rsi < 50 ? 1.5 : rsi > 65 ? 0.5 : 1;
      const smaSig = fast !== null && slow !== null
        ? (((fast - slow) / slow) * 100 < -10 ? 2 : ((fast - slow) / slow) * 100 < 0 ? 1.5 : 1)
        : 1;
      multiplier = Math.min(Math.max(rsiSig * 0.5 + smaSig * 0.5, 0.25), 2.5);
    }
    const alloc = budget * multiplier;
    const acquired = alloc / mgsnNow;
    totalTokens   += acquired;
    totalInvested += alloc;
    rows.push({ month: months[i % 12], alloc, multiplier, tokensAcq: acquired, cumTokens: totalTokens });
  }
  return { rows, totalTokens, totalInvested };
}

function renderDCACalc(sig, dashboard) {
  const budget   = parseFloat(document.getElementById("dca-budget")?.value) || 100;
  const strategy = document.getElementById("dca-strategy")?.value || "signal";
  const targetP  = parseFloat(document.getElementById("dca-scenario")?.value) || 0.0001;
  const sched    = buildDCASchedule(budget, strategy, sig, dashboard);
  const curVal   = sched.totalTokens * sig.mgsnNow;
  const targVal  = sched.totalTokens * targetP;
  const roi      = pct(sched.totalInvested, targVal);

  const el = document.getElementById("dca-results");
  const sEl = document.getElementById("dca-schedule");
  if (!el || !sEl) return;

  el.innerHTML = `<div class="s-calc-divider"></div>
    ${dcaRow("Total invested 12-mo", compactMoney(sched.totalInvested))}
    ${dcaRow("MGSN accumulated", compact(sched.totalTokens) + " MGSN", "mgsn")}
    ${dcaRow("Value at current price", fmt(curVal))}
    ${dcaRow("Value at target", fmt(targVal), roi >= 0 ? "pos" : "neg")}
    ${dcaRow("ROI at target", pctFmt(roi), roi >= 0 ? "pos" : "neg")}`;

  sEl.innerHTML = sched.rows.map((r, i) => `
    <div class="s-sched-row ${i === 0 ? "current" : ""}">
      <span class="s-sched-month">${r.month}${i === 0 ? "←" : ""}</span>
      <span class="s-sched-alloc">${compactMoney(r.alloc)}</span>
      <span class="s-sched-mult ${r.multiplier >= 1.5 ? "sig-buy" : r.multiplier <= 0.5 ? "sig-sell" : "sig-neutral"}">${r.multiplier.toFixed(2)}×</span>
      <span class="s-sched-tokens">${compact(r.tokensAcq)} MGSN</span>
    </div>`).join("");
}

function renderLPCalc(sig, dashboard, livePoolStats = {}) {
  const deposit = parseFloat(document.getElementById("lp-deposit")?.value) || 500;
  const lp      = estimateLPYield(sig.mgsnNow, sig.icpNow, deposit, dashboard, livePoolStats);

  const resEl = document.getElementById("lp-results");
  const ilEl  = document.getElementById("il-table-body");
  const msEl  = document.getElementById("compound-milestones");
  if (!resEl || !ilEl) return;

    resEl.innerHTML = `<div class="s-calc-divider"></div>
    ${dcaRow("Est. pool share", lp.userShare.toFixed(2) + "%")}
    ${lp.liveDataUsed ? dcaRow("Data source", "ICPSwap real volume history", "pos") : ""}
    ${dcaRow("Liquidity basis", lp.liquidityEstimated ? "Configured TVL estimate" : "Live pool TVL")}
    <div class="s-calc-divider"></div>
    <div class="s-apr-row"><span class="s-apr-label">Conservative APR</span><span class="s-apr-val">${lp.apr.conservative.toFixed(1)}%</span><span class="s-apr-monthly">${fmt(lp.monthly.conservative)}/mo</span></div>
    <div class="s-apr-row"><span class="s-apr-label">Base APR</span><span class="s-apr-val pos">${lp.apr.base.toFixed(1)}%</span><span class="s-apr-monthly">${fmt(lp.monthly.base)}/mo</span></div>
    <div class="s-apr-row"><span class="s-apr-label">Optimistic APR</span><span class="s-apr-val mgsn">${lp.apr.optimistic.toFixed(1)}%</span><span class="s-apr-monthly">${fmt(lp.monthly.optimistic)}/mo</span></div>
    <div class="s-calc-divider"></div>
    ${dcaRow("12-month fee income (base)", fmt(lp.monthly.base * 12), "pos")}
    ${dcaRow("24-month compounded value", fmt(lp.compound24.at(-1)?.total ?? deposit), "pos")}`;

  ilEl.innerHTML = [
    ["MGSN −75% vs ICP", lp.il.minus75],
    ["MGSN −50% vs ICP", lp.il.minus50],
    ["No change", 0],
    ["MGSN +100% vs ICP", lp.il.plus100],
    ["MGSN +300% vs ICP", lp.il.plus300],
  ].map(([label, val]) => `<tr><td>${label}</td><td class="${val < -5 ? "neg" : val === 0 ? "" : "gold"}">${val.toFixed(2)}%</td></tr>`).join("");

  if (msEl) {
    const end12 = lp.compound12.at(-1)?.total ?? deposit;
    const end24 = lp.compound24.at(-1)?.total ?? deposit;
    const end36 = lp.compound36.at(-1)?.total ?? deposit;
    msEl.innerHTML = [
      ["12 months", end12],
      ["24 months", end24],
      ["36 months", end36],
    ].map(([label, val]) => dcaRow(label, `${fmt(val)} (${pctFmt(pct(deposit, val))})`, "pos")).join("");
  }

  const compEl = document.getElementById("chart-compound");
  if (compEl) {
    sizeCanvas("compound", chartW("compound"), 200);
    renderCompoundChart(lp);
  }
}

function renderPortfolioCalc(sig, bt) {
  const holdings = parseFloat(document.getElementById("port-holdings")?.value) || 0;
  const avgCost  = parseFloat(document.getElementById("port-avgcost")?.value)  || sig.mgsnNow;
  const portfolio = computePortfolioPnl(holdings, avgCost, sig.mgsnNow, bt.projectedNow);

  const resEl  = document.getElementById("port-results");
  const targEl = document.getElementById("port-targets-card");
  if (!resEl || !targEl || !portfolio) return;

  resEl.innerHTML = `<div class="s-calc-divider"></div>
    ${dcaRow("Total cost",    fmt(portfolio.cost))}
    ${dcaRow("Value now",     fmt(portfolio.valueNow))}
    ${dcaRow("Unrealised P&L", `${portfolio.unrealised >= 0 ? "+" : ""}${fmt(portfolio.unrealised)} (${pctFmt(portfolio.unrealisedPct)})`, portfolio.unrealised >= 0 ? "pos" : "neg")}`;

  targEl.innerHTML = `
    <div class="s-port-targets">
      <span class="s-calc-section-label">Price targets</span>
      ${portfolio.targets.map((t) => `
        <div class="s-port-target-row">
          <span class="s-sched-month">${fmt(t.price, t.price < 0.001 ? 7 : 4)}</span>
          <span class="s-port-target-val">${fmt(t.value)}</span>
          <span class="s-sched-mult ${t.gain > 0 ? "sig-buy" : "sig-sell"}">${pctFmt(t.gain, 0)}</span>
        </div>`).join("")}
    </div>`;
}

// ── Strategy-specific CSS ─────────────────────────────────────────────────────

const STRATEGY_CSS = `
.s-page { padding-top: var(--header-h); max-width: 1200px; margin: 0 auto; padding-left: 24px; padding-right: 24px; padding-bottom: 60px; }
.s-nav { display: flex; align-items: center; gap: 2px; margin-left: 24px; }
.s-nav-link { padding: 6px 14px; border-radius: var(--radius-md); font-size: 0.78rem; font-weight: 500; color: var(--muted); text-decoration: none; transition: background 120ms, color 120ms; font-family: "IBM Plex Mono", monospace; letter-spacing: 0.03em; }
.s-nav-link:hover { color: var(--ink); background: rgba(255,255,255,0.05); }
.s-nav-link.active { color: var(--mgsn); background: rgba(249,115,22,0.1); }

/* Alerts */
.s-alert-board { display: flex; flex-direction: column; gap: 6px; }
.s-alert { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--panel-border); font-size: 0.78rem; font-family: "IBM Plex Mono", monospace; line-height: 1.5; }
.s-alert--high { background: rgba(249,115,22,0.08); border-color: rgba(249,115,22,0.25); }
.s-alert--med  { background: rgba(99,102,241,0.06); border-color: rgba(99,102,241,0.2); }
.s-alert--low  { background: transparent; }
.s-alert-icon { flex-shrink: 0; font-size: 1rem; }
.s-alert-text { color: var(--ink2); }

/* Hero */
.s-hero { display: flex; align-items: flex-start; gap: 32px; padding: 28px 0 24px; border-bottom: 1px solid var(--panel-border); flex-wrap: wrap; }
.s-hero-left { flex: 1; min-width: 300px; }
.s-hero-right { flex-shrink: 0; }
.s-hero-eyebrow { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 10px; }
.s-hero-signal { font-size: 2.6rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1; margin-bottom: 10px; }
.signal-strong-buy { color: #22c55e; } .signal-buy { color: #4ade80; } .signal-accumulate { color: var(--mgsn); } .signal-hold { color: var(--gold); } .signal-reduce { color: var(--negative); }
.s-hero-note { font-size: 0.88rem; color: var(--ink2); margin: 0 0 16px; max-width: 520px; }
.s-hero-meta { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 18px; }
.s-hero-meta-item { display: flex; flex-direction: column; gap: 2px; }
.s-hero-meta-label { font-size: 0.63rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.s-hero-meta-val { font-size: 0.9rem; font-weight: 600; color: var(--ink); font-family: "IBM Plex Mono", monospace; }
.s-hero-meta-val.mgsn { color: var(--mgsn); } .s-hero-meta-val.bob { color: var(--bob); }
.s-composite-bar-wrap { margin-top: 4px; }
.s-composite-bar { height: 6px; border-radius: 3px; background: var(--surface); overflow: hidden; max-width: 480px; margin-bottom: 5px; }
.s-composite-fill { height: 100%; border-radius: 3px; transition: width 600ms ease; }
.s-composite-fill.signal-strong-buy, .s-composite-fill.signal-buy { background: var(--positive); }
.s-composite-fill.signal-accumulate { background: var(--mgsn); }
.s-composite-fill.signal-hold { background: var(--gold); }
.s-composite-fill.signal-reduce { background: var(--negative); }
.s-composite-labels { display: flex; justify-content: space-between; max-width: 480px; font-size: 0.6rem; color: var(--muted-alt); font-family: "IBM Plex Mono", monospace; }

/* CTA */
.s-cta-block { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-xl); padding: 20px; min-width: 200px; display: flex; flex-direction: column; gap: 8px; }
.s-cta-label { font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin: 0 0 2px; }
.s-cta-btn { display: block; padding: 10px 18px; border-radius: var(--radius-md); font-size: 0.84rem; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; transition: opacity 140ms; }
.s-cta-btn:hover { opacity: 0.85; }
.s-cta-primary { background: linear-gradient(135deg, var(--mgsn), #c2410c); color: #fff; }
.s-cta-secondary { background: var(--surface); border: 1px solid var(--panel-border); color: var(--ink2); }
.s-cta-disclaimer { font-size: 0.62rem; color: var(--muted-alt); font-family: "IBM Plex Mono", monospace; margin: 0; text-align: center; line-height: 1.5; }

/* Section */
.s-section { padding: 24px 0 0; }
.s-section-title { font-size: 0.8rem; font-weight: 700; color: var(--ink); letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 4px; font-family: "IBM Plex Mono", monospace; }
.s-section-sub { font-size: 0.74rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin: 0 0 12px; max-width: 720px; }

/* Signal cards */
.s-signal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.s-signal-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 14px 16px; }
.s-signal-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.s-signal-card-title { font-size: 0.68rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; text-transform: uppercase; letter-spacing: 0.08em; }
.s-signal-label { font-size: 0.67rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; font-family: "IBM Plex Mono", monospace; }
.s-signal-label.sig-buy     { background: rgba(34,197,94,0.15);  color: var(--positive); }
.s-signal-label.sig-neutral { background: rgba(99,102,241,0.15); color: #818cf8; }
.s-signal-label.sig-sell    { background: rgba(239,68,68,0.15);  color: var(--negative); }
.s-score-bar { height: 4px; background: var(--surface); border-radius: 2px; overflow: hidden; margin-bottom: 8px; }
.s-score-fill { height: 100%; border-radius: 2px; }
.s-score-fill.sig-buy { background: var(--positive); } .s-score-fill.sig-neutral { background: #818cf8; } .s-score-fill.sig-sell { background: var(--negative); }
.s-signal-note { font-size: 0.7rem; color: var(--ink2); font-family: "IBM Plex Mono", monospace; margin: 0; line-height: 1.5; }

/* Kelly */
.s-kelly-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 20px; display: flex; flex-direction: column; gap: 6px; max-width: 400px; }
.s-kelly-fraction { font-size: 2.2rem; font-weight: 800; color: var(--positive); font-family: "IBM Plex Mono", monospace; letter-spacing: -0.02em; }
.s-kelly-label { font-size: 0.72rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; text-transform: uppercase; letter-spacing: 0.08em; }
.s-kelly-note { font-size: 0.74rem; color: var(--ink2); font-family: "IBM Plex Mono", monospace; margin: 2px 0; }
.s-kelly-meta { display: flex; gap: 20px; margin-top: 4px; }
.s-kelly-meta > div { display: flex; flex-direction: column; gap: 2px; font-size: 0.72rem; font-family: "IBM Plex Mono", monospace; }
.s-kelly-meta span:first-child { color: var(--muted); font-size: 0.62rem; text-transform: uppercase; }
.s-kelly-meta span:last-child { font-weight: 600; color: var(--ink); }

/* Arbitrage */
.s-arb-result { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 18px 20px; }
.s-arb-label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 4px; }
.s-arb-oppty { font-size: 1.3rem; font-weight: 800; font-family: "IBM Plex Mono", monospace; margin-bottom: 8px; }
.s-arb-oppty.pos { color: var(--positive); } .s-arb-oppty.neg { color: var(--negative); }
.s-arb-action { font-size: 0.8rem; color: var(--ink2); font-family: "IBM Plex Mono", monospace; margin: 0 0 12px; }
.s-arb-meta { display: flex; gap: 24px; flex-wrap: wrap; }
.s-arb-meta-item { display: flex; flex-direction: column; gap: 2px; font-family: "IBM Plex Mono", monospace; font-size: 0.72rem; }
.s-arb-meta-item span:first-child { color: var(--muted); font-size: 0.62rem; text-transform: uppercase; }
.s-arb-meta-item span.mgsn { color: var(--mgsn); font-weight: 600; }
.s-arb-meta-item span.bob  { color: var(--bob);  font-weight: 600; }
.s-arb-meta-item span.pos  { color: var(--positive); font-weight: 600; }
.s-arb-meta-item span.neg  { color: var(--negative); font-weight: 600; }

/* Charts */
.s-charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.s-chart-panel { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); overflow: hidden; padding: 14px 16px 12px; }
.s-chart-head { margin-bottom: 8px; }
.s-chart-title { display: block; font-size: 0.8rem; font-weight: 600; color: var(--ink); margin-bottom: 2px; }
.s-chart-sub { font-size: 0.66rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.s-chart-wrap { position: relative; overflow: hidden; }
.s-chart-wrap canvas { display: block; }

/* Backtest stats */
.s-backtest-stats { display: flex; gap: 24px; padding: 12px 0 4px; flex-wrap: wrap; border-top: 1px solid var(--line); margin-top: 10px; }
.s-stat-group { display: flex; flex-direction: column; gap: 2px; }
.s-stat-label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.s-stat-val { font-size: 1rem; font-weight: 700; color: var(--ink); font-family: "IBM Plex Mono", monospace; }
.s-stat-val.mgsn { color: var(--mgsn); } .s-stat-val.bob { color: var(--bob); } .s-stat-val.gold { color: var(--gold); }
.s-stat-sub { font-size: 0.67rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; }

/* Calc */
.s-calc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.s-calc-card { background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: var(--radius-lg); padding: 16px 18px; }
.s-input-label { display: block; font-size: 0.67rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 5px; }
.s-input { width: 100%; padding: 8px 11px; background: var(--surface); border: 1px solid var(--panel-border); border-radius: var(--radius-md); color: var(--ink); font-size: 0.84rem; font-family: "IBM Plex Mono", monospace; outline: none; transition: border-color 140ms; }
.s-input:focus { border-color: var(--mgsn); }
.s-calc-results { margin-top: 12px; }
.s-calc-divider { height: 1px; background: var(--line); margin: 8px 0; }
.s-calc-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
.s-calc-label { font-size: 0.7rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.s-calc-val { font-size: 0.8rem; font-weight: 600; color: var(--ink); font-family: "IBM Plex Mono", monospace; }
.s-calc-val.mgsn { color: var(--mgsn); } .s-calc-val.pos { color: var(--positive); } .s-calc-val.neg { color: var(--negative); }
.s-calc-section-label { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 8px; display: block; }

/* DCA schedule */
.s-dca-schedule { display: flex; flex-direction: column; }
.s-sched-row { display: grid; grid-template-columns: 3.5rem 3.5rem 2.8rem 1fr; gap: 5px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--line); font-family: "IBM Plex Mono", monospace; font-size: 0.7rem; }
.s-sched-row.current { background: rgba(249,115,22,0.06); border-radius: 4px; padding-left: 4px; }
.s-sched-month { color: var(--muted); } .s-sched-alloc { color: var(--ink2); } .s-sched-tokens { color: var(--mgsn); text-align: right; }
.s-sched-mult { font-weight: 700; text-align: center; font-size: 0.68rem; }
.s-sched-mult.sig-buy { color: var(--positive); } .s-sched-mult.sig-neutral { color: var(--gold); } .s-sched-mult.sig-sell { color: var(--negative); }

/* Portfolio */
.s-port-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-top: 4px; }
.s-port-stat { background: var(--surface); border-radius: var(--radius-sm); padding: 10px 12px; }
.s-port-label { display: block; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin-bottom: 3px; }
.s-port-val { font-size: 0.82rem; font-weight: 600; color: var(--ink); font-family: "IBM Plex Mono", monospace; }
.s-port-val.mgsn { color: var(--mgsn); } .s-port-val.pos { color: var(--positive); } .s-port-val.neg { color: var(--negative); }
.s-port-targets { margin-top: 4px; }
.s-port-target-row { display: grid; grid-template-columns: 5rem 4rem 1fr; gap: 6px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--line); font-family: "IBM Plex Mono", monospace; font-size: 0.7rem; }
.s-port-target-val { color: var(--positive); font-weight: 600; }

/* LP */
.s-lp-note { font-size: 0.67rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; margin: 4px 0 0; line-height: 1.5; }
.s-apr-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.s-apr-label { font-size: 0.7rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; flex: 1; }
.s-apr-val { font-size: 0.86rem; font-weight: 700; font-family: "IBM Plex Mono", monospace; min-width: 48px; text-align: right; }
.s-apr-monthly { font-size: 0.67rem; color: var(--muted); font-family: "IBM Plex Mono", monospace; min-width: 60px; text-align: right; }
.s-apr-val.pos { color: var(--positive); } .s-apr-val.neg { color: var(--muted); } .s-apr-val.mgsn { color: var(--mgsn); }
.s-il-table { width: 100%; border-collapse: collapse; font-size: 0.72rem; font-family: "IBM Plex Mono", monospace; }
.s-il-table th, .s-il-table td { text-align: left; padding: 5px 4px; border-bottom: 1px solid var(--line); color: var(--muted); }
.s-il-table th { font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; font-size: 0.62rem; }
.s-il-table td.neg { color: var(--negative); } .s-il-table td.gold { color: var(--gold); }

/* Responsive */
@media (max-width: 900px) {
  .s-page { padding-left: 14px; padding-right: 14px; }
  .s-charts-row { grid-template-columns: 1fr; }
  .s-calc-grid  { grid-template-columns: 1fr; }
  .s-hero { flex-direction: column; gap: 20px; }
  .s-signal-grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 600px) {
  .s-nav  { display: none; }
}
@media (max-width: 480px) {
  .s-signal-grid { grid-template-columns: 1fr; }
}
`;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

let liveIcpUsd  = null;
let liveMgsnUsd = null;
let liveBobUsd  = null;
let livePoolStats = {};
const STRATEGY_CACHE_KEY = "strategy-page-live-v1";

async function bootstrap() {
  const styleEl = document.createElement("style");
  styleEl.textContent = STRATEGY_CSS;
  document.head.appendChild(styleEl);

  const app = document.querySelector("#app");
  const cachedState = readViewCache(STRATEGY_CACHE_KEY);
  let baseState = buildStrategyBaseState(cachedState ?? {});
  renderStrategyPage(app, baseState, cachedState ? "cached" : "fallback");

  const [liveDashboardResult, liveSpotResult, liveIcpswapResult, livePoolResult] = await Promise.allSettled([
    fetchDashboardData(),
    fetchLiveSpotPrices(),
    fetchICPSwapPrices(),
    fetchICPSwapPoolStats(),
  ]);

  baseState = buildStrategyBaseState({
    dashboard: liveDashboardResult.value ?? baseState.dashboard,
    liveIcpUsd: liveSpotResult.value?.icpUsd ?? baseState.liveIcpUsd,
    liveMgsnUsd: liveIcpswapResult.value?.mgsnUsd ?? baseState.liveMgsnUsd,
    liveBobUsd: liveIcpswapResult.value?.bobUsd ?? baseState.liveBobUsd,
    livePoolStats: livePoolResult.value ?? baseState.livePoolStats,
  });
  writeViewCache(STRATEGY_CACHE_KEY, baseState);
  renderStrategyPage(app, baseState, "live");

  setInterval(async () => {
    const [nextDashboardResult, nextSpotResult, nextIcpswapResult, nextPoolResult] = await Promise.allSettled([
      fetchDashboardData(true),
      fetchLiveSpotPrices(),
      fetchICPSwapPrices(true),
      fetchICPSwapPoolStats(true),
    ]);
    baseState = buildStrategyBaseState({
      dashboard: nextDashboardResult.value ?? baseState.dashboard,
      liveIcpUsd: nextSpotResult.value?.icpUsd ?? baseState.liveIcpUsd,
      liveMgsnUsd: nextIcpswapResult.value?.mgsnUsd ?? baseState.liveMgsnUsd,
      liveBobUsd: nextIcpswapResult.value?.bobUsd ?? baseState.liveBobUsd,
      livePoolStats: nextPoolResult.value ?? baseState.livePoolStats,
    });
    writeViewCache(STRATEGY_CACHE_KEY, baseState);
    renderStrategyPage(app, baseState, "live");
  }, 60_000);
}

function renderSmaSignalChart(sig, timeline) {
  const labels = timeline.map((p) => p.period.split(" ")[0]);
  const bob    = timeline.map((p) => p.bobPrice);
  sizeCanvas("sma", chartW("sma"), 200);
  const opts = baseOpts((v) => fmt(v, 3));
  opts.plugins.tooltip.callbacks = { label: (ctx) => ctx.raw !== null ? ` ${ctx.dataset.label}: ${fmt(ctx.raw, 4)}` : null };
  mkChart("sma", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "BOB price",  data: bob,          borderColor: C.bob,  borderWidth: 2,   pointRadius: 0, tension: 0.35 },
        { label: "Fast (3m)",  data: sig.bobFast,  borderColor: C.mgsn, borderWidth: 1.5, pointRadius: 0, borderDash: [5, 3], tension: 0.35, spanGaps: true },
        { label: "Slow (8m)",  data: sig.bobSlow,  borderColor: C.gold, borderWidth: 1.5, pointRadius: 0, borderDash: [3, 5], tension: 0.35, spanGaps: true },
      ],
    },
    options: opts,
  });
}

bootstrap();

function buildStrategyBaseState(raw = {}) {
  return {
    dashboard: raw.dashboard ?? createUnavailableDashboard(),
    liveIcpUsd: raw.liveIcpUsd ?? null,
    liveMgsnUsd: raw.liveMgsnUsd ?? null,
    liveBobUsd: raw.liveBobUsd ?? null,
    livePoolStats: raw.livePoolStats ?? {},
  };
}

function renderStrategyPage(app, baseState, hydrationMode) {
  const scenario = loadScenarioState();
  const dashboard = applyScenarioToDashboard(baseState.dashboard ?? createUnavailableDashboard(), scenario);
  const lastPoint = getDashboardLastPoint(dashboard);
  const prices = applyScenarioToPrices(
    {
      icpUsd: baseState.liveIcpUsd ?? lastPoint?.icpPrice ?? null,
      mgsnUsd: baseState.liveMgsnUsd ?? lastPoint?.mgsnPrice ?? null,
      bobUsd: baseState.liveBobUsd ?? lastPoint?.bobPrice ?? null,
    },
    scenario
  );
  const livePoolStatsLocal = applyScenarioToPoolStats(baseState.livePoolStats, scenario);

  liveIcpUsd = prices.icpUsd;
  liveMgsnUsd = prices.mgsnUsd;
  liveBobUsd = prices.bobUsd;
  livePoolStats = livePoolStatsLocal;

  if (!hasDashboardHistory(dashboard)) {
    app.innerHTML = buildUnavailableHTML(
      prices,
      livePoolStatsLocal,
      buildScenarioHeaderHTML(
        "strategy",
        buildDashboardSourceChips(dashboard, scenario, hydrationMode)
      )
    );

    attachScenarioStudio(app, (action) => {
      if (action?.type === "refresh" || action?.type === "clear-cache") {
        window.location.reload();
        return;
      }
      renderStrategyPage(app, baseState, hydrationMode);
    });
    return;
  }

  const sig = computeSignals(dashboard, prices.icpUsd, prices.mgsnUsd, prices.bobUsd);
  const bt = runDCABacktest(dashboard, 100, prices.mgsnUsd, prices.bobUsd);
  const lp = estimateLPYield(sig.mgsnNow, sig.icpNow, 500, dashboard, livePoolStatsLocal);
  const historicalMgsn = dashboard.timeline.at(-2)?.mgsnPrice ?? dashboard.timeline.at(-1)?.mgsnPrice ?? null;
  const arb = computeArbitrageScore(prices.mgsnUsd, bt.projectedNow, historicalMgsn);
  const defaults = getPortfolioDefaults(scenario);
  const defPort = computePortfolioPnl(defaults.holdings, defaults.avgCost, sig.mgsnNow, bt.projectedNow);
  const alerts = buildAlerts(sig, bt, defPort);

  app.innerHTML = buildHTML(
    dashboard,
    sig,
    bt,
    lp,
    arb,
    alerts,
    defPort,
    buildScenarioHeaderHTML(
      "strategy",
      buildDashboardSourceChips(dashboard, scenario, hydrationMode)
    )
  );

  const holdingsEl = document.getElementById("port-holdings");
  if (holdingsEl) holdingsEl.value = String(defaults.holdings);
  const avgCostEl = document.getElementById("port-avgcost");
  if (avgCostEl) avgCostEl.value = String(defaults.avgCost);

  sizeCanvas("rsi", chartW("rsi"), 200);
  sizeCanvas("macd", chartW("macd"), 200);
  sizeCanvas("bb", chartW("bb"), 200);
  sizeCanvas("sma", chartW("sma"), 200);
  sizeCanvas("backtest", chartW("backtest"), 300);
  sizeCanvas("compound", chartW("compound"), 200);

  renderRsiChart(sig, dashboard.timeline);
  renderMacdChart(sig, dashboard.timeline);
  renderBollingerChart(sig, dashboard.timeline);
  renderSmaSignalChart(sig, dashboard.timeline);
  renderBacktestChart(bt);
  renderCompoundChart(lp);

  renderDCACalc(sig, dashboard);
  renderLPCalc(sig, dashboard, livePoolStatsLocal);
  renderPortfolioCalc(sig, bt);

  ["dca-budget", "dca-strategy", "dca-scenario"].forEach((id) =>
    document.getElementById(id)?.addEventListener("input", () => renderDCACalc(sig, dashboard)));
  document.getElementById("lp-deposit")?.addEventListener("input", () => {
    renderLPCalc(sig, dashboard, livePoolStatsLocal);
    sizeCanvas("compound", chartW("compound"), 200);
    renderCompoundChart(
      estimateLPYield(
        sig.mgsnNow,
        sig.icpNow,
        parseFloat(document.getElementById("lp-deposit").value) || 500,
        dashboard,
        livePoolStatsLocal
      )
    );
  });
  ["port-holdings", "port-avgcost"].forEach((id) =>
    document.getElementById(id)?.addEventListener("input", () => renderPortfolioCalc(sig, bt)));

  document.getElementById("share-signal-btn")?.addEventListener("click", () => {
    const shareText = `MGSN Signal: ${sig.action} (${sig.composite.toFixed(0)}/100) | Kelly: ${(sig.kelly.fraction * 100).toFixed(1)}% | MGSN: ${fmt(sig.mgsnNow, 7)} | ${new Date().toDateString()} | https://yezrb-diaaa-aaaah-qugnq-cai.icp0.io/strategy.html`;
    navigator.clipboard.writeText(shareText).then(() => {
      const btn = document.getElementById("share-signal-btn");
      if (btn) {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.innerHTML = "&#128203; Copy Signal"; }, 2000);
      }
    });
  });

  attachScenarioStudio(app, (action) => {
    if (action?.type === "refresh" || action?.type === "clear-cache") {
      window.location.reload();
      return;
    }
    renderStrategyPage(app, baseState, hydrationMode);
  });

  if (prices.icpUsd) {
    const el = document.getElementById("s-icp-price");
    if (el) {
      el.textContent = `$${prices.icpUsd.toFixed(2)}`;
      el.classList.toggle("live", true);
    }
  }
  if (prices.mgsnUsd) {
    const el = document.getElementById("s-mgsn-price");
    if (el) el.textContent = fmt(prices.mgsnUsd, 7);
  }
  if (prices.bobUsd) {
    const el = document.getElementById("s-bob-price");
    if (el) el.textContent = fmt(prices.bobUsd, 4);
  }
}
