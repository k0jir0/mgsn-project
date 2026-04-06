/**
 * fetch-real-data.mjs
 * 1. Calls ICPSwap NodeIndex getAllTokens() for current prices
 * 2. Calls NodeIndex tokenStorage(tokenId) to get sub-canister IDs
 * 3. Calls TokenStorage getTokenPricesData() for OHLC history
 * 4. Calls CoinGecko for ICP/USD price history
 */
import { HttpAgent, Actor } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import https from "https";

// ── Canister IDs ──────────────────────────────────────────────────────────────
const NODE_INDEX_ID = "ggzvv-5qaaa-aaaag-qck7a-cai";  // ICPSwap NodeIndex
const MGSN_ID = "mgsn7-iiaaa-aaaag-qjvsa-cai";
const BOB_ID  = "7pail-xaaaa-aaaas-aabmq-cai";

// ── Candid: NodeIndex (getAllTokens + tokenStorage) ───────────────────────────
const NodeIndexIDL = ({ IDL }) => {
  const PublicTokenOverview = IDL.Record({
    id:            IDL.Nat,
    volumeUSD1d:   IDL.Float64,
    volumeUSD7d:   IDL.Float64,
    totalVolumeUSD:IDL.Float64,
    name:          IDL.Text,
    volumeUSD:     IDL.Float64,
    feesUSD:       IDL.Float64,
    priceUSDChange:IDL.Float64,
    address:       IDL.Text,
    txCount:       IDL.Int,
    priceUSD:      IDL.Float64,
    standard:      IDL.Text,
    symbol:        IDL.Text,
  });
  return IDL.Service({
    getAllTokens:  IDL.Func([], [IDL.Vec(PublicTokenOverview)], ["query"]),
    tokenStorage: IDL.Func([IDL.Text], [IDL.Opt(IDL.Text)],    ["query"]),
  });
};

// ── Candid: TokenStorage (OHLC price history + volume) ───────────────────────
const TokenStorageIDL = ({ IDL }) => {
  const PublicTokenPricesData = IDL.Record({
    id:        IDL.Int,
    low:       IDL.Float64,
    high:      IDL.Float64,
    close:     IDL.Float64,
    open:      IDL.Float64,
    timestamp: IDL.Int,
  });
  const PublicTokenChartDayData = IDL.Record({
    id:        IDL.Int,
    volumeUSD: IDL.Float64,
    timestamp: IDL.Int,
    txCount:   IDL.Int,
  });
  return IDL.Service({
    // getTokenPricesData(tokenId, time, interval, limit)
    // time=0 means earliest, interval in seconds (86400=daily), limit=max records
    getTokenPricesData: IDL.Func(
      [IDL.Text, IDL.Int, IDL.Int, IDL.Nat],
      [IDL.Vec(PublicTokenPricesData)],
      ["query"]
    ),
    // getTokenChartData(tokenId, offset, limit) — daily volume
    getTokenChartData: IDL.Func(
      [IDL.Text, IDL.Nat, IDL.Nat],
      [IDL.Vec(PublicTokenChartDayData)],
      ["query"]
    ),
  });
};

