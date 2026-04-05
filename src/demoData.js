export const demoDashboard = {
  title: "BOB / MGSN Strategy Tracker",
  subtitle: "Comparative token analytics for a Motoko-native ICP app.",
  heroNote:
    "SaylorTracker-inspired comparative dashboard for BOB and MGSN, built for ICP with a Motoko canister at the center.",
  dataSource:
    "Frontend fallback mode using the same seeded sample series as the Motoko canister. Deploy the backend to switch to live canister reads.",
  updatedAt: BigInt(Date.parse("2026-04-05T12:00:00Z") * 1_000_000),
  bobSupply: 210_000_000,
  mgsnSupply: 77_000_000,
  timeline: [
    { period: "May 2025", bobPrice: 0.24, mgsnPrice: 0.041, bobVolume: 182000, mgsnVolume: 94000, bobLiquidity: 1320000, mgsnLiquidity: 740000 },
    { period: "Jun 2025", bobPrice: 0.26, mgsnPrice: 0.046, bobVolume: 205000, mgsnVolume: 98000, bobLiquidity: 1360000, mgsnLiquidity: 760000 },
    { period: "Jul 2025", bobPrice: 0.29, mgsnPrice: 0.052, bobVolume: 238000, mgsnVolume: 107000, bobLiquidity: 1430000, mgsnLiquidity: 810000 },
    { period: "Aug 2025", bobPrice: 0.34, mgsnPrice: 0.061, bobVolume: 291000, mgsnVolume: 129000, bobLiquidity: 1570000, mgsnLiquidity: 885000 },
    { period: "Sep 2025", bobPrice: 0.39, mgsnPrice: 0.07, bobVolume: 328000, mgsnVolume: 146000, bobLiquidity: 1690000, mgsnLiquidity: 940000 },
    { period: "Oct 2025", bobPrice: 0.42, mgsnPrice: 0.079, bobVolume: 351000, mgsnVolume: 165000, bobLiquidity: 1760000, mgsnLiquidity: 1020000 },
    { period: "Nov 2025", bobPrice: 0.47, mgsnPrice: 0.094, bobVolume: 410000, mgsnVolume: 203000, bobLiquidity: 1910000, mgsnLiquidity: 1120000 },
    { period: "Dec 2025", bobPrice: 0.51, mgsnPrice: 0.109, bobVolume: 468000, mgsnVolume: 239000, bobLiquidity: 2040000, mgsnLiquidity: 1220000 },
    { period: "Jan 2026", bobPrice: 0.56, mgsnPrice: 0.126, bobVolume: 512000, mgsnVolume: 271000, bobLiquidity: 2180000, mgsnLiquidity: 1330000 },
    { period: "Feb 2026", bobPrice: 0.59, mgsnPrice: 0.149, bobVolume: 549000, mgsnVolume: 314000, bobLiquidity: 2260000, mgsnLiquidity: 1410000 },
    { period: "Mar 2026", bobPrice: 0.63, mgsnPrice: 0.171, bobVolume: 603000, mgsnVolume: 365000, bobLiquidity: 2430000, mgsnLiquidity: 1560000 },
    { period: "Apr 2026", bobPrice: 0.68, mgsnPrice: 0.194, bobVolume: 655000, mgsnVolume: 418000, bobLiquidity: 2610000, mgsnLiquidity: 1710000 },
  ],
};
