import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { demoDashboard } from "./demoData.js";
import { fetchMgsnLedgerSnapshot } from "./onChainData.js";

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=internet-computer&vs_currencies=usd";

const IC_API_HOST = "https://icp-api.io";
const NODE_INDEX_CANISTER = "ggzvv-5qaaa-aaaag-qck7a-cai";
const ICP_CANISTER = "ryjl3-tyaaa-aaaaa-aaaba-cai";
const BOB_CANISTER = "7pail-xaaaa-aaaas-aabmq-cai";
const CURRENT_MGSN_CANISTER = "2rqn6-kiaaa-aaaam-qcuya-cai";
const LEGACY_MGSN_CANISTER = "mgsn7-iiaaa-aaaag-qjvsa-cai";

const agent = new HttpAgent({ host: IC_API_HOST });

const NodeIndexIDL = ({ IDL }) => {
  const PublicTokenOverview = IDL.Record({
    id: IDL.Nat,
    volumeUSD1d: IDL.Float64,
    volumeUSD7d: IDL.Float64,
    totalVolumeUSD: IDL.Float64,
    name: IDL.Text,
    volumeUSD: IDL.Float64,
    feesUSD: IDL.Float64,
    priceUSDChange: IDL.Float64,
    address: IDL.Text,
    txCount: IDL.Int,
    priceUSD: IDL.Float64,
    standard: IDL.Text,
    symbol: IDL.Text,
  });

  return IDL.Service({
    getAllTokens: IDL.Func([], [IDL.Vec(PublicTokenOverview)], ["query"]),
    tokenStorage: IDL.Func([IDL.Text], [IDL.Opt(IDL.Text)], ["query"]),
  });
};

const TokenStorageIDL = ({ IDL }) => {
  const PublicTokenPricesData = IDL.Record({
    id: IDL.Int,
    low: IDL.Float64,
    high: IDL.Float64,
    close: IDL.Float64,
    open: IDL.Float64,
    timestamp: IDL.Int,
  });
  const PublicTokenChartDayData = IDL.Record({
    id: IDL.Int,
    volumeUSD: IDL.Float64,
    timestamp: IDL.Int,
    txCount: IDL.Int,
  });

  return IDL.Service({
    getTokenPricesData: IDL.Func(
      [IDL.Text, IDL.Int, IDL.Int, IDL.Nat],
      [IDL.Vec(PublicTokenPricesData)],
      ["query"]
    ),
    getTokenChartData: IDL.Func(
      [IDL.Text, IDL.Nat, IDL.Nat],
      [IDL.Vec(PublicTokenChartDayData)],
      ["query"]
    ),
  });
};

const nodeIndexActor = Actor.createActor(NodeIndexIDL, {
  agent,
  canisterId: NODE_INDEX_CANISTER,
});

const tokenStorageActors = new Map();
let nodeIndexCache = null;
let dashboardCache = null;
let poolStatsCache = null;

function getTokenStorageActor(canisterId) {
  if (!tokenStorageActors.has(canisterId)) {
    tokenStorageActors.set(
      canisterId,
      Actor.createActor(TokenStorageIDL, { agent, canisterId })
    );
  }

  return tokenStorageActors.get(canisterId);
}

