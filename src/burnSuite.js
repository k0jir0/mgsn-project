import { Principal } from "@dfinity/principal";
import { BURN_PROGRAM, PROGRAM_ADDRESSES } from "./demoData.js";
import { fetchICPSwapPrices } from "./liveData.js";
import { createMgsnLedgerActor, createSubscriptionsActor, createTreasuryActor } from "./mgsnCanisters.js";
import { fetchBurnProgramData } from "./onChainData.js";
import { isAnonymousPrincipal, parseTokenAmount } from "./platformUtils.js";

export const BURN_HUB_PAGES = Object.freeze([
  { key: "burn", label: "Burn", href: "/burn.html" },
  { key: "burn-proof", label: "Burn Proof", href: "/burn-proof.html" },
  { key: "hall-of-flame", label: "Hall of Flame", href: "/hall-of-flame.html" },
  { key: "burn-lab", label: "Burn Lab", href: "/burn-lab.html" },
  { key: "protocol-burns", label: "Protocol Burns", href: "/protocol-burns.html" },
]);

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatMoney(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatCompactNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatInteger(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatPercent(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return `${value.toFixed(digits)}%`;
}

export function shortenAddress(value, head = 8, tail = 6) {
  if (!value || value.length <= head + tail + 3) {
    return value || "Unavailable";
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function txExplorerUrl(txId) {
  if (!txId && txId !== 0) {
    return "";
  }

  return `https://www.icpexplorer.com/transaction/${txId}`;
}

export function buildBurnHubNavHTML(activeKey) {
  return `
    <nav class="burn-hub-nav" aria-label="Burn ecosystem">
      ${BURN_HUB_PAGES.map((page) => `
        <a class="burn-hub-link${page.key === activeKey ? " active" : ""}" href="${page.href}"${page.key === activeKey ? ' aria-current="page"' : ""}>
          ${page.label}
        </a>`).join("")}
    </nav>`;
}

function entryTimestampMs(entry) {
  if (entry?.timestampNs != null) {
    try {
      return Number(BigInt(entry.timestampNs) / 1_000_000n);
    } catch {
      // Fall through to the date-only path.
    }
  }

  if (entry?.date) {
    const parsed = Date.parse(`${entry.date}T00:00:00Z`);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function sumBurned(entries) {
  return entries.reduce((total, entry) => total + (entry?.mgsnBurned ?? 0), 0);
}

function variantKey(variant) {
  if (!variant || typeof variant !== "object") {
    return "";
  }

  return Object.keys(variant)[0] ?? "";
}

export function formatCheckpointDate(recordedAt) {
  try {
    const millis = Number(BigInt(recordedAt) / 1_000_000n);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(millis));
  } catch {
    return "Unavailable";
  }
}

function buildLeaderboard(entries, supply) {
  const byAddress = new Map();

  for (const entry of entries) {
    const address = entry?.address || "unknown";
    const existing = byAddress.get(address) ?? {
      address,
      totalBurned: 0,
      txCount: 0,
      lastDate: entry?.date ?? "",
      lastTimestampMs: 0,
      largestBurn: 0,
    };
    existing.totalBurned += entry?.mgsnBurned ?? 0;
    existing.txCount += 1;
    existing.lastDate = entry?.date ?? existing.lastDate;
    existing.lastTimestampMs = Math.max(existing.lastTimestampMs, entryTimestampMs(entry));
    existing.largestBurn = Math.max(existing.largestBurn, entry?.mgsnBurned ?? 0);
    byAddress.set(address, existing);
  }

  return Array.from(byAddress.values())
    .sort((left, right) => (
      right.totalBurned - left.totalBurned ||
      right.lastTimestampMs - left.lastTimestampMs
    ))
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      pctOfSupply:
        typeof supply === "number" && supply > 0
          ? (row.totalBurned / supply) * 100
          : null,
    }));
}

function recentWindowEntries(entries, windowMs) {
  const now = Date.now();
  return entries.filter((entry) => {
    const timestamp = entryTimestampMs(entry);
    return timestamp > 0 && now - timestamp <= windowMs;
  });
}

export function filterEntriesByDays(entries, days) {
  return recentWindowEntries(entries, days * 24 * 60 * 60 * 1000);
}

export function buildLeaderboardFromEntries(entries, supply) {
  return buildLeaderboard(entries, supply);
}

function buildDailySeries(entries, days = 14) {
  const buckets = new Map();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let index = days - 1; index >= 0; index -= 1) {
    const slot = new Date(today);
    slot.setUTCDate(today.getUTCDate() - index);
    const key = slot.toISOString().slice(0, 10);
    buckets.set(key, {
      key,
      label: slot.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      total: 0,
    });
  }

  for (const entry of entries) {
    const key = entry?.date ?? "";
    if (!buckets.has(key)) {
      continue;
    }
    buckets.get(key).total += entry?.mgsnBurned ?? 0;
  }

  return Array.from(buckets.values());
}

function classifyBurnSource(entry, context = {}) {
  const sender = entry?.address ?? "";
  const buybackOwner = context.buybackVaultOwner ?? null;
  const treasuryOwner = context.treasuryOwner ?? null;

  if (buybackOwner && sender === buybackOwner) {
    return { key: "buyback", label: "Buyback vault" };
  }

  if (treasuryOwner && sender === treasuryOwner) {
    return { key: "treasury", label: "Treasury" };
  }

  return { key: "community", label: "Community" };
}

function collectTrenchCheckpoints(trenchState, stageKey) {
  const intents = Array.isArray(trenchState?.intents) ? trenchState.intents : [];
  const checkpoints = [];

  for (const intent of intents) {
    const items = Array.isArray(intent?.checkpoints) ? intent.checkpoints : [];
    for (const checkpoint of items) {
      if (variantKey(checkpoint?.stage) === stageKey) {
        checkpoints.push({
          intentId: intent?.id != null ? Number(intent.id) : null,
          note: checkpoint?.note ?? "",
          recordedAt: checkpoint?.recordedAt ?? null,
          txIndex: Array.isArray(checkpoint?.txIndex) ? checkpoint.txIndex[0] ?? null : checkpoint?.txIndex ?? null,
        });
      }
    }
  }

  return checkpoints.sort((left, right) => {
    const leftValue = left.recordedAt == null ? 0n : BigInt(left.recordedAt);
    const rightValue = right.recordedAt == null ? 0n : BigInt(right.recordedAt);
    return rightValue > leftValue ? 1 : rightValue < leftValue ? -1 : 0;
  });
}

function transferErrorMessage(error) {
  const key = variantKey(error);

  switch (key) {
    case "BadFee":
      return `Ledger fee changed. Expected ${error.BadFee.expected_fee.toString()} e8s.`;
    case "BadBurn":
      return `Burn amount is below the ledger minimum of ${error.BadBurn.min_burn_amount.toString()} e8s.`;
    case "InsufficientFunds":
      return "Insufficient MGSN balance for this burn.";
    case "TooOld":
      return "The burn request expired before the ledger accepted it.";
    case "CreatedInFuture":
      return "The device clock appears to be ahead of the ledger.";
    case "TemporarilyUnavailable":
      return "The MGSN ledger is temporarily unavailable.";
    case "Duplicate":
      return `Duplicate burn request. Original block: ${error.Duplicate.duplicate_of.toString()}.`;
    case "GenericError":
      return error.GenericError.message || "The MGSN ledger rejected the burn.";
    default:
      return "The MGSN ledger rejected the burn.";
  }
}

async function fetchTreasuryAccount() {
  try {
    const actor = await createTreasuryActor();
    if (!actor?.getAccount) {
      return null;
    }

    const account = await actor.getAccount();
    return {
      ownerText: account?.owner?.toText?.() ?? null,
      subaccount: Array.isArray(account?.subaccount) ? account.subaccount[0] ?? null : null,
    };
  } catch {
    return null;
  }
}

async function fetchTrenchState() {
  try {
    const actor = await createSubscriptionsActor();
    if (!actor?.getTrenchState) {
      return null;
    }

    return await actor.getTrenchState([]);
  } catch {
    return null;
  }
}

async function fetchWalletState(identity) {
  if (!identity) {
    return null;
  }

  const principal = identity.getPrincipal()?.toText?.();
  if (!principal || isAnonymousPrincipal(principal)) {
    return null;
  }

  try {
    const ledger = await createMgsnLedgerActor(identity);
    const owner = identity.getPrincipal();
    const account = { owner, subaccount: [] };
    const [balanceE8s, feeE8s, decimals, symbol] = await Promise.all([
      ledger.icrc1_balance_of(account),
      ledger.icrc1_fee(),
      ledger.icrc1_decimals(),
      ledger.icrc1_symbol(),
    ]);

    return {
      principal,
      balanceE8s,
      feeE8s,
      decimals: Number(decimals),
      symbol,
    };
  } catch {
    return null;
  }
}

export async function fetchBurnSuiteData({
  force = false,
  identity = null,
  includeProtocol = false,
  includeWallet = false,
} = {}) {
  const tasks = [
    fetchICPSwapPrices(force),
    fetchBurnProgramData(force),
  ];

  if (includeProtocol) {
    tasks.push(fetchTreasuryAccount(), fetchTrenchState());
  }

  if (includeWallet) {
    tasks.push(fetchWalletState(identity));
  }

  const results = await Promise.allSettled(tasks);
  let cursor = 0;

  const prices = results[cursor].status === "fulfilled" ? results[cursor].value : {};
  cursor += 1;

  const burnState = results[cursor].status === "fulfilled"
    ? results[cursor].value
    : {
        status: "unavailable",
        burnAddress: BURN_PROGRAM.burnAddress,
        burnAddressBalance: null,
        currentSupply: null,
        originalSupply: null,
        totalBurned: null,
        log: [],
        note: "MGSN burn history is temporarily unavailable.",
      };
  cursor += 1;

  let treasuryAccount = null;
  let trenchState = null;
  if (includeProtocol) {
    treasuryAccount = results[cursor].status === "fulfilled" ? results[cursor].value : null;
    cursor += 1;
    trenchState = results[cursor].status === "fulfilled" ? results[cursor].value : null;
    cursor += 1;
  }

  let wallet = null;
  if (includeWallet) {
    wallet = results[cursor].status === "fulfilled" ? results[cursor].value : null;
  }

  return {
    prices,
    burnState,
    treasuryAccount,
    trenchState,
    wallet,
    updatedAt: BigInt(Date.now()) * 1_000_000n,
  };
}

export function deriveBurnMetrics({
  burnState,
  mgsnUsd = null,
  principal = null,
  treasuryAccount = null,
  trenchState = null,
} = {}) {
  const burnLog = Array.isArray(burnState?.log)
    ? [...burnState.log].sort((left, right) => entryTimestampMs(right) - entryTimestampMs(left))
    : [];
  const totalBurned = typeof burnState?.totalBurned === "number" ? burnState.totalBurned : null;
  const originalSupply =
    burnState?.originalSupply ??
    (typeof burnState?.currentSupply === "number" && typeof totalBurned === "number"
      ? burnState.currentSupply + totalBurned
      : null);
  const currentSupply =
    burnState?.currentSupply ??
    (typeof originalSupply === "number" && typeof totalBurned === "number"
      ? Math.max(originalSupply - totalBurned, 0)
      : null);
  const burnedPct =
    typeof originalSupply === "number" &&
    originalSupply > 0 &&
    typeof totalBurned === "number"
      ? (totalBurned / originalSupply) * 100
      : null;
  const valueDestroyed =
    typeof totalBurned === "number" &&
    typeof mgsnUsd === "number" &&
    Number.isFinite(mgsnUsd)
      ? totalBurned * mgsnUsd
      : null;
  const nextMilestone =
    typeof burnedPct === "number"
      ? BURN_PROGRAM.milestones.find((milestone) => burnedPct < milestone.pct) ?? null
      : null;
  const nextMilestoneTarget =
    nextMilestone && typeof originalSupply === "number"
      ? Math.ceil(originalSupply * nextMilestone.pct / 100)
      : null;
  const toNextMilestone =
    typeof nextMilestoneTarget === "number" && typeof totalBurned === "number"
      ? Math.max(nextMilestoneTarget - totalBurned, 0)
      : null;

  const leaderboard = buildLeaderboard(burnLog, originalSupply);
  const largestBurn = [...burnLog].sort((left, right) => (right?.mgsnBurned ?? 0) - (left?.mgsnBurned ?? 0))[0] ?? null;
  const latestBurn = burnLog[0] ?? null;
  const uniqueBurners = leaderboard.length;
  const burned24h = sumBurned(recentWindowEntries(burnLog, 24 * 60 * 60 * 1000));
  const burned7d = sumBurned(recentWindowEntries(burnLog, 7 * 24 * 60 * 60 * 1000));
  const burned30d = sumBurned(recentWindowEntries(burnLog, 30 * 24 * 60 * 60 * 1000));
  const burned30to60d = sumBurned(
    burnLog.filter((entry) => {
      const delta = Date.now() - entryTimestampMs(entry);
      return delta > 30 * 24 * 60 * 60 * 1000 && delta <= 60 * 24 * 60 * 60 * 1000;
    })
  );
  const velocityDeltaPct =
    burned30to60d > 0
      ? ((burned30d - burned30to60d) / burned30to60d) * 100
      : burned30d > 0
        ? 100
        : null;

  const protocolContext = {
    buybackVaultOwner: PROGRAM_ADDRESSES.buybackVaultOwner ?? null,
    treasuryOwner: treasuryAccount?.ownerText ?? null,
  };

  const sourceBuckets = [
    {
      key: "community",
      label: "Community burns",
      totalBurned: 0,
      txCount: 0,
      status: "live",
      note: "Holder-controlled burns from accounts that are not currently tagged as protocol actors.",
    },
    {
      key: "treasury",
      label: "Treasury burns",
      totalBurned: 0,
      txCount: 0,
      status: protocolContext.treasuryOwner ? "live" : "unpublished",
      note: protocolContext.treasuryOwner
        ? "Burns sourced from the published treasury account."
        : "Treasury source classification activates once the public treasury account is available.",
    },
    {
      key: "buyback",
      label: "Buyback burns",
      totalBurned: 0,
      txCount: 0,
      status: protocolContext.buybackVaultOwner ? "live" : "unpublished",
      note: protocolContext.buybackVaultOwner
        ? "Burns sourced from the published buyback vault."
        : "Buyback burn classification activates once the public buyback vault is published.",
    },
  ];

  const sourceIndex = new Map(sourceBuckets.map((bucket) => [bucket.key, bucket]));
  const classifiedBurns = burnLog.map((entry) => {
    const source = classifyBurnSource(entry, protocolContext);
    const bucket = sourceIndex.get(source.key) ?? sourceIndex.get("community");
    bucket.totalBurned += entry?.mgsnBurned ?? 0;
    bucket.txCount += 1;
    return { ...entry, source };
  });

  const lpBurnCheckpoints = collectTrenchCheckpoints(trenchState, "lp_burned");
  const lpLockCheckpoints = collectTrenchCheckpoints(trenchState, "lp_locked");
  const liquidityRoutedCheckpoints = collectTrenchCheckpoints(trenchState, "liquidity_routed");
  const proofCheckpoints = collectTrenchCheckpoints(trenchState, "proof_published");

  const principalText = principal && !isAnonymousPrincipal(principal) ? principal : null;
  const userBurns = principalText
    ? burnLog.filter((entry) => entry?.address === principalText)
    : [];
  const userTotalBurned = sumBurned(userBurns);
  const userLeaderboardRow = principalText
    ? leaderboard.find((row) => row.address === principalText) ?? null
    : null;
  const nextRowAbove = userLeaderboardRow && userLeaderboardRow.rank > 1
    ? leaderboard[userLeaderboardRow.rank - 2] ?? null
    : null;

  return {
    burnLog,
    classifiedBurns,
    leaderboard,
    latestBurn,
    largestBurn,
    totalBurned,
    originalSupply,
    currentSupply,
    burnedPct,
    valueDestroyed,
    nextMilestone,
    nextMilestoneTarget,
    toNextMilestone,
    uniqueBurners,
    burned24h,
    burned7d,
    burned30d,
    velocityDeltaPct,
    dailySeries: buildDailySeries(burnLog, 14),
    recentBurns: classifiedBurns.slice(0, 12),
    sourceBuckets,
    user: {
      principal: principalText,
      burns: userBurns,
      totalBurned: userTotalBurned,
      burnCount: userBurns.length,
      rank: userLeaderboardRow?.rank ?? null,
      pctOfSupply: userLeaderboardRow?.pctOfSupply ?? null,
      shareOfBurned:
        typeof totalBurned === "number" && totalBurned > 0 && userTotalBurned > 0
          ? (userTotalBurned / totalBurned) * 100
          : null,
      lastBurn: userBurns[0] ?? null,
      toNextRank:
        nextRowAbove && userTotalBurned >= 0
          ? Math.max(nextRowAbove.totalBurned - userTotalBurned + 0.00000001, 0)
          : null,
    },
    protocol: {
      treasuryOwner: protocolContext.treasuryOwner,
      buybackVaultOwner: protocolContext.buybackVaultOwner,
      trenchState,
      lpBurnCheckpoints,
      lpLockCheckpoints,
      liquidityRoutedCheckpoints,
      proofCheckpoints,
      latestProtocolStatus:
        lpBurnCheckpoints[0]
          ? `LP burn checkpoint published on ${formatCheckpointDate(lpBurnCheckpoints[0].recordedAt)}.`
          : lpLockCheckpoints[0]
            ? `LP lock checkpoint published on ${formatCheckpointDate(lpLockCheckpoints[0].recordedAt)}.`
            : liquidityRoutedCheckpoints[0]
              ? `Liquidity route published on ${formatCheckpointDate(liquidityRoutedCheckpoints[0].recordedAt)}.`
              : proofCheckpoints[0]
                ? `Additional trench proof published on ${formatCheckpointDate(proofCheckpoints[0].recordedAt)}.`
                : "No protocol LP burn receipts are published yet.",
    },
    burnState,
  };
}

export function buildBurnScenario(metrics, burnAmount) {
  const parsedAmount =
    typeof burnAmount === "number" && Number.isFinite(burnAmount)
      ? Math.max(0, burnAmount)
      : 0;
  const currentSupply = metrics?.currentSupply ?? null;
  const originalSupply = metrics?.originalSupply ?? null;
  const currentTotalBurned = metrics?.totalBurned ?? 0;
  const nextTotalBurned =
    typeof currentTotalBurned === "number"
      ? currentTotalBurned + parsedAmount
      : null;
  const nextCurrentSupply =
    typeof currentSupply === "number"
      ? Math.max(currentSupply - parsedAmount, 0)
      : null;
  const pctOfSupply =
    typeof originalSupply === "number" && originalSupply > 0
      ? (parsedAmount / originalSupply) * 100
      : null;
  const nextPctBurned =
    typeof originalSupply === "number" &&
    originalSupply > 0 &&
    typeof nextTotalBurned === "number"
      ? (nextTotalBurned / originalSupply) * 100
      : null;
  const nextMilestone =
    typeof nextPctBurned === "number"
      ? BURN_PROGRAM.milestones.find((milestone) => nextPctBurned < milestone.pct) ?? null
      : null;
  const nextMilestoneTarget =
    nextMilestone && typeof originalSupply === "number"
      ? Math.ceil(originalSupply * nextMilestone.pct / 100)
      : null;
  const toNextMilestone =
    typeof nextMilestoneTarget === "number" && typeof nextTotalBurned === "number"
      ? Math.max(nextMilestoneTarget - nextTotalBurned, 0)
      : null;

  let projectedRank = null;
  let rankImprovement = null;
  if (metrics?.user?.principal) {
    const currentTotal = metrics.user.totalBurned ?? 0;
    const nextTotal = currentTotal + parsedAmount;
    const projectedBoard = buildLeaderboard(
      [
        ...(metrics.burnLog ?? []).filter((entry) => entry.address !== metrics.user.principal),
        {
          address: metrics.user.principal,
          date: new Date().toISOString().slice(0, 10),
          timestampNs: (BigInt(Date.now()) * 1_000_000n).toString(),
          mgsnBurned: nextTotal,
          txId: "scenario",
          note: "Scenario burn",
        },
      ],
      originalSupply
    );

    projectedRank = projectedBoard.find((row) => row.address === metrics.user.principal)?.rank ?? null;
    rankImprovement =
      metrics.user.rank != null && projectedRank != null
        ? metrics.user.rank - projectedRank
        : null;
  }

  return {
    amount: parsedAmount,
    pctOfSupply,
    nextTotalBurned,
    nextCurrentSupply,
    nextPctBurned,
    nextMilestone,
    toNextMilestone,
    projectedRank,
    rankImprovement,
  };
}

export function parseBurnAmountInput(value, decimals = 8) {
  return parseTokenAmount(value, decimals);
}

export async function executeBurnTransfer({ identity, amountE8s }) {
  if (!identity) {
    throw new Error("Connect with Internet Identity before using the burn rail.");
  }

  const ledger = await createMgsnLedgerActor(identity);
  const owner = identity.getPrincipal();
  const account = { owner, subaccount: [] };
  const [balanceE8s, feeE8s] = await Promise.all([
    ledger.icrc1_balance_of(account),
    ledger.icrc1_fee(),
  ]);

  if (amountE8s <= 0n) {
    throw new Error("Enter an MGSN amount greater than zero.");
  }

  if (amountE8s + feeE8s > balanceE8s) {
    throw new Error("Burn amount plus ledger fee exceeds your available MGSN balance.");
  }

  const result = await ledger.icrc1_transfer({
    from_subaccount: [],
    to: {
      owner: Principal.fromText(BURN_PROGRAM.burnAddress),
      subaccount: [],
    },
    amount: amountE8s,
    fee: [feeE8s],
    memo: [],
    created_at_time: [BigInt(Date.now()) * 1_000_000n],
  });

  if ("Ok" in result) {
    return {
      txIndex: result.Ok,
      feeE8s,
      balanceE8s,
    };
  }

  throw new Error(transferErrorMessage(result.Err));
}
