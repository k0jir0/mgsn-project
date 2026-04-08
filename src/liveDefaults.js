export const DEFAULT_PORTFOLIO_HOLDINGS = 1_000_000;
export const DEFAULT_PORTFOLIO_AVG_COST = 0.000014;
export const DEFAULT_BURN_CALC_AMOUNT = 100_000;

export function createUnavailableDashboard() {
  return {
    title: "MGSN Strategy Tracker",
    subtitle: "Live ICPSwap spot, pool, and ledger data for MGSN and BOB.",
    heroNote:
      "This dashboard renders only live ICPSwap and ledger data. When those sources are unavailable, the UI stays honest about the missing feed instead of substituting a bundled market snapshot.",
    dataSource:
      "Live ICPSwap info API, ICPSwap TokenStorage, ICPSwap NodeIndex, and MGSN ledger scans.",
    updatedAt: null,
    bobSupply: null,
    mgsnSupply: null,
    icpswapTvl: null,
    icpswapVolume: null,
    icpswapPairs: null,
    timeline: [],
    marketStats: {
      historyStartLabel: null,
      historyEndLabel: null,
      icpSpotLive: false,
      mgsnVol24h: null,
      bobVol24h: null,
      mgsnVol30d: null,
      bobVol30d: null,
      totalLiquidityUsd: null,
      totalPairs: null,
      mgsnCanister: null,
      bobCanister: null,
      mgsnPoolId: null,
    },
  };
}

export function hasDashboardHistory(dashboard) {
  return Array.isArray(dashboard?.timeline) && dashboard.timeline.length > 0;
}

export function getDashboardFirstPoint(dashboard) {
  return hasDashboardHistory(dashboard) ? dashboard.timeline[0] : null;
}

export function getDashboardLastPoint(dashboard) {
  return hasDashboardHistory(dashboard) ? dashboard.timeline.at(-1) : null;
}