function withTimeout(promise, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isFresh(cache, maxAgeMs) {
  return cache && Date.now() - cache.ts < maxAgeMs;
}

function asNumber(value) {
  if (value == null) return null;
  const num = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(num) ? num : null;
}

function monthKeyFromSeconds(seconds) {
  const d = new Date(seconds * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabelFromKey(key) {
  const [year, month] = key.split("-");
  const d = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return d.toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function compareMonthKeys(a, b) {
  return a.localeCompare(b);
}

function createIcpHistoryMap() {
  return new Map(
    demoDashboard.timeline
      .filter((point) => point.date?.startsWith("20"))
      .map((point) => [point.date.slice(0, 7), point.icpPrice])
  );
}

const icpHistoryByMonth = createIcpHistoryMap();

function getIcpHistoryPrice(monthKey) {
  return icpHistoryByMonth.get(monthKey) ?? demoDashboard.timeline.at(-1)?.icpPrice ?? null;
}

function sumRecentVolume(points, days = 30) {
  if (!points.length) return null;
  return points
    .slice(-days)
    .reduce((sum, point) => sum + (asNumber(point.volumeUSD) ?? 0), 0);
}

function aggregateMonthlyClose(points) {
  const monthly = new Map();
  for (const point of points) {
    const key = monthKeyFromSeconds(point.timestamp);
    monthly.set(key, point.close);
  }
  return monthly;
}

function aggregateMonthlyVolume(points) {
  const monthly = new Map();
  for (const point of points) {
    const key = monthKeyFromSeconds(point.timestamp);
    monthly.set(key, (monthly.get(key) ?? 0) + (asNumber(point.volumeUSD) ?? 0));
  }
  return monthly;
}

async function fetchNodeIndexSnapshot(force = false) {
  if (!force && isFresh(nodeIndexCache, 30_000)) {
    return nodeIndexCache.value;
  }

  const tokens = await withTimeout(nodeIndexActor.getAllTokens(), 12_000);
  const mgsn =
    tokens.find((token) => token.address === CURRENT_MGSN_CANISTER) ??
    tokens.find((token) => token.symbol === "MGSN") ??
    tokens.find((token) => token.address === LEGACY_MGSN_CANISTER) ??
    null;
  const bob =
    tokens.find((token) => token.address === BOB_CANISTER) ??
    tokens.find((token) => token.symbol === "BOB") ??
    null;
  const icp =
    tokens.find((token) => token.address === ICP_CANISTER) ??
    tokens.find((token) => token.symbol === "ICP") ??
    null;

  const [mgsnStorageOpt, bobStorageOpt] = await Promise.all([
    withTimeout(nodeIndexActor.tokenStorage(mgsn?.address ?? CURRENT_MGSN_CANISTER), 12_000),
    withTimeout(nodeIndexActor.tokenStorage(BOB_CANISTER), 12_000),
  ]);

  const value = {
    mgsn,
    bob,
    icp,
    mgsnCanister: mgsn?.address ?? CURRENT_MGSN_CANISTER,
    bobCanister: BOB_CANISTER,
    mgsnStorageCanister: mgsnStorageOpt?.[0] ?? null,
    bobStorageCanister: bobStorageOpt?.[0] ?? null,
  };

  nodeIndexCache = { ts: Date.now(), value };
  return value;
}

async function fetchTokenStorageSeries(storageCanister, tokenCanister) {
  if (!storageCanister) {
    return { prices: [], volume: [] };
  }

  const actor = getTokenStorageActor(storageCanister);
  const [priceRows, volumeRows] = await Promise.all([
    withTimeout(actor.getTokenPricesData(tokenCanister, 0n, 86_400n, 500n), 12_000),
    withTimeout(actor.getTokenChartData(tokenCanister, 0n, 500n), 12_000),
  ]);

  const prices = priceRows
    .map((row) => ({
      timestamp: asNumber(row.timestamp),
      close: asNumber(row.close),
    }))
    .filter((row) => row.timestamp != null && row.close != null)
    .sort((a, b) => a.timestamp - b.timestamp);

  const volume = volumeRows
    .map((row) => ({
      timestamp: asNumber(row.timestamp),
      volumeUSD: asNumber(row.volumeUSD),
    }))
    .filter((row) => row.timestamp != null && row.volumeUSD != null)
    .sort((a, b) => a.timestamp - b.timestamp);

  return { prices, volume };
}

function buildLivePoint({ icpUsd, snapshot, poolStats, fallbackLast }) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);

  return {
    period: "Live",
    date,
    icpPrice: icpUsd ?? fallbackLast?.icpPrice ?? demoDashboard.timeline.at(-1)?.icpPrice ?? 0,
    bobPrice: asNumber(snapshot.bob?.priceUSD) ?? fallbackLast?.bobPrice ?? 0,
    mgsnPrice: asNumber(snapshot.mgsn?.priceUSD) ?? fallbackLast?.mgsnPrice ?? 0,
    bobVolume: poolStats.bobVol24h ?? 0,
    mgsnVolume: poolStats.mgsnVol24h ?? 0,
    bobLiquidity: null,
    mgsnLiquidity: null,
  };
}

function buildDashboard({
  icpUsd,
  snapshot,
  mgsnSeries,
  bobSeries,
  poolStats,
  ledgerSnapshot,
}) {
  const mgsnMonthlyPrices = aggregateMonthlyClose(mgsnSeries.prices);
  const bobMonthlyPrices = aggregateMonthlyClose(bobSeries.prices);
  const mgsnMonthlyVolume = aggregateMonthlyVolume(mgsnSeries.volume);
  const bobMonthlyVolume = aggregateMonthlyVolume(bobSeries.volume);

  const overlappingMonths = [...mgsnMonthlyPrices.keys()]
    .filter((key) => bobMonthlyPrices.has(key))
    .sort(compareMonthKeys);

  if (!overlappingMonths.length) {
    return null;
  }

  const historyTimeline = overlappingMonths.map((key) => ({
    period: monthLabelFromKey(key),
    date: `${key}-01`,
    icpPrice: getIcpHistoryPrice(key) ?? icpUsd ?? 0,
    bobPrice: bobMonthlyPrices.get(key),
    mgsnPrice: mgsnMonthlyPrices.get(key),
    bobVolume: bobMonthlyVolume.get(key) ?? 0,
    mgsnVolume: mgsnMonthlyVolume.get(key) ?? 0,
    bobLiquidity: null,
    mgsnLiquidity: null,
  }));

  const timeline = [...historyTimeline];
  const livePoint = buildLivePoint({
    icpUsd,
    snapshot,
    poolStats,
    fallbackLast: historyTimeline.at(-1),
  });
  timeline.push(livePoint);

  const startLabel = historyTimeline[0].period;
  const endLabel = historyTimeline.at(-1).period;

  return {
    ...demoDashboard,
    title: "MGSN Strategy Tracker",
    subtitle: "Live ICPSwap spot data with on-chain monthly closes for MGSN and BOB.",
    heroNote:
      "Dashboard metrics now prefer ICPSwap canister data directly. Historical charts use overlapping monthly closes from token storage plus a current live spot point.",
    dataSource:
      "MGSN/BOB spot and token stats from ICPSwap NodeIndex. Daily OHLC and volume from ICPSwap TokenStorage, aggregated monthly. ICP spot from CoinGecko.",
    updatedAt: BigInt(Date.now()) * 1_000_000n,
    mgsnSupply: ledgerSnapshot?.currentSupply ?? demoDashboard.mgsnSupply,
    timeline,
    marketStats: {
      historyStartLabel: startLabel,
      historyEndLabel: endLabel,
      icpSpotLive: icpUsd != null,
      mgsnVol24h: poolStats.mgsnVol24h,
      bobVol24h: poolStats.bobVol24h,
      mgsnVol30d: poolStats.mgsnVol30d,
      bobVol30d: poolStats.bobVol30d,
      totalLiquidityUsd: null,
      totalPairs: null,
      mgsnCanister: snapshot.mgsnCanister,
      bobCanister: snapshot.bobCanister,
    },
  };
}

export async function fetchLiveSpotPrices() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    const res = await fetch(COINGECKO_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) return {};
    const json = await res.json();
    const icpUsd = json?.["internet-computer"]?.usd ?? null;
    return { icpUsd };
  } catch {
    return {};
  }
}

