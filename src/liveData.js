// Fetch live ICP/USD price from CoinGecko (no API key required for basic tier).
// MGSN and BOB don't have CoinGecko listings yet, so their USD values are
// derived from the per-token ICP price stored in demoDashboard ratios.
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=internet-computer&vs_currencies=usd";

// ICPSwap NodeIndex canister — getAllTokens() returns live USD prices for all
// tokens that have pools, including MGSN and BOB.
// The canister is query-only and publicly accessible via the ICP boundary nodes.
const ICPSWAP_NODE_INDEX_URL =
  "https://ggzvv-5qaaa-aaaag-qck7a-cai.raw.icp0.io/";
const MGSN_CANISTER = "mgsn7-iiaaa-aaaag-qjvsa-cai";
const BOB_CANISTER  = "7pail-xaaaa-aaaas-aabmq-cai";

// ICPSwap TokenStorage canister for BOB provides on-chain price history.
// We use their public REST interface at:
const ICPSWAP_INFO_URL = "https://uvevg-iyaaa-aaaak-ac27q-cai.raw.icp0.io/";

/**
 * Returns { icpUsd: number | null }.
 * Never throws — failures produce a null value so callers can fall back to demo.
 */
export async function fetchLiveSpotPrices() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
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

/**
 * Fetch live MGSN and BOB prices from ICPSwap's NodeIndex canister.
 * Returns { mgsnUsd: number|null, bobUsd: number|null }.
 * Never throws.
 */
export async function fetchICPSwapPrices() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    // ICPSwap NodeIndex exposes a /getAllTokens HTTP endpoint on raw ICP boundary
    const res = await fetch(`${ICPSWAP_NODE_INDEX_URL}getAllTokens`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) return {};
    const tokens = await res.json();
    if (!Array.isArray(tokens)) return {};
    let mgsnUsd = null, bobUsd = null;
    for (const t of tokens) {
      const id = t?.address ?? t?.canisterId ?? t?.ledgerId ?? "";
      if (id === MGSN_CANISTER) mgsnUsd = parseFloat(t?.priceUSD ?? t?.price ?? 0) || null;
      if (id === BOB_CANISTER)  bobUsd  = parseFloat(t?.priceUSD ?? t?.price ?? 0) || null;
    }
    return { mgsnUsd, bobUsd };
  } catch {
    return {};
  }
}

/**
 * Fetch 24-hour volume and liquidity stats from ICPSwap info API.
 * Returns { mgsnVol24h, bobVol24h, mgsnLiq, bobLiq } all number|null.
 */
export async function fetchICPSwapPoolStats() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${ICPSWAP_INFO_URL}token/list`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) return {};
    const data = await res.json();
    const list = data?.data ?? data ?? [];
    if (!Array.isArray(list)) return {};
    let mgsnVol24h = null, bobVol24h = null, mgsnLiq = null, bobLiq = null;
    for (const t of list) {
      const id = t?.address ?? t?.canisterId ?? "";
      if (id === MGSN_CANISTER) {
        mgsnVol24h = parseFloat(t?.volumeUSD ?? t?.volume24H ?? 0) || null;
        mgsnLiq    = parseFloat(t?.tvlUSD    ?? t?.liquidity  ?? 0) || null;
      }
      if (id === BOB_CANISTER) {
        bobVol24h  = parseFloat(t?.volumeUSD ?? t?.volume24H ?? 0) || null;
        bobLiq     = parseFloat(t?.tvlUSD    ?? t?.liquidity  ?? 0) || null;
      }
    }
    return { mgsnVol24h, bobVol24h, mgsnLiq, bobLiq };
  } catch {
    return {};
  }
}
