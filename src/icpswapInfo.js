import { TOKEN_CANISTERS } from "./demoData.js";

const ICPSWAP_INFO_ROOT = "https://api.icpswap.com/info";
const REQUEST_TIMEOUT_MS = 15_000;
const SNAPSHOT_CACHE_MS = 60_000;
const CHART_CACHE_MS = 5 * 60_000;

let infoSnapshotCache = null;
let infoSnapshotInFlight = null;
const poolChartCache = new Map();

function isFresh(cache, maxAgeMs) {
  return cache && Date.now() - cache.ts < maxAgeMs;
}

export function asNumber(value) {
  if (value == null) return null;
  const num = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(num) ? num : null;
}

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`ICPSwap request failed: ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeToken(row = {}) {
  return {
    tokenLedgerId: row.tokenLedgerId ?? null,
    tokenName: row.tokenName ?? null,
    tokenSymbol: row.tokenSymbol ?? null,
    price: asNumber(row.price),
    priceChange24H: asNumber(row.priceChange24H),
    tvlUSD: asNumber(row.tvlUSD),
    tvlUSDChange24H: asNumber(row.tvlUSDChange24H),
    txCount24H: asNumber(row.txCount24H),
    volumeUSD24H: asNumber(row.volumeUSD24H),
    volumeUSD7D: asNumber(row.volumeUSD7D),
    totalVolumeUSD: asNumber(row.totalVolumeUSD),
  };
}

function normalizePool(row = {}) {
  return {
    poolId: row.poolId ?? null,
    poolFee: asNumber(row.poolFee),
    token0LedgerId: row.token0LedgerId ?? null,
    token0Name: row.token0Name ?? null,
    token0Symbol: row.token0Symbol ?? null,
    token0LiquidityAmount: asNumber(row.token0LiquidityAmount),
    token0Price: asNumber(row.token0Price),
    token1LedgerId: row.token1LedgerId ?? null,
    token1Name: row.token1Name ?? null,
    token1Symbol: row.token1Symbol ?? null,
    token1LiquidityAmount: asNumber(row.token1LiquidityAmount),
    token1Price: asNumber(row.token1Price),
    tvlUSD: asNumber(row.tvlUSD),
    tvlUSDChange24H: asNumber(row.tvlUSDChange24H),
    txCount24H: asNumber(row.txCount24H),
    feesUSD24H: asNumber(row.feesUSD24H),
    volumeUSD24H: asNumber(row.volumeUSD24H),
    volumeUSD7D: asNumber(row.volumeUSD7D),
    totalVolumeUSD: asNumber(row.totalVolumeUSD),
    createTime: asNumber(row.createTime),
  };
}

function normalizePoolChartPoint(row = {}) {
  return {
    snapshotTime: asNumber(row.snapshotTime),
    level: row.level ?? null,
    poolId: row.poolId ?? null,
    poolFee: asNumber(row.poolFee),
    token0LedgerId: row.token0LedgerId ?? null,
    token0LiquidityAmount: asNumber(row.token0LiquidityAmount),
    token0Price: asNumber(row.token0Price),
    token1LedgerId: row.token1LedgerId ?? null,
    token1LiquidityAmount: asNumber(row.token1LiquidityAmount),
    token1Price: asNumber(row.token1Price),
    tvlUSD: asNumber(row.tvlUSD),
    txCount: asNumber(row.txCount),
    low: asNumber(row.low),
    high: asNumber(row.high),
    open: asNumber(row.open),
    close: asNumber(row.close),
    volumeToken0: asNumber(row.volumeToken0),
    volumeToken1: asNumber(row.volumeToken1),
    volumeUSD: asNumber(row.volumeUSD),
    feesUSD: asNumber(row.feesUSD),
    beginTime: asNumber(row.beginTime),
    endTime: asNumber(row.endTime),
  };
}

function findToken(tokens, { ledgerId, symbol = null, name = null }) {
  return (
    tokens.find((token) => token.tokenLedgerId === ledgerId) ??
    (name ? tokens.find((token) => token.tokenName === name) : null) ??
    (symbol ? tokens.find((token) => token.tokenSymbol === symbol) : null) ??
    null
  );
}

function isPoolMatch(pool, tokenA, tokenB) {
  const ids = [pool.token0LedgerId, pool.token1LedgerId];
  return ids.includes(tokenA) && ids.includes(tokenB);
}

export async function fetchICPSwapInfoSnapshot(force = false) {
  if (!force && isFresh(infoSnapshotCache, SNAPSHOT_CACHE_MS)) {
    return infoSnapshotCache.value;
  }

  if (infoSnapshotInFlight) {
    return infoSnapshotInFlight;
  }

  infoSnapshotInFlight = (async () => {
    const [tokensResult, poolsResult] = await Promise.allSettled([
      fetchJson(`${ICPSWAP_INFO_ROOT}/token/all`),
      fetchJson(`${ICPSWAP_INFO_ROOT}/pool/all`),
    ]);

    if (
      tokensResult.status !== "fulfilled" &&
      poolsResult.status !== "fulfilled"
    ) {
      throw new Error("ICPSwap info snapshot unavailable");
    }

    const tokens =
      tokensResult.status === "fulfilled" && Array.isArray(tokensResult.value?.data)
        ? tokensResult.value.data.map(normalizeToken)
        : [];
    const pools =
      poolsResult.status === "fulfilled" && Array.isArray(poolsResult.value?.data)
        ? poolsResult.value.data.map(normalizePool)
        : [];

    const mgsnToken = findToken(tokens, {
      ledgerId: TOKEN_CANISTERS.MGSN,
      symbol: "MGSN",
    });
    const bobToken = findToken(tokens, {
      ledgerId: TOKEN_CANISTERS.BOB,
      symbol: "BOB",
    });
    const icpToken = findToken(tokens, {
      ledgerId: TOKEN_CANISTERS.ICP,
      name: "Internet Computer",
      symbol: "ICP",
    });

    const mgsnIcpPool =
      pools
        .filter((pool) => isPoolMatch(pool, TOKEN_CANISTERS.MGSN, TOKEN_CANISTERS.ICP))
        .sort((a, b) => (b.tvlUSD ?? 0) - (a.tvlUSD ?? 0))[0] ?? null;

    const value = {
      fetchedAt: Date.now(),
      tokens,
      pools,
      mgsnToken,
      bobToken,
      icpToken,
      mgsnIcpPool,
      totalPairs: pools.length || null,
      mgsnUsd: mgsnToken?.price ?? null,
      bobUsd: bobToken?.price ?? null,
      icpUsd: icpToken?.price ?? null,
      tokensAvailable: tokensResult.status === "fulfilled",
      poolsAvailable: poolsResult.status === "fulfilled",
    };

    infoSnapshotCache = { ts: Date.now(), value };
    return value;
  })();

  try {
    return await infoSnapshotInFlight;
  } finally {
    infoSnapshotInFlight = null;
  }
}

export async function fetchPoolChartDaily(
  poolId,
  { limit = 400, force = false } = {}
) {
  if (!poolId) return [];

  const cacheKey = `${poolId}:${limit}`;
  const cached = poolChartCache.get(cacheKey);
  if (!force && isFresh(cached, CHART_CACHE_MS)) {
    return cached.value;
  }

  const json = await fetchJson(
    `${ICPSWAP_INFO_ROOT}/pool/${poolId}/chart/d1?page=1&limit=${limit}`
  );
  const rows = Array.isArray(json?.data?.content) ? json.data.content : [];
  const value = rows
    .map(normalizePoolChartPoint)
    .filter((point) => point.beginTime != null || point.endTime != null)
    .sort((a, b) => (a.beginTime ?? a.endTime ?? 0) - (b.beginTime ?? b.endTime ?? 0));

  poolChartCache.set(cacheKey, { ts: Date.now(), value });
  return value;
}

export function getPoolDayKey(point) {
  const millis = point?.beginTime ?? point?.endTime;
  return millis != null ? new Date(millis).toISOString().slice(0, 10) : null;
}

export function getPoolSnapshotForDate(points, isoDate) {
  if (!Array.isArray(points) || !points.length || !isoDate) return null;

  const targetMs = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(targetMs)) return null;

  let nearestPrior = null;
  for (const point of points) {
    const begin = point.beginTime ?? point.endTime;
    const end = point.endTime ?? point.beginTime;
    if (begin == null || end == null) continue;
    if (targetMs >= begin && targetMs < end) return point;
    if (begin <= targetMs) nearestPrior = point;
    if (begin > targetMs) break;
  }

  return nearestPrior;
}

export function getPoolTokenUsdPrice(point, tokenLedgerId) {
  if (!point || !tokenLedgerId) return null;
  if (point.token0LedgerId === tokenLedgerId) return point.token0Price ?? null;
  if (point.token1LedgerId === tokenLedgerId) return point.token1Price ?? null;
  return null;
}

export function sumRecentPoolVolume(points, days = 30) {
  if (!Array.isArray(points) || !points.length) return null;
  return points
    .slice(-days)
    .reduce((sum, point) => sum + (point.volumeUSD ?? 0), 0);
}
