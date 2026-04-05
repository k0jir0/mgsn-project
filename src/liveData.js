// Fetch live ICP/USD price from CoinGecko (no API key required for basic tier).
// MGSN and BOB don't have CoinGecko listings yet, so their USD values are
// derived from the per-token ICP price stored in demoDashboard ratios.
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=internet-computer&vs_currencies=usd";

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
