// ICP mainnet token canister IDs (for reference / future live feed wiring)
export const TOKEN_CANISTERS = {
  BOB:  "7pail-xaaaa-aaaas-aabmq-cai",
  MGSN: "mgsn7-iiaaa-aaaag-qjvsa-cai",
};

// ICPSwap info overview snapshot (Apr 6 2026):
// ICP = $2.33 | BOB = $0.268 | MGSN = $0.0000140
//
// ICP/USD prices: Binance (Jul 2024–Mar 2025) + CoinGecko (Apr 2025–Apr 2026) — REAL
// BOB/USD prices: ICPSwap TokenStorage canister (Sep 2024–Aug 2025) — REAL
// BOB volume/liquidity: ICPSwap TokenStorage daily aggregates — REAL
// MGSN/USD: current price from ICPSwap NodeIndex getAllTokens() — REAL (no stored history)
export const demoDashboard = {
  title: "MGSN Strategy Tracker",
  subtitle: "Real-time token analytics for BOB & MGSN on the Internet Computer.",
  heroNote:
    "SaylorTracker-inspired comparative dashboard for BOB and MGSN, built on ICP with a Motoko canister backend.",
  dataSource:
    "ICP prices from Binance/CoinGecko. BOB prices/volume from ICPSwap on-chain storage canister. MGSN price from ICPSwap NodeIndex.",
  updatedAt: BigInt(Date.parse("2026-04-06T09:00:00Z") * 1_000_000),
  // Circulating supply (approximate)
  bobSupply:  210_000_000,
  mgsnSupply:  77_000_000,
  // ICPSwap liquidity overview (Apr 6 2026)
  icpswapTvl:    3_220_000,
  icpswapVolume: 637_030_000,
  icpswapPairs:  1_951,
  // Monthly timeline — Jul 2024 → Apr 2026 (22 points)
  // ICP: real from Binance/CoinGecko | BOB: real from ICPSwap (Sep'24–Aug'25) | MGSN: current price flat
  timeline: [
    { period: "Jul 2024", date: "2024-07-01", icpPrice: 8.9580, bobPrice: 0.02757700, mgsnPrice: 0.00001398, bobVolume:       0, mgsnVolume: 0, bobLiquidity:        0, mgsnLiquidity: 0 },
    { period: "Aug 2024", date: "2024-08-01", icpPrice: 7.5630, bobPrice: 0.02757700, mgsnPrice: 0.00001398, bobVolume:       0, mgsnVolume: 0, bobLiquidity:        0, mgsnLiquidity: 0 },
    { period: "Sep 2024", date: "2024-09-01", icpPrice: 8.9930, bobPrice: 0.15430897, mgsnPrice: 0.00001398, bobVolume: 5458930, mgsnVolume: 0, bobLiquidity: 10917859, mgsnLiquidity: 0 },
    { period: "Oct 2024", date: "2024-10-01", icpPrice: 7.8550, bobPrice: 0.20052431, mgsnPrice: 0.00001398, bobVolume: 2637050, mgsnVolume: 0, bobLiquidity:  5274101, mgsnLiquidity: 0 },
    { period: "Nov 2024", date: "2024-11-01", icpPrice: 12.4470, bobPrice: 0.44322642, mgsnPrice: 0.00001398, bobVolume: 5222916, mgsnVolume: 0, bobLiquidity: 10445832, mgsnLiquidity: 0 },
    { period: "Dec 2024", date: "2024-12-01", icpPrice: 9.8830, bobPrice: 1.11060425, mgsnPrice: 0.00001398, bobVolume: 18174659, mgsnVolume: 0, bobLiquidity: 36349318, mgsnLiquidity: 0 },
    { period: "Jan 2025", date: "2025-01-01", icpPrice: 9.2870, bobPrice: 0.83754098, mgsnPrice: 0.00001398, bobVolume: 11911331, mgsnVolume: 0, bobLiquidity: 23822662, mgsnLiquidity: 0 },
    { period: "Feb 2025", date: "2025-02-01", icpPrice: 6.5140, bobPrice: 1.21094826, mgsnPrice: 0.00001398, bobVolume:  6374916, mgsnVolume: 0, bobLiquidity: 12749832, mgsnLiquidity: 0 },
    { period: "Mar 2025", date: "2025-03-01", icpPrice: 5.3110, bobPrice: 0.60965603, mgsnPrice: 0.00001398, bobVolume:  3997396, mgsnVolume: 0, bobLiquidity:  7994792, mgsnLiquidity: 0 },
    { period: "Apr 2025", date: "2025-04-01", icpPrice: 4.8990, bobPrice: 0.60849458, mgsnPrice: 0.00001398, bobVolume:  3261285, mgsnVolume: 0, bobLiquidity:  6522569, mgsnLiquidity: 0 },
    { period: "May 2025", date: "2025-05-01", icpPrice: 4.8052, bobPrice: 0.44780179, mgsnPrice: 0.00001398, bobVolume:  3276474, mgsnVolume: 0, bobLiquidity:  6552949, mgsnLiquidity: 0 },
    { period: "Jun 2025", date: "2025-06-01", icpPrice: 5.0738, bobPrice: 0.39704592, mgsnPrice: 0.00001398, bobVolume:  2691140, mgsnVolume: 0, bobLiquidity:  5382280, mgsnLiquidity: 0 },
    { period: "Jul 2025", date: "2025-07-01", icpPrice: 5.4736, bobPrice: 0.24493591, mgsnPrice: 0.00001398, bobVolume:  1784786, mgsnVolume: 0, bobLiquidity:  3569572, mgsnLiquidity: 0 },
    { period: "Aug 2025", date: "2025-08-01", icpPrice: 4.8520, bobPrice: 0.26803749, mgsnPrice: 0.00001398, bobVolume:  1635882, mgsnVolume: 0, bobLiquidity:  3271764, mgsnLiquidity: 0 },
    { period: "Sep 2025", date: "2025-09-01", icpPrice: 4.2499, bobPrice: 0.26803749, mgsnPrice: 0.00001398, bobVolume:       0, mgsnVolume: 0, bobLiquidity:        0, mgsnLiquidity: 0 },
    { period: "Oct 2025", date: "2025-10-01", icpPrice: 2.8890, bobPrice: 0.26803749, mgsnPrice: 0.00001398, bobVolume:       0, mgsnVolume: 0, bobLiquidity:        0, mgsnLiquidity: 0 },
    { period: "Nov 2025", date: "2025-11-01", icpPrice: 4.0079, bobPrice: 0.26803749, mgsnPrice: 0.00001398, bobVolume:       0, mgsnVolume: 0, bobLiquidity:        0, mgsnLiquidity: 0 },
    { period: "Dec 2025", date: "2025-12-01", icpPrice: 2.8325, bobPrice: 0.26803749, mgsnPrice: 0.00001398, bobVolume:       0, mgsnVolume: 0, bobLiquidity:        0, mgsnLiquidity: 0 },
    { period: "Jan 2026", date: "2026-01-01", icpPrice: 3.0021, bobPrice: 0.26803749, mgsnPrice: 0.00001398, bobVolume:       0, mgsnVolume: 0, bobLiquidity:        0, mgsnLiquidity: 0 },
    { period: "Feb 2026", date: "2026-02-01", icpPrice: 2.5144, bobPrice: 0.26803749, mgsnPrice: 0.00001398, bobVolume:       0, mgsnVolume: 0, bobLiquidity:        0, mgsnLiquidity: 0 },
    { period: "Mar 2026", date: "2026-03-01", icpPrice: 2.2426, bobPrice: 0.26803749, mgsnPrice: 0.00001398, bobVolume:       0, mgsnVolume: 0, bobLiquidity:        0, mgsnLiquidity: 0 },
    { period: "Apr 2026", date: "2026-04-01", icpPrice: 2.3375, bobPrice: 0.26803749, mgsnPrice: 0.00001398, bobVolume:       0, mgsnVolume: 0, bobLiquidity:        0, mgsnLiquidity: 0 },
  ],
};

