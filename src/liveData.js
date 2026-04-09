import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { createUnavailableDashboard } from "./liveDefaults.js";
import {
  asNumber,
  fetchICPSwapInfoSnapshot,
  fetchPoolChartDaily,
  sumRecentPoolVolume,
} from "./icpswapInfo.js";
import { fetchMgsnLedgerSnapshot, fetchTokenLedgerSnapshot } from "./onChainData.js";

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
let poolStatsInFlight = null;
let dashboardInFlight = null;

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

function monthKeyFromSeconds(seconds) {
  const d = new Date(seconds * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthKeyFromMillis(millis) {
  const d = new Date(millis);
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

function aggregateMonthlyPoolLast(points, accessor) {
  const monthly = new Map();
  for (const point of points) {
    const key = monthKeyFromMillis(point.beginTime ?? point.endTime ?? 0);
    monthly.set(key, accessor(point));
  }
  return monthly;
}

function aggregateMonthlyPoolSum(points, accessor) {
  const monthly = new Map();
  for (const point of points) {
    const key = monthKeyFromMillis(point.beginTime ?? point.endTime ?? 0);
    monthly.set(key, (monthly.get(key) ?? 0) + (accessor(point) ?? 0));
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

  const [mgsnStorageOpt, bobStorageOpt, icpStorageOpt] = await Promise.all([
    withTimeout(nodeIndexActor.tokenStorage(mgsn?.address ?? CURRENT_MGSN_CANISTER), 12_000),
    withTimeout(nodeIndexActor.tokenStorage(BOB_CANISTER), 12_000),
    withTimeout(nodeIndexActor.tokenStorage(ICP_CANISTER), 12_000),
  ]);

  const value = {
    mgsn,
    bob,
    icp,
    mgsnCanister: mgsn?.address ?? CURRENT_MGSN_CANISTER,
    bobCanister: BOB_CANISTER,
    mgsnStorageCanister: mgsnStorageOpt?.[0] ?? null,
    bobStorageCanister: bobStorageOpt?.[0] ?? null,
    icpStorageCanister: icpStorageOpt?.[0] ?? null,
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

function buildLivePoint({ icpUsd, snapshot, poolStats, infoSnapshot }) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);

  return {
    period: "Live",
    date,
    icpPrice: icpUsd ?? null,
    bobPrice:
      infoSnapshot?.bobUsd ??
      asNumber(snapshot.bob?.priceUSD) ??
      null,
    mgsnPrice:
      infoSnapshot?.mgsnUsd ??
      asNumber(snapshot.mgsn?.priceUSD) ??
      null,
    bobVolume: poolStats.bobVol24h ?? null,
    mgsnVolume: poolStats.mgsnVol24h ?? null,
    bobLiquidity: poolStats.bobLiq ?? null,
    mgsnLiquidity: poolStats.mgsnLiq ?? null,
  };
}

function buildDashboard({
  icpUsd,
  snapshot,
  infoSnapshot,
  icpSeries,
  mgsnSeries,
  bobSeries,
  poolStats,
  ledgerSnapshot,
  bobLedgerSnapshot,
}) {
  const baseDashboard = createUnavailableDashboard();
  const icpMonthlyPrices = aggregateMonthlyClose(icpSeries.prices);
  const mgsnMonthlyPrices = aggregateMonthlyClose(mgsnSeries.prices);
  const bobMonthlyPrices = aggregateMonthlyClose(bobSeries.prices);
  const mgsnMonthlyVolume = aggregateMonthlyVolume(mgsnSeries.volume);
  const bobMonthlyVolume = aggregateMonthlyVolume(bobSeries.volume);
  const poolMonthlyVolume = aggregateMonthlyPoolSum(
    poolStats.mgsnPoolChart ?? [],
    (point) => point.volumeUSD ?? 0
  );
  const poolMonthlyLiquidity = aggregateMonthlyPoolLast(
    poolStats.mgsnPoolChart ?? [],
    (point) => point.tvlUSD ?? null
  );

  const overlappingMonths = [...mgsnMonthlyPrices.keys()]
    .filter((key) => bobMonthlyPrices.has(key) && icpMonthlyPrices.has(key))
    .sort(compareMonthKeys);

  if (!overlappingMonths.length) {
    return null;
  }

  const historyTimeline = overlappingMonths.map((key) => ({
    period: monthLabelFromKey(key),
    date: `${key}-01`,
    icpPrice: icpMonthlyPrices.get(key) ?? null,
    bobPrice: bobMonthlyPrices.get(key),
    mgsnPrice: mgsnMonthlyPrices.get(key),
    bobVolume: bobMonthlyVolume.get(key) ?? 0,
    mgsnVolume: poolMonthlyVolume.get(key) ?? mgsnMonthlyVolume.get(key) ?? 0,
    bobLiquidity: null,
    mgsnLiquidity: poolMonthlyLiquidity.get(key) ?? null,
  }));

  const timeline = [...historyTimeline];
  timeline.push(
    buildLivePoint({
      icpUsd,
      snapshot,
      poolStats,
      infoSnapshot,
    })
  );

  const startLabel = historyTimeline[0].period;
  const endLabel = historyTimeline.at(-1).period;

  return {
    ...baseDashboard,
    title: "MGSN Strategy Tracker",
    subtitle: "Live ICPSwap spot, pool, and ledger data for MGSN and BOB.",
    heroNote:
      "Dashboard metrics use live ICPSwap spot, pool, token-storage, and ledger data only. Historical charts render overlapping monthly closes for ICP, BOB, and MGSN, plus a live spot point when current prices are available.",
    dataSource:
      "Spot prices, token TVL, and pair stats from the official ICPSwap info API. Daily OHLC and token volume from ICPSwap TokenStorage canisters. Token supply from live ICRC ledgers.",
    updatedAt: BigInt(Date.now()) * 1_000_000n,
    bobSupply: bobLedgerSnapshot?.currentSupply ?? null,
    mgsnSupply: ledgerSnapshot?.currentSupply ?? null,
    icpswapTvl: poolStats.mgsnLiq ?? null,
    icpswapVolume: poolStats.mgsnVol30d ?? null,
    icpswapPairs: infoSnapshot?.totalPairs ?? null,
    timeline,
    marketStats: {
      historyStartLabel: startLabel,
      historyEndLabel: endLabel,
      icpSpotLive: icpUsd != null,
      mgsnVol24h: poolStats.mgsnVol24h,
      bobVol24h: poolStats.bobVol24h,
      mgsnVol30d: poolStats.mgsnVol30d,
      bobVol30d: poolStats.bobVol30d,
      totalLiquidityUsd: poolStats.mgsnLiq ?? null,
      totalPairs: infoSnapshot?.totalPairs ?? null,
      mgsnCanister: snapshot.mgsnCanister,
      bobCanister: snapshot.bobCanister,
      mgsnPoolId: poolStats.mgsnPoolId ?? null,
    },
  };
}

export async function fetchLiveSpotPrices(force = false) {
  try {
    const infoSnapshot = await fetchICPSwapInfoSnapshot(force);
    return { icpUsd: infoSnapshot.icpUsd ?? null };
  } catch {
    return {};
  }
}

export async function fetchICPSwapPrices(force = false) {
  try {
    const [snapshot, infoSnapshot] = await Promise.all([
      fetchNodeIndexSnapshot(force),
      fetchICPSwapInfoSnapshot(force),
    ]);

    return {
      mgsnUsd: infoSnapshot.mgsnUsd ?? asNumber(snapshot.mgsn?.priceUSD),
      bobUsd: infoSnapshot.bobUsd ?? asNumber(snapshot.bob?.priceUSD),
      mgsnCanister: snapshot.mgsnCanister,
      bobCanister: snapshot.bobCanister,
    };
  } catch {
    return {};
  }
}

export async function fetchICPSwapPoolStats(force = false, shared = {}) {
  if (!force && isFresh(poolStatsCache, 60_000)) {
    return poolStatsCache.value;
  }

  if (poolStatsInFlight) {
    return poolStatsInFlight;
  }

  poolStatsInFlight = (async () => {
    try {
      const snapshot = shared.snapshot ?? await fetchNodeIndexSnapshot(force);
      const infoSnapshot = shared.infoSnapshot ?? await fetchICPSwapInfoSnapshot(force);

      const mgsnPool = infoSnapshot.mgsnIcpPool ?? null;
      const [bobResult, poolChartResult] = await Promise.allSettled([
        fetchTokenStorageSeries(snapshot.bobStorageCanister, snapshot.bobCanister),
        mgsnPool
          ? fetchPoolChartDaily(mgsnPool.poolId, { limit: 400, force })
          : Promise.resolve([]),
      ]);

      const bobSeries =
        bobResult.status === "fulfilled" ? bobResult.value : { prices: [], volume: [] };
      const mgsnPoolChart =
        poolChartResult.status === "fulfilled" ? poolChartResult.value : [];

      const value = {
        mgsnVol24h:
          mgsnPool?.volumeUSD24H ??
          infoSnapshot.mgsnToken?.volumeUSD24H ??
          asNumber(snapshot.mgsn?.volumeUSD1d),
        bobVol24h:
          infoSnapshot.bobToken?.volumeUSD24H ?? asNumber(snapshot.bob?.volumeUSD1d),
        mgsnVol30d:
          sumRecentPoolVolume(mgsnPoolChart, 30) ??
          (infoSnapshot.mgsnToken?.volumeUSD7D != null
            ? infoSnapshot.mgsnToken.volumeUSD7D * (30 / 7)
            : null) ??
          null,
        bobVol30d:
          sumRecentVolume(bobSeries.volume, 30) ??
          (infoSnapshot.bobToken?.volumeUSD7D != null
            ? infoSnapshot.bobToken.volumeUSD7D * (30 / 7)
            : null),
        mgsnLiq: mgsnPool?.tvlUSD ?? infoSnapshot.mgsnToken?.tvlUSD ?? null,
        bobLiq: null,
        mgsnPoolId: mgsnPool?.poolId ?? null,
        mgsnPoolChart,
        mgsnStorageCanister: snapshot.mgsnStorageCanister,
        bobStorageCanister: snapshot.bobStorageCanister,
      };

      poolStatsCache = { ts: Date.now(), value };
      return value;
    } catch {
      return {};
    } finally {
      poolStatsInFlight = null;
    }
  })();

  return poolStatsInFlight;
}

export async function fetchDashboardData(force = false) {
  if (!force && isFresh(dashboardCache, 60_000)) {
    return dashboardCache.value;
  }

  if (dashboardInFlight) {
    return dashboardInFlight;
  }

  dashboardInFlight = (async () => {
    try {
      const [snapshot, infoSnapshot, ledgerSnapshot, bobLedgerSnapshot] = await Promise.all([
        fetchNodeIndexSnapshot(force),
        fetchICPSwapInfoSnapshot(force),
        fetchMgsnLedgerSnapshot(force),
        fetchTokenLedgerSnapshot(BOB_CANISTER, force),
      ]);

      const [poolStats, icpSeries, mgsnSeries, bobSeries] = await Promise.all([
        fetchICPSwapPoolStats(force, { snapshot, infoSnapshot }),
        fetchTokenStorageSeries(snapshot.icpStorageCanister, ICP_CANISTER),
        fetchTokenStorageSeries(snapshot.mgsnStorageCanister, snapshot.mgsnCanister),
        fetchTokenStorageSeries(snapshot.bobStorageCanister, snapshot.bobCanister),
      ]);

      const dashboard = buildDashboard({
        icpUsd: infoSnapshot.icpUsd ?? null,
        snapshot,
        infoSnapshot,
        icpSeries,
        mgsnSeries,
        bobSeries,
        poolStats,
        ledgerSnapshot,
        bobLedgerSnapshot,
      });

      if (!dashboard) return null;

      dashboardCache = { ts: Date.now(), value: dashboard };
      return dashboard;
    } catch {
      return null;
    } finally {
      dashboardInFlight = null;
    }
  })();

  return dashboardInFlight;
}
