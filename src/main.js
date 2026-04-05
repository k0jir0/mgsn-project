import "./styles.css";
import { createBackendActor } from "./actor";
import { demoDashboard } from "./demoData";

const filters = [
  { key: "all", label: "All", length: Number.POSITIVE_INFINITY },
  { key: "6m", label: "6M", length: 6 },
  { key: "3m", label: "3M", length: 3 },
  { key: "1m", label: "1M", length: 2 },
];

const state = {
  filter: "all",
};

async function loadDashboard() {
  const actor = createBackendActor();

  if (!actor) {
    return { dashboard: demoDashboard, mode: "demo" };
  }

  try {
    const dashboard = await actor.getDashboard();
    return { dashboard, mode: "canister" };
  } catch (error) {
    console.error("Unable to load canister data, using demo fallback.", error);
    return { dashboard: demoDashboard, mode: "demo" };
  }
}

function latest(items) {
  return items[items.length - 1];
}

function first(items) {
  return items[0];
}

function pctChange(start, end) {
  if (start === 0) {
    return 0;
  }

  return ((end - start) / start) * 100;
}

function money(value, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function compactMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function percent(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function toDate(value) {
  const raw = typeof value === "bigint" ? value : BigInt(value);
  return new Date(Number(raw / 1_000_000n));
}

function getSeries(timeline, filterKey) {
  const active = filters.find((entry) => entry.key === filterKey) ?? filters[0];
  if (!Number.isFinite(active.length)) {
    return timeline;
  }

  return timeline.slice(-active.length);
}

function buildPath(values, width, height, bounds) {
  if (values.length === 0) {
    return "";
  }

  const min = bounds?.min ?? Math.min(...values);
  const max = bounds?.max ?? Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildArea(values, width, height, bounds) {
  if (values.length === 0) {
    return "";
  }

  const line = buildPath(values, width, height, bounds);
  return `${line} L ${width} ${height} L 0 ${height} Z`;
}

function lineChart(valuesA, valuesB, labels, colors) {
  const width = 320;
  const height = 160;
  const combined = [...valuesA, ...valuesB];
  const bounds = {
    min: Math.min(...combined),
    max: Math.max(...combined),
  };
  const lineA = buildPath(valuesA, width, height, bounds);
  const lineB = buildPath(valuesB, width, height, bounds);
  const areaA = buildArea(valuesA, width, height, bounds);

  return `
    <div class="chart-frame">
      <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
        <defs>
          <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="${colors[0]}" stop-opacity="0.35"></stop>
            <stop offset="100%" stop-color="${colors[0]}" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <path d="${areaA}" fill="url(#chart-fill)"></path>
        <path d="${lineA}" stroke="${colors[0]}" stroke-width="3" fill="none" stroke-linecap="round"></path>
        <path d="${lineB}" stroke="${colors[1]}" stroke-width="3" fill="none" stroke-linecap="round"></path>
      </svg>
      <div class="chart-labels">
        ${labels.map((label) => `<span>${label}</span>`).join("")}
      </div>
    </div>
  `;
}

function bars(values, labels, color) {
  const max = Math.max(...values, 1);

  return `
    <div class="bars">
      ${values
        .map((value, index) => {
          const height = Math.max((value / max) * 100, 6);
          return `
            <div class="bar-group">
              <div class="bar" style="height:${height}%; background:${color}"></div>
              <span>${labels[index]}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function normalize(values, comparisonSet = values) {
  const min = Math.min(...comparisonSet);
  const max = Math.max(...comparisonSet);
  const range = max - min || 1;

  return values.map((value) => ((value - min) / range) * 100);
}

function correlationScore(series) {
  if (series.length < 2) {
    return 0;
  }

  let aligned = 0;
  for (let index = 1; index < series.length; index += 1) {
    const bobDirection = Math.sign(series[index].bobPrice - series[index - 1].bobPrice);
    const mgsnDirection = Math.sign(series[index].mgsnPrice - series[index - 1].mgsnPrice);
    if (bobDirection === mgsnDirection) {
      aligned += 1;
    }
  }

  return (aligned / (series.length - 1)) * 100;
}

function computeMetrics(dashboard, timeline) {
  const opening = first(timeline);
  const closing = latest(timeline);
  const bobMarketCap = closing.bobPrice * dashboard.bobSupply;
  const mgsnMarketCap = closing.mgsnPrice * dashboard.mgsnSupply;
  const totalLiquidity = closing.bobLiquidity + closing.mgsnLiquidity;
  const peakLiquidity = Math.max(
    ...timeline.map((point) => point.bobLiquidity + point.mgsnLiquidity)
  );

  return {
    bobSpot: closing.bobPrice,
    mgsnSpot: closing.mgsnPrice,
    ratio: closing.bobPrice / closing.mgsnPrice,
    bobChange: pctChange(opening.bobPrice, closing.bobPrice),
    mgsnChange: pctChange(opening.mgsnPrice, closing.mgsnPrice),
    pairMarketCap: bobMarketCap + mgsnMarketCap,
    bobDominance: (bobMarketCap / (bobMarketCap + mgsnMarketCap)) * 100,
    liquidityScore: (totalLiquidity / peakLiquidity) * 100,
    correlation: correlationScore(timeline),
    totalVolume: closing.bobVolume + closing.mgsnVolume,
  };
}

function card(title, value, hint, tone = "neutral") {
  return `
    <article class="metric-card metric-card--${tone}">
      <span>${title}</span>
      <strong>${value}</strong>
      <p>${hint}</p>
    </article>
  `;
}

function panel(title, subtitle, body) {
  return `
    <section class="panel">
      <div class="panel-heading">
        <div>
          <h3>${title}</h3>
          <p>${subtitle}</p>
        </div>
      </div>
      ${body}
    </section>
  `;
}

function render(app, dashboard, mode) {
  const activeSeries = getSeries(dashboard.timeline, state.filter);
  const metrics = computeMetrics(dashboard, activeSeries);
  const labels = activeSeries.map((point) => point.period.split(" ")[0]);
  const bobPrices = activeSeries.map((point) => point.bobPrice);
  const mgsnPrices = activeSeries.map((point) => point.mgsnPrice);
  const bobPerformance = activeSeries.map((point) => (point.bobPrice / activeSeries[0].bobPrice) * 100);
  const mgsnPerformance = activeSeries.map((point) => (point.mgsnPrice / activeSeries[0].mgsnPrice) * 100);
  const ratios = activeSeries.map((point) => point.bobPrice / point.mgsnPrice);
  const liquidity = activeSeries.map((point) => point.bobLiquidity + point.mgsnLiquidity);
  const dominance = activeSeries.map((point) => {
    const bobCap = point.bobPrice * dashboard.bobSupply;
    const mgsnCap = point.mgsnPrice * dashboard.mgsnSupply;
    return (bobCap / (bobCap + mgsnCap)) * 100;
  });
  const totalVolumes = activeSeries.map((point) => point.bobVolume + point.mgsnVolume);

  app.innerHTML = `
    <div class="shell">
      <header class="hero reveal">
        <div class="hero-copy">
          <div class="eyebrow-row">
            <span class="eyebrow">Motoko on ICP</span>
            <span class="eyebrow eyebrow--muted">${mode === "canister" ? "Live canister read" : "Fallback demo mode"}</span>
          </div>
          <h1>${dashboard.title}</h1>
          <p class="lede">${dashboard.subtitle}</p>
          <p class="hero-note">${dashboard.heroNote}</p>
          <div class="hero-stats">
            <div>
              <span>BOB / MGSN ratio</span>
              <strong>${metrics.ratio.toFixed(2)}x</strong>
            </div>
            <div>
              <span>Pair market cap</span>
              <strong>${compactMoney(metrics.pairMarketCap)}</strong>
            </div>
            <div>
              <span>Total daily volume</span>
              <strong>${compactMoney(metrics.totalVolume)}</strong>
            </div>
          </div>
        </div>
        <aside class="hero-side reveal reveal-delay-1">
          <span class="eyebrow">Dashboard settings</span>
          <div class="filter-row">
            ${filters
              .map(
                (filter) => `
                  <button class="filter-chip ${filter.key === state.filter ? "is-active" : ""}" data-filter="${filter.key}">
                    ${filter.label}
                  </button>
                `
              )
              .join("")}
          </div>
          <div class="source-card">
            <p>${dashboard.dataSource}</p>
            <span>Updated ${toDate(dashboard.updatedAt).toLocaleString()}</span>
          </div>
        </aside>
      </header>

      <section class="metric-grid reveal reveal-delay-1">
        ${card("BOB spot", money(metrics.bobSpot, 3), `${percent(metrics.bobChange)} versus ${activeSeries[0].period}`, "bob")}
        ${card("MGSN spot", money(metrics.mgsnSpot, 3), `${percent(metrics.mgsnChange)} versus ${activeSeries[0].period}`, "mgsn")}
        ${card("Liquidity score", `${metrics.liquidityScore.toFixed(0)}/100`, `${compactMoney(latest(activeSeries).bobLiquidity + latest(activeSeries).mgsnLiquidity)} in pooled depth`, "neutral")}
        ${card("BOB dominance", `${metrics.bobDominance.toFixed(1)}%`, `${(100 - metrics.bobDominance).toFixed(1)}% sits with MGSN`, "neutral")}
        ${card("Trend alignment", `${metrics.correlation.toFixed(0)}%`, `Directional agreement across ${activeSeries.length - 1} intervals`, "neutral")}
        ${card("BOB supply base", compactNumber(dashboard.bobSupply), `MGSN circulating base ${compactNumber(dashboard.mgsnSupply)}`, "neutral")}
      </section>

      <section class="panel-grid reveal reveal-delay-2">
        ${panel(
          "Price trajectory",
          "Direct spot comparison across the active window.",
          lineChart(bobPrices, mgsnPrices, labels, ["#ff7a18", "#0f9d92"])
        )}
        ${panel(
          "Relative performance",
          "Indexed to 100 at the start of the selected range.",
          lineChart(bobPerformance, mgsnPerformance, labels, ["#ff7a18", "#0f9d92"])
        )}
        ${panel(
          "Ratio structure",
          "How many MGSN units one BOB buys over time.",
          lineChart(ratios, ratios.map((value) => value * 0.985), labels, ["#18181b", "#f3c89d"])
        )}
        ${panel(
          "Liquidity depth",
          "Combined route depth across both tokens.",
          lineChart(liquidity, liquidity.map((value) => value * 0.92), labels, ["#0f9d92", "#9dd8d2"])
        )}
        ${panel(
          "Volume pulse",
          "Compact view of trading activity intensity.",
          bars(totalVolumes, labels, "linear-gradient(180deg, #ff7a18 0%, #ffb16b 100%)")
        )}
        ${panel(
          "Dominance drift",
          "BOB share of the pair market cap over time.",
          lineChart(dominance, dominance.map((value) => 100 - value), labels, ["#18181b", "#0f9d92"])
        )}
      </section>

      <section class="table-panel reveal reveal-delay-3">
        <div class="panel-heading">
          <div>
            <h3>Snapshot tape</h3>
            <p>Latest points from the active window, ready to swap with live BOB/MGSN feeds later.</p>
          </div>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>BOB</th>
                <th>MGSN</th>
                <th>Ratio</th>
                <th>Volume</th>
                <th>Liquidity</th>
              </tr>
            </thead>
            <tbody>
              ${activeSeries
                .slice()
                .reverse()
                .map(
                  (point) => `
                    <tr>
                      <td>${point.period}</td>
                      <td>${money(point.bobPrice, 3)}</td>
                      <td>${money(point.mgsnPrice, 3)}</td>
                      <td>${(point.bobPrice / point.mgsnPrice).toFixed(2)}x</td>
                      <td>${compactMoney(point.bobVolume + point.mgsnVolume)}</td>
                      <td>${compactMoney(point.bobLiquidity + point.mgsnLiquidity)}</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;

  app.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      render(app, dashboard, mode);
    });
  });
}

async function bootstrap() {
  const app = document.querySelector("#app");
  app.innerHTML = '<div class="loading">Building BOB / MGSN dashboard…</div>';
  const { dashboard, mode } = await loadDashboard();
  render(app, dashboard, mode);
}

bootstrap();
