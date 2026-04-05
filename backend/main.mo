import Time "mo:core/Time";

persistent actor {
  type MetricPoint = {
    period : Text;
    bobPrice : Float;
    mgsnPrice : Float;
    bobVolume : Float;
    mgsnVolume : Float;
    bobLiquidity : Float;
    mgsnLiquidity : Float;
  };

  type Dashboard = {
    title : Text;
    subtitle : Text;
    heroNote : Text;
    dataSource : Text;
    updatedAt : Int;
    bobSupply : Float;
    mgsnSupply : Float;
    timeline : [MetricPoint];
  };

  let bobSupply : Float = 210_000_000;
  let mgsnSupply : Float = 77_000_000;
  let heroNote : Text = "SaylorTracker-inspired comparative dashboard for BOB and MGSN, built for ICP with a Motoko canister at the center.";
  let dataSource : Text = "Seeded sample market snapshots in backend/main.mo. Replace them with live feeds or your own treasury model when token source IDs are finalized.";
  let updatedAt : Int = Time.now();
  let timeline : [MetricPoint] = [
    {
      period = "May 2025";
      bobPrice = 0.24;
      mgsnPrice = 0.041;
      bobVolume = 182_000;
      mgsnVolume = 94_000;
      bobLiquidity = 1_320_000;
      mgsnLiquidity = 740_000;
    },
    {
      period = "Jun 2025";
      bobPrice = 0.26;
      mgsnPrice = 0.046;
      bobVolume = 205_000;
      mgsnVolume = 98_000;
      bobLiquidity = 1_360_000;
      mgsnLiquidity = 760_000;
    },
    {
      period = "Jul 2025";
      bobPrice = 0.29;
      mgsnPrice = 0.052;
      bobVolume = 238_000;
      mgsnVolume = 107_000;
      bobLiquidity = 1_430_000;
      mgsnLiquidity = 810_000;
    },
    {
      period = "Aug 2025";
      bobPrice = 0.34;
      mgsnPrice = 0.061;
      bobVolume = 291_000;
      mgsnVolume = 129_000;
      bobLiquidity = 1_570_000;
      mgsnLiquidity = 885_000;
    },
    {
      period = "Sep 2025";
      bobPrice = 0.39;
      mgsnPrice = 0.07;
      bobVolume = 328_000;
      mgsnVolume = 146_000;
      bobLiquidity = 1_690_000;
      mgsnLiquidity = 940_000;
    },
    {
      period = "Oct 2025";
      bobPrice = 0.42;
      mgsnPrice = 0.079;
      bobVolume = 351_000;
      mgsnVolume = 165_000;
      bobLiquidity = 1_760_000;
      mgsnLiquidity = 1_020_000;
    },
    {
      period = "Nov 2025";
      bobPrice = 0.47;
      mgsnPrice = 0.094;
      bobVolume = 410_000;
      mgsnVolume = 203_000;
      bobLiquidity = 1_910_000;
      mgsnLiquidity = 1_120_000;
    },
    {
      period = "Dec 2025";
      bobPrice = 0.51;
      mgsnPrice = 0.109;
      bobVolume = 468_000;
      mgsnVolume = 239_000;
      bobLiquidity = 2_040_000;
      mgsnLiquidity = 1_220_000;
    },
    {
      period = "Jan 2026";
      bobPrice = 0.56;
      mgsnPrice = 0.126;
      bobVolume = 512_000;
      mgsnVolume = 271_000;
      bobLiquidity = 2_180_000;
      mgsnLiquidity = 1_330_000;
    },
    {
      period = "Feb 2026";
      bobPrice = 0.59;
      mgsnPrice = 0.149;
      bobVolume = 549_000;
      mgsnVolume = 314_000;
      bobLiquidity = 2_260_000;
      mgsnLiquidity = 1_410_000;
    },
    {
      period = "Mar 2026";
      bobPrice = 0.63;
      mgsnPrice = 0.171;
      bobVolume = 603_000;
      mgsnVolume = 365_000;
      bobLiquidity = 2_430_000;
      mgsnLiquidity = 1_560_000;
    },
    {
      period = "Apr 2026";
      bobPrice = 0.68;
      mgsnPrice = 0.194;
      bobVolume = 655_000;
      mgsnVolume = 418_000;
      bobLiquidity = 2_610_000;
      mgsnLiquidity = 1_710_000;
    },
  ];

  public query func getDashboard() : async Dashboard {
    {
      title = "BOB / MGSN Strategy Tracker";
      subtitle = "Comparative token analytics for a Motoko-native ICP app.";
      heroNote;
      dataSource;
      updatedAt;
      bobSupply;
      mgsnSupply;
      timeline;
    };
  };
};
