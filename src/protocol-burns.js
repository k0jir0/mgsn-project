import "./styles.css";
import "./burnHub.css";
import {
  buildBurnHubNavHTML,
  deriveBurnMetrics,
  escapeHtml,
  fetchBurnSuiteData,
  formatCheckpointDate,
  formatCompactNumber,
  formatInteger,
  formatMoney,
  shortenAddress,
  txExplorerUrl,
} from "./burnSuite.js";
import { buildPlatformHeaderHTML } from "./siteChrome.js";
import { buildBurnSourceChips, loadScenarioState, readViewCache, writeViewCache } from "./siteState.js";

const APP = document.querySelector("#app");
const CACHE_KEY = "protocol-burns-live-v1";
let pageState = null;
let refreshInFlight = false;

if (!APP) {
  throw new Error("Missing #app root");
}

function fallbackPublicData() {
  return {
    prices: {},
    burnState: {
      status: "unavailable",
      burnAddress: "aaaaa-aa",
      burnAddressBalance: null,
      currentSupply: null,
      originalSupply: null,
      totalBurned: null,
      log: [],
      note: "MGSN burn history is temporarily unavailable.",
    },
    treasuryAccount: null,
    trenchState: null,
  };
}

function buildState(raw, hydrationMode) {
  const merged = {
    ...fallbackPublicData(),
    ...raw,
  };

  return {
    ...merged,
    hydrationMode,
    metrics: deriveBurnMetrics({
      burnState: merged.burnState,
      mgsnUsd: merged.prices?.mgsnUsd ?? null,
      treasuryAccount: merged.treasuryAccount,
      trenchState: merged.trenchState,
    }),
  };
}

function protocolBurnEntries(metrics) {
  return metrics.classifiedBurns.filter((entry) => entry?.source?.key !== "community");
}

function protocolReceiptRows(metrics) {
  const rows = [];
  for (const checkpoint of metrics.protocol.liquidityRoutedCheckpoints) {
    rows.push({
      stage: "Liquidity routed",
      intentId: checkpoint.intentId,
      note: checkpoint.note || "Route note published.",
      recordedAt: checkpoint.recordedAt,
      txIndex: checkpoint.txIndex,
    });
  }
  for (const checkpoint of metrics.protocol.lpLockCheckpoints) {
    rows.push({
      stage: "LP locked",
      intentId: checkpoint.intentId,
      note: checkpoint.note || "LP lock checkpoint published.",
      recordedAt: checkpoint.recordedAt,
      txIndex: checkpoint.txIndex,
    });
  }
  for (const checkpoint of metrics.protocol.lpBurnCheckpoints) {
    rows.push({
      stage: "LP burned",
      intentId: checkpoint.intentId,
      note: checkpoint.note || "LP burn checkpoint published.",
      recordedAt: checkpoint.recordedAt,
      txIndex: checkpoint.txIndex,
    });
  }
  for (const checkpoint of metrics.protocol.proofCheckpoints) {
    rows.push({
      stage: "Proof published",
      intentId: checkpoint.intentId,
      note: checkpoint.note || "Proof checkpoint published.",
      recordedAt: checkpoint.recordedAt,
      txIndex: checkpoint.txIndex,
    });
  }

  return rows.sort((left, right) => {
    const leftValue = left.recordedAt == null ? 0n : BigInt(left.recordedAt);
    const rightValue = right.recordedAt == null ? 0n : BigInt(right.recordedAt);
    return rightValue > leftValue ? 1 : rightValue < leftValue ? -1 : 0;
  });
}

function renderProtocolBurnRow(entry) {
  const txUrl = txExplorerUrl(entry?.txId);
  return `
    <div class="burn-feed-row">
      <div class="burn-feed-main">
        <span class="burn-feed-title">${escapeHtml(formatCompactNumber(entry?.mgsnBurned))} MGSN</span>
        <span class="burn-feed-meta">${escapeHtml(entry?.date ?? "Unavailable")} · ${escapeHtml(shortenAddress(entry?.address, 10, 8))}</span>
      </div>
      <span class="burn-chip ${entry?.source?.key === "treasury" ? "bio" : "warn"}">${escapeHtml(entry?.source?.label ?? "Protocol")}</span>
      <span class="burn-feed-meta">${escapeHtml(entry?.note ?? "Protocol burn")}</span>
      ${txUrl ? `<a class="burn-anchor-link" href="${txUrl}" target="_blank" rel="noopener noreferrer">Explorer</a>` : `<span class="burn-feed-meta">Unavailable</span>`}
    </div>`;
}

function renderCheckpointRow(entry) {
  const txUrl = entry?.txIndex != null ? txExplorerUrl(entry.txIndex.toString()) : "";
  return `
    <div class="burn-feed-row">
      <div class="burn-feed-main">
        <span class="burn-feed-title">${escapeHtml(entry.stage)} · Intent #${entry.intentId ?? "?"}</span>
        <span class="burn-feed-meta">${escapeHtml(formatCheckpointDate(entry.recordedAt))} · ${escapeHtml(entry.note)}</span>
      </div>
      <span class="burn-chip bio">${escapeHtml(entry.stage)}</span>
      <span class="burn-feed-meta">${entry.txIndex != null ? `Block ${entry.txIndex}` : "No TX published"}</span>
      ${txUrl ? `<a class="burn-anchor-link" href="${txUrl}" target="_blank" rel="noopener noreferrer">Explorer</a>` : `<span class="burn-feed-meta">Pending</span>`}
    </div>`;
}

