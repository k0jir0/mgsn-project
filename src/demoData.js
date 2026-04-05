// ICP mainnet token canister IDs (for reference / future live feed wiring)
export const TOKEN_CANISTERS = {
  BOB:  "7pail-xaaaa-aaaas-aabmq-cai",
  MGSN: "mgsn7-iiaaa-aaaag-qjvsa-cai",
};

// ICPSwap info overview snapshot (Apr 5 2026):
// ICP = $2.27 | ICPSwap TVL = $3.22M | Total pairs = 1,951 | Volume all-time = $637M
//
// BOB/MGSN are ICP-native meme/strategy tokens. Prices below are seeded and
// denominated in USD. The icpPrice column lets the frontend derive ICP-denominated
// ratios for charts like "Token Cost in ICP".
export const demoDashboard = {
  title: "MGSN Strategy Tracker",
  subtitle: "Real-time token analytics for BOB & MGSN on the Internet Computer.",
  heroNote:
    "SaylorTracker-inspired comparative dashboard for BOB and MGSN, built on ICP with a Motoko canister backend.",
  dataSource:
    "Seeded market snapshots from backend/main.mo — deploy the canister to switch to live on-chain reads. ICP/USD from CoinGecko.",
  updatedAt: BigInt(Date.parse("2026-04-05T12:00:00Z") * 1_000_000),
  // Circulating supply (approximate)
  bobSupply:  210_000_000,
  mgsnSupply:  77_000_000,
  // ICPSwap liquidity overview (Apr 5 2026)
  icpswapTvl:    3_220_000,
  icpswapVolume: 637_030_000,
  icpswapPairs:  1_951,
  // Monthly timeline — Jul 2024 → Apr 2026 (22 points)
  // bobLiquidity / mgsnLiquidity = USD depth for that token on ICPSwap
  timeline: [
    { period: "Jul 2024", date: "2024-07-01", icpPrice: 14.50, bobPrice: 0.0052, mgsnPrice: 0.00088, bobVolume:  8400, mgsnVolume:  3200, bobLiquidity:  28000, mgsnLiquidity:  11000 },
    { period: "Aug 2024", date: "2024-08-01", icpPrice: 10.20, bobPrice: 0.0038, mgsnPrice: 0.00062, bobVolume:  6100, mgsnVolume:  2400, bobLiquidity:  22000, mgsnLiquidity:   8600 },
    { period: "Sep 2024", date: "2024-09-01", icpPrice: 11.40, bobPrice: 0.0061, mgsnPrice: 0.00105, bobVolume: 11200, mgsnVolume:  4800, bobLiquidity:  38000, mgsnLiquidity:  15000 },
    { period: "Oct 2024", date: "2024-10-01", icpPrice:  8.80, bobPrice: 0.0088, mgsnPrice: 0.00142, bobVolume: 15400, mgsnVolume:  6600, bobLiquidity:  51000, mgsnLiquidity:  21000 },
    { period: "Nov 2024", date: "2024-11-01", icpPrice:  9.50, bobPrice: 0.0142, mgsnPrice: 0.00241, bobVolume: 24600, mgsnVolume: 10800, bobLiquidity:  82000, mgsnLiquidity:  33000 },
    { period: "Dec 2024", date: "2024-12-01", icpPrice: 13.10, bobPrice: 0.028,  mgsnPrice: 0.0051,  bobVolume: 48000, mgsnVolume: 22000, bobLiquidity: 160000, mgsnLiquidity:  66000 },
    { period: "Jan 2025", date: "2025-01-01", icpPrice:  8.40, bobPrice: 0.048,  mgsnPrice: 0.0088,  bobVolume: 82000, mgsnVolume: 38000, bobLiquidity: 270000, mgsnLiquidity: 112000 },
    { period: "Feb 2025", date: "2025-02-01", icpPrice:  6.20, bobPrice: 0.071,  mgsnPrice: 0.0126,  bobVolume: 98000, mgsnVolume: 45000, bobLiquidity: 322000, mgsnLiquidity: 138000 },
    { period: "Mar 2025", date: "2025-03-01", icpPrice:  5.80, bobPrice: 0.094,  mgsnPrice: 0.0161,  bobVolume: 112000, mgsnVolume: 53000, bobLiquidity: 375000, mgsnLiquidity: 162000 },
    { period: "Apr 2025", date: "2025-04-01", icpPrice:  4.90, bobPrice: 0.12,   mgsnPrice: 0.0208,  bobVolume: 138000, mgsnVolume: 64000, bobLiquidity: 452000, mgsnLiquidity: 198000 },
    { period: "May 2025", date: "2025-05-01", icpPrice:  4.20, bobPrice: 0.148,  mgsnPrice: 0.0258,  bobVolume: 162000, mgsnVolume: 76000, bobLiquidity: 524000, mgsnLiquidity: 232000 },
    { period: "Jun 2025", date: "2025-06-01", icpPrice:  3.80, bobPrice: 0.18,   mgsnPrice: 0.031,   bobVolume: 188000, mgsnVolume: 89000, bobLiquidity: 598000, mgsnLiquidity: 268000 },
    { period: "Jul 2025", date: "2025-07-01", icpPrice:  3.40, bobPrice: 0.21,   mgsnPrice: 0.037,   bobVolume: 215000, mgsnVolume: 102000, bobLiquidity: 680000, mgsnLiquidity: 308000 },
    { period: "Aug 2025", date: "2025-08-01", icpPrice:  3.10, bobPrice: 0.255,  mgsnPrice: 0.045,   bobVolume: 248000, mgsnVolume: 118000, bobLiquidity: 778000, mgsnLiquidity: 358000 },
    { period: "Sep 2025", date: "2025-09-01", icpPrice:  2.95, bobPrice: 0.31,   mgsnPrice: 0.056,   bobVolume: 295000, mgsnVolume: 141000, bobLiquidity: 920000, mgsnLiquidity: 428000 },
    { period: "Oct 2025", date: "2025-10-01", icpPrice:  2.80, bobPrice: 0.38,   mgsnPrice: 0.068,   bobVolume: 348000, mgsnVolume: 168000, bobLiquidity: 1080000, mgsnLiquidity: 508000 },
    { period: "Nov 2025", date: "2025-11-01", icpPrice:  2.70, bobPrice: 0.46,   mgsnPrice: 0.082,   bobVolume: 412000, mgsnVolume: 201000, bobLiquidity: 1270000, mgsnLiquidity: 602000 },
    { period: "Dec 2025", date: "2025-12-01", icpPrice:  2.55, bobPrice: 0.53,   mgsnPrice: 0.099,   bobVolume: 478000, mgsnVolume: 234000, bobLiquidity: 1448000, mgsnLiquidity: 694000 },
    { period: "Jan 2026", date: "2026-01-01", icpPrice:  2.48, bobPrice: 0.58,   mgsnPrice: 0.119,   bobVolume: 525000, mgsnVolume: 268000, bobLiquidity: 1590000, mgsnLiquidity: 762000 },
    { period: "Feb 2026", date: "2026-02-01", icpPrice:  2.40, bobPrice: 0.62,   mgsnPrice: 0.145,   bobVolume: 565000, mgsnVolume: 308000, bobLiquidity: 1710000, mgsnLiquidity: 828000 },
    { period: "Mar 2026", date: "2026-03-01", icpPrice:  2.34, bobPrice: 0.65,   mgsnPrice: 0.168,   bobVolume: 604000, mgsnVolume: 354000, bobLiquidity: 1830000, mgsnLiquidity: 892000 },
    { period: "Apr 2026", date: "2026-04-01", icpPrice:  2.27, bobPrice: 0.68,   mgsnPrice: 0.194,   bobVolume: 648000, mgsnVolume: 412000, bobLiquidity: 1960000, mgsnLiquidity: 968000 },
  ],
};