// ── Simple HTTPS GET helper ───────────────────────────────────────────────────
function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "node/fetch-real-data" } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchRaw(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

// ── CoinGecko: ICP monthly price history ─────────────────────────────────────
async function fetchICPPriceHistory() {
  console.log("Fetching ICP/USD price history from CoinGecko...");
  // Fetch recent 365 days first (free tier limit)
  const monthly = {};
  for (const days of [365, 180, 90]) {
    const url = `https://api.coingecko.com/api/v3/coins/internet-computer/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    try {
      const { status, body } = await fetchRaw(url);
      if (status === 200) {
        const json = JSON.parse(body);
        if (!Array.isArray(json.prices)) continue;
        for (const [ts, price] of json.prices) {
          const d = new Date(ts);
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
          monthly[key] = price;
        }
        console.log(`  CoinGecko days=${days}: ${json.prices.length} daily points → ${Object.keys(monthly).length} months so far`);
        break;
      }
      console.warn(`  CoinGecko days=${days} HTTP ${status} — trying shorter range`);
    } catch (e) {
      console.warn(`  CoinGecko days=${days} error: ${e.message}`);
    }
  }

  // Backfill older months with point-in-time history endpoint (Jul 2024 → Mar 2025)
  const missingMonths = [];
  let y = 2024, m = 7;
  const lastWanted = { y: 2025, m: 3 };
  while (y < lastWanted.y || (y === lastWanted.y && m <= lastWanted.m)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (!(key in monthly)) {
      // CoinGecko history endpoint uses DD-MM-YYYY format
      missingMonths.push({ key, date: `01-${String(m).padStart(2, "0")}-${y}` });
    }
    m++; if (m > 12) { m = 1; y++; }
  }

  if (missingMonths.length > 0) {
    console.log(`  CoinGecko can't fetch ${missingMonths.length} older months (restricted) — trying Binance...`);
    // Binance public klines API: no auth required
    const startMs = new Date("2024-07-01").getTime();
    const url = `https://api.binance.com/api/v3/klines?symbol=ICPUSDT&interval=1M&startTime=${startMs}&limit=24`;
    try {
      const { status, body } = await fetchRaw(url);
      if (status === 200) {
        const klines = JSON.parse(body);
        for (const k of klines) {
          // k[0] = open_time_ms, k[4] = close_price
          const d = new Date(k[0]);
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
          if (!(key in monthly)) {
            monthly[key] = parseFloat(k[4]);
          }
        }
        console.log(`  Binance: added ICP monthly prices, total now ${Object.keys(monthly).length} months`);
      } else {
        console.warn(`  Binance HTTP ${status}`);
      }
    } catch (e) {
      console.warn(`  Binance error: ${e.message}`);
    }
  }

  const count = Object.keys(monthly).length;
  if (count === 0) { console.warn("  All CoinGecko sources failed"); return null; }
  console.log(`  Total ICP months: ${count}`);
  return monthly;
}

// ── ICPSwap: get current token overviews + storage canister IDs ──────────────
async function fetchNodeIndexData() {
  console.log("Fetching NodeIndex getAllTokens()...");
  const agent = new HttpAgent({ host: "https://icp-api.io" });
  const nodeIndex = Actor.createActor(NodeIndexIDL, { agent, canisterId: NODE_INDEX_ID });

  const tokens = await nodeIndex.getAllTokens();
  const mgsn = tokens.find(t => t.address === MGSN_ID || t.symbol === "MGSN");
  const bob  = tokens.find(t => t.address === BOB_ID  || t.symbol === "BOB");

  console.log(`  Total tokens: ${tokens.length}`);
  if (mgsn) console.log(`  MGSN current: $${mgsn.priceUSD.toPrecision(6)}, vol1d: $${mgsn.volumeUSD1d.toFixed(0)}`);
  else      console.warn("  MGSN not found in token list");
  if (bob)  console.log(`  BOB  current: $${bob.priceUSD.toPrecision(6)}, vol1d: $${bob.volumeUSD1d.toFixed(0)}`);
  else      console.warn("  BOB  not found in token list");

  // Get storage sub-canister IDs
  console.log("Fetching storage canister IDs...");
  const [mgsnStorageId, bobStorageId] = await Promise.all([
    nodeIndex.tokenStorage(MGSN_ID),
    nodeIndex.tokenStorage(BOB_ID),
  ]);
  const mgsnSC = mgsnStorageId[0] ?? null;
  const bobSC  = bobStorageId[0]  ?? null;
  console.log("  MGSN storage canister:", mgsnSC ?? "NONE");
  console.log("  BOB  storage canister:", bobSC  ?? "NONE");

  return { mgsn, bob, mgsnSC, bobSC, agent };
}

// ── ICPSwap: fetch OHLC price history from a storage sub-canister ─────────────
async function fetchTokenPricesFromStorage(storageCanisterId, tokenId, label, agent) {
  if (!storageCanisterId) {
    console.warn(`  ${label}: no storage canister — skipping history`);
    return { prices: null, volume: null };
  }
  console.log(`Fetching ${label} OHLC from storage canister ${storageCanisterId}...`);
  const sc = Actor.createActor(TokenStorageIDL, { agent, canisterId: storageCanisterId });

  // getTokenPricesData(tokenId, time=0, interval=86400, limit=500)
  // time=0 → from earliest; interval=86400 seconds (daily); limit=500 days
  let prices = null;
  try {
    const raw = await sc.getTokenPricesData(tokenId, 0n, 86400n, 500n);
    if (raw.length > 0) {
      prices = raw.map(p => ({
        timestamp: Number(p.timestamp),
        open: p.open, high: p.high, low: p.low, close: p.close,
      }));
      console.log(`  ${label} prices: ${prices.length} daily OHLC points`);
      const first = new Date(prices[0].timestamp * 1000);
      const last  = new Date(prices[prices.length - 1].timestamp * 1000);
      console.log(`  Range: ${first.toISOString().slice(0,10)} → ${last.toISOString().slice(0,10)}`);
    } else {
      console.warn(`  ${label} getTokenPricesData: empty result`);
    }
  } catch (e) {
    console.warn(`  ${label} getTokenPricesData failed:`, e.message);
  }

  // getTokenChartData(tokenId, offset=0, limit=500) — volume per day
  let volume = null;
  try {
    const raw = await sc.getTokenChartData(tokenId, 0n, 500n);
    if (raw.length > 0) {
      volume = {};
      for (const p of raw) {
        const ts = Number(p.timestamp);
        const d = new Date(ts * 1000);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        volume[key] = (volume[key] ?? 0) + p.volumeUSD;
      }
      console.log(`  ${label} volume: ${raw.length} daily points → ${Object.keys(volume).length} months`);
    }
  } catch (e) {
    console.warn(`  ${label} getTokenChartData failed:`, e.message);
  }

  // Sort prices ascending (storage returns newest first)
  if (prices) prices.sort((a, b) => a.timestamp - b.timestamp);

  return { prices, volume };
}

// ── Build monthly timeline ────────────────────────────────────────────────────
function buildTimeline(icpPrices, mgsnPrices, bobPrices, mgsnVolume, bobVolume, mgsnCurrent, bobCurrent) {
  // Generate month keys Jul 2024 → current month (up to Apr 2026 max)
  const months = [];
  const now = new Date();
  let y = 2024, m = 7;
  while ((y < now.getUTCFullYear()) || (y === now.getUTCFullYear() && m <= now.getUTCMonth() + 1)) {
    months.push({ y, m });
    if (y > 2026 || (y === 2026 && m >= 4)) break;
    m++; if (m > 12) { m = 1; y++; }
  }

  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Index OHLC prices by month key; sort is ASC so last write = month-end close
  const mgsnByMonth = {};
  const bobByMonth  = {};
  if (mgsnPrices) {
    for (const p of mgsnPrices) {
      const d = new Date(p.timestamp * 1000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      mgsnByMonth[key] = p.close;
    }
  }
  // Earliest/latest known BOB price for backfill beyond history range
  let bobFirstPrice = null, bobLastPrice = null;
  if (bobPrices) {
    for (const p of bobPrices) {
      const d = new Date(p.timestamp * 1000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      bobByMonth[key] = p.close;
    }
    bobFirstPrice = bobPrices[0]?.close ?? null;
    bobLastPrice  = bobPrices[bobPrices.length - 1]?.close ?? null;
  }

  return months.map(({ y, m }) => {
    const key    = `${y}-${String(m).padStart(2, "0")}`;
    const period = `${monthNames[m - 1]} ${y}`;
    const date   = `${key}-01`;

    const icp     = icpPrices?.[key]  ?? 0;
    // For BOB: OHLC where available; first known price for pre-history; last known / overview for post-history
    const bob = key in bobByMonth
      ? bobByMonth[key]
      : (key < Object.keys(bobByMonth).sort()[0] ? (bobFirstPrice ?? 0) : (bobLastPrice ?? bobCurrent?.priceUSD ?? 0));
    const mgsn    = mgsnByMonth[key]  ?? (mgsnCurrent?.priceUSD ?? 0);
    const mgsnVol = mgsnVolume?.[key] ?? 0;
    const bobVol  = bobVolume?.[key]  ?? 0;

    return { period, date, icp, mgsn, bob, mgsnVol, bobVol };
  });
}

// ── Format as JS module ───────────────────────────────────────────────────────
function formatAsJS(timeline, hadRealMgsn, hadRealBob) {
  const rows = timeline.map(p =>
    `    { period: "${p.period}", date: "${p.date}", icpPrice: ${p.icp.toFixed(4)}, ` +
    `bobPrice: ${p.bob.toFixed(8)}, mgsnPrice: ${p.mgsn.toFixed(8)}, ` +
    `bobVolume: ${Math.round(p.bobVol)}, mgsnVolume: ${Math.round(p.mgsnVol)}, ` +
    `bobLiquidity: ${Math.round(p.bobVol * 2)}, mgsnLiquidity: ${Math.round(p.mgsnVol * 2)} }`
  ).join(",\n");

  const src = `// ICP: ${hadRealBob ? "REAL" : "SEEDED"} — MGSN: ${hadRealMgsn ? "REAL" : "SEEDED"} — BOB: ${hadRealBob ? "REAL" : "SEEDED"}`;
  return `${src}\nexport const TIMELINE_DATA = [\n${rows}\n];\n`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Fetching real market data ===\n");

  // Step 1: CoinGecko for ICP prices
  const icpPrices = await fetchICPPriceHistory();

  // Step 2: NodeIndex for token overviews + storage canister IDs
  const { mgsn: mgsnOverview, bob: bobOverview, mgsnSC, bobSC, agent } = await fetchNodeIndexData();

  // Step 3: Historical OHLC from storage canisters
  const [{ prices: mgsnPrices, volume: mgsnVolume }, { prices: bobPrices, volume: bobVolume }] =
    await Promise.all([
      fetchTokenPricesFromStorage(mgsnSC, MGSN_ID, "MGSN", agent),
      fetchTokenPricesFromStorage(bobSC,  BOB_ID,  "BOB",  agent),
    ]);

  console.log("\n=== Summary ===");
  console.log("ICP months:", icpPrices ? Object.keys(icpPrices).length : "FAILED");
  console.log("MGSN OHLC:", mgsnPrices ? mgsnPrices.length + " points" : "FAILED");
  console.log("BOB  OHLC:", bobPrices  ? bobPrices.length  + " points" : "FAILED");

  if (icpPrices) {
    const sample = Object.entries(icpPrices).sort().slice(0, 3);
    console.log("\nICP sample:", sample.map(([k,v])=>`${k}=$${v.toFixed(2)}`).join(", "));
  }
  if (mgsnPrices?.length) {
    const p = mgsnPrices[mgsnPrices.length - 1];
    const d = new Date(p.timestamp * 1000).toISOString().slice(0, 10);
    console.log(`MGSN latest (${d}): $${p.close.toFixed(8)}`);
  } else if (mgsnOverview) {
    console.log(`MGSN current (overview): $${mgsnOverview.priceUSD.toFixed(8)}`);
  }
  if (bobPrices?.length) {
    const p = bobPrices[bobPrices.length - 1]; // last = most recent after ASC sort
    const d = new Date(p.timestamp * 1000).toISOString().slice(0, 10);
    console.log(`BOB  latest (${d}): $${p.close.toFixed(8)}`);
  } else if (bobOverview) {
    console.log(`BOB  current (overview): $${bobOverview.priceUSD.toFixed(8)}`);
  }

  // Build timeline
  const timeline = buildTimeline(icpPrices, mgsnPrices, bobPrices, mgsnVolume, bobVolume, mgsnOverview, bobOverview);
  const jsSource = formatAsJS(timeline, !!mgsnPrices?.length, !!bobPrices?.length);

  const { writeFileSync } = await import("fs");
  writeFileSync("scripts/fetched-data.js", jsSource);
  console.log(`\nWritten to scripts/fetched-data.js (${timeline.length} months)`);
  console.log("First 3 rows:");
  console.log(jsSource.split("\n").slice(1, 5).join("\n"));
}

main().catch(console.error);