function buildHtml(state) {
  const metrics = state.metrics;
  const protocolEntries = protocolBurnEntries(metrics);
  const checkpointEntries = protocolReceiptRows(metrics);

  return `
    ${buildPlatformHeaderHTML({
      activePage: "burn",
      badgeText: "Protocol burns",
      priceLabel: "MGSN/USD",
      priceValue: state.prices?.mgsnUsd != null ? formatMoney(state.prices.mgsnUsd, 7) : "Unavailable",
      priceClass: state.prices?.mgsnUsd != null ? "live" : "",
    })}

    <div class="burn-shell">
      ${buildBurnSourceChips(metrics, loadScenarioState(), state.hydrationMode)}
      ${buildBurnHubNavHTML("protocol-burns")}

      <section class="burn-hero">
        <div class="burn-hero-copy">
          <span class="burn-kicker">Protocol source map</span>
          <h1 class="burn-title">Protocol Burns</h1>
          <p class="burn-copy">This page exists so the burn program can tell the truth about system-level burns. Treasury burns, buyback burns, and trench LP burn receipts all live here with their current publication status.</p>
          <div class="burn-stat-grid">
            <article class="burn-stat">
              <span class="burn-stat-label">Treasury source</span>
              <span class="burn-stat-value">${metrics.protocol.treasuryOwner ? "Published" : "Pending"}</span>
              <p class="burn-stat-copy">${escapeHtml(metrics.protocol.treasuryOwner ? shortenAddress(metrics.protocol.treasuryOwner, 10, 8) : "No public treasury owner has been surfaced yet.")}</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Buyback source</span>
              <span class="burn-stat-value">${metrics.protocol.buybackVaultOwner ? "Published" : "Pending"}</span>
              <p class="burn-stat-copy">${escapeHtml(metrics.protocol.buybackVaultOwner ? shortenAddress(metrics.protocol.buybackVaultOwner, 10, 8) : "No public buyback vault is published yet.")}</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Protocol burns detected</span>
              <span class="burn-stat-value">${formatInteger(protocolEntries.length)}</span>
              <p class="burn-stat-copy">Ledger burns currently attributed to published protocol actors.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Trench settlements</span>
              <span class="burn-stat-value">${metrics.protocol.trenchState?.settledCount != null ? formatInteger(Number(metrics.protocol.trenchState.settledCount)) : "0"}</span>
              <p class="burn-stat-copy">Settled trench rails visible from the public subscriptions canister.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">LP burn checkpoints</span>
              <span class="burn-stat-value">${formatInteger(metrics.protocol.lpBurnCheckpoints.length)}</span>
              <p class="burn-stat-copy">Published LP burn receipt markers from trench intents.</p>
            </article>
            <article class="burn-stat">
              <span class="burn-stat-label">Latest status</span>
              <span class="burn-stat-value">${metrics.protocol.lpBurnCheckpoints.length > 0 ? "Published" : "Staged"}</span>
              <p class="burn-stat-copy">${escapeHtml(metrics.protocol.latestProtocolStatus)}</p>
            </article>
          </div>
        </div>
        <aside class="burn-console">
          <div class="burn-console-head">
            <div>
              <h2 class="burn-console-title">Source coverage</h2>
              <p class="burn-console-subtitle">Zero is allowed here. This page is built to show when a protocol burn surface is still unpublished.</p>
            </div>
            <span class="burn-auth-chip live">Honest wiring</span>
          </div>
          <div class="burn-action-row">
            <button id="protocol-refresh" class="burn-btn burn-btn-primary" type="button"${refreshInFlight ? " disabled" : ""}>${refreshInFlight ? "Refreshing..." : "Refresh sources"}</button>
            <a class="burn-btn burn-btn-secondary" href="/burn.html">Open burn rail</a>
          </div>
        </aside>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Protocol burn ledger events</h2>
        <p class="burn-section-copy">Ledger-indexed burns that can already be attributed to a published protocol actor.</p>
        <div class="burn-feed">
          <div class="burn-feed-list">
            ${protocolEntries.length ? protocolEntries.map(renderProtocolBurnRow).join("") : `<div class="burn-empty">No protocol-owned burns are classified yet. That is an honest zero, not a missing widget.</div>`}
          </div>
        </div>
      </section>

      <section class="burn-section">
        <h2 class="burn-section-title">Trench receipts</h2>
        <p class="burn-section-copy">Published route, lock, burn, and proof checkpoints from the trench rail. Exact LP burn inventory can backfill later without changing this surface.</p>
        <div class="burn-feed">
          <div class="burn-feed-list">
            ${checkpointEntries.length ? checkpointEntries.map(renderCheckpointRow).join("") : `<div class="burn-empty">No trench checkpoint receipts are published yet.</div>`}
          </div>
        </div>
      </section>
    </div>`;
}

function renderPage(state) {
  pageState = state;
  APP.innerHTML = buildHtml(state);
  document.getElementById("protocol-refresh")?.addEventListener("click", () => {
    void hydrate(true);
  });
}

async function hydrate(force = false) {
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;
  try {
    const liveData = await fetchBurnSuiteData({
      force,
      includeProtocol: true,
    });

    writeViewCache(CACHE_KEY, {
      prices: liveData.prices,
      burnState: liveData.burnState,
      treasuryAccount: liveData.treasuryAccount,
      trenchState: liveData.trenchState,
    });

    renderPage(buildState(liveData, "live"));
  } finally {
    refreshInFlight = false;
  }
}

async function bootstrap() {
  const cached = readViewCache(CACHE_KEY);
  renderPage(buildState(cached ?? fallbackPublicData(), cached ? "cached" : "loading"));
  await hydrate();
}

void bootstrap();