export async function fetchICPSwapPrices(force = false) {
  try {
    const snapshot = await fetchNodeIndexSnapshot(force);
    return {
      mgsnUsd: asNumber(snapshot.mgsn?.priceUSD),
      bobUsd: asNumber(snapshot.bob?.priceUSD),
      mgsnCanister: snapshot.mgsnCanister,
      bobCanister: snapshot.bobCanister,
    };
  } catch {
    return {};
  }
}

export async function fetchICPSwapPoolStats(force = false) {
  if (!force && isFresh(poolStatsCache, 60_000)) {
    return poolStatsCache.value;
  }

  try {
    const snapshot = await fetchNodeIndexSnapshot(force);
    const [mgsnResult, bobResult] = await Promise.allSettled([
      fetchTokenStorageSeries(snapshot.mgsnStorageCanister, snapshot.mgsnCanister),
      fetchTokenStorageSeries(snapshot.bobStorageCanister, snapshot.bobCanister),
    ]);
    const mgsnSeries = mgsnResult.status === "fulfilled" ? mgsnResult.value : { prices: [], volume: [] };
    const bobSeries = bobResult.status === "fulfilled" ? bobResult.value : { prices: [], volume: [] };

    const value = {
      mgsnVol24h: asNumber(snapshot.mgsn?.volumeUSD1d),
      bobVol24h: asNumber(snapshot.bob?.volumeUSD1d),
      mgsnVol30d: sumRecentVolume(mgsnSeries.volume, 30),
      bobVol30d: sumRecentVolume(bobSeries.volume, 30),
      mgsnLiq: null,
      bobLiq: null,
      mgsnStorageCanister: snapshot.mgsnStorageCanister,
      bobStorageCanister: snapshot.bobStorageCanister,
    };

    poolStatsCache = { ts: Date.now(), value };
    return value;
  } catch {
    return {};
  }
}

export async function fetchDashboardData(force = false) {
  if (!force && isFresh(dashboardCache, 60_000)) {
    return dashboardCache.value;
  }

  try {
    const [spot, snapshot, poolStats, ledgerSnapshot] = await Promise.all([
      fetchLiveSpotPrices(),
      fetchNodeIndexSnapshot(force),
      fetchICPSwapPoolStats(force),
      fetchMgsnLedgerSnapshot(force),
    ]);

    const [mgsnSeries, bobSeries] = await Promise.all([
      fetchTokenStorageSeries(snapshot.mgsnStorageCanister, snapshot.mgsnCanister),
      fetchTokenStorageSeries(snapshot.bobStorageCanister, snapshot.bobCanister),
    ]);

    const dashboard = buildDashboard({
      icpUsd: spot.icpUsd ?? null,
      snapshot,
      mgsnSeries,
      bobSeries,
      poolStats,
      ledgerSnapshot,
    });

    if (!dashboard) return null;

    dashboardCache = { ts: Date.now(), value: dashboard };
    return dashboard;
  } catch {
    return null;
  }
}
