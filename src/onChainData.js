import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import { PROGRAM_ADDRESSES, TOKEN_CANISTERS } from "./demoData.js";
import {
  fetchICPSwapInfoSnapshot,
  fetchPoolChartDaily,
  getPoolSnapshotForDate,
  getPoolTokenUsdPrice,
} from "./icpswapInfo.js";

const IC_API_HOST = "https://icp-api.io";
const MGSN_LEDGER_CANISTER = TOKEN_CANISTERS.MGSN;
const ICP_BLACKHOLE = "aaaaa-aa";
const ARCHIVE_BATCH_SIZE = 2000n;
const ARCHIVE_CONCURRENCY = 6;
const SNAPSHOT_CACHE_MS = 60_000;
const PROGRAM_CACHE_MS = 60_000;
const BURN_CACHE_KEY = "mgsn-burn-program-v1";

const agent = new HttpAgent({ host: IC_API_HOST });

const Account = IDL.Record({
  owner: IDL.Principal,
  subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
});

const GetBlocksRequest = IDL.Record({
  start: IDL.Nat,
  length: IDL.Nat,
});

const Mint = IDL.Record({
  to: Account,
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
  amount: IDL.Nat,
});

const Burn = IDL.Record({
  from: Account,
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
  amount: IDL.Nat,
  spender: IDL.Opt(Account),
});

const Approve = IDL.Record({
  fee: IDL.Opt(IDL.Nat),
  from: Account,
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
  amount: IDL.Nat,
  expected_allowance: IDL.Opt(IDL.Nat),
  expires_at: IDL.Opt(IDL.Nat64),
  spender: Account,
});

const Transfer = IDL.Record({
  to: Account,
  fee: IDL.Opt(IDL.Nat),
  from: Account,
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
  amount: IDL.Nat,
  spender: IDL.Opt(Account),
});

const Transaction = IDL.Record({
  burn: IDL.Opt(Burn),
  kind: IDL.Text,
  mint: IDL.Opt(Mint),
  approve: IDL.Opt(Approve),
  timestamp: IDL.Nat64,
  transfer: IDL.Opt(Transfer),
});

const ArchiveInfo = IDL.Record({
  block_range_end: IDL.Nat,
  canister_id: IDL.Principal,
  block_range_start: IDL.Nat,
});

const ArchivedRange = IDL.Record({
  callback: IDL.Func(
    [GetBlocksRequest],
    [IDL.Record({ transactions: IDL.Vec(Transaction) })],
    ["query"]
  ),
  start: IDL.Nat,
  length: IDL.Nat,
});

const GetTransactionsResponse = IDL.Record({
  first_index: IDL.Nat,
  log_length: IDL.Nat,
  transactions: IDL.Vec(Transaction),
  archived_transactions: IDL.Vec(ArchivedRange),
});

const LedgerIDL = ({ IDL }) =>
  IDL.Service({
    archives: IDL.Func([], [IDL.Vec(ArchiveInfo)], ["query"]),
    get_transactions: IDL.Func([GetBlocksRequest], [GetTransactionsResponse], ["query"]),
    icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
    icrc1_decimals: IDL.Func([], [IDL.Nat8], ["query"]),
    icrc1_total_supply: IDL.Func([], [IDL.Nat], ["query"]),
  });

const ArchiveIDL = ({ IDL }) =>
  IDL.Service({
    get_transactions: IDL.Func(
      [GetBlocksRequest],
      [IDL.Record({ transactions: IDL.Vec(Transaction) })],
      ["query"]
    ),
  });

const ledgerActors = new Map();

function getLedgerActor(canisterId) {
  if (!ledgerActors.has(canisterId)) {
    ledgerActors.set(
      canisterId,
      Actor.createActor(LedgerIDL, { agent, canisterId })
    );
  }

  return ledgerActors.get(canisterId);
}

const ledgerActor = getLedgerActor(MGSN_LEDGER_CANISTER);

const archiveActors = new Map();

let ledgerSnapshotCache = null;
const tokenLedgerSnapshotCache = new Map();
let burnProgramCache = null;
let buybackProgramCache = null;
let stakingProgramCache = null;

function getArchiveActor(canisterId) {
  if (!archiveActors.has(canisterId)) {
    archiveActors.set(
      canisterId,
      Actor.createActor(ArchiveIDL, { agent, canisterId })
    );
  }

  return archiveActors.get(canisterId);
}

function withTimeout(promise, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isFresh(cache, maxAgeMs) {
  return cache && Date.now() - cache.ts < maxAgeMs;
}

function tokenAmountToNumber(rawValue, decimals) {
  const value = typeof rawValue === "bigint" ? rawValue : BigInt(rawValue);
  const factor = 10n ** BigInt(decimals);
  const whole = value / factor;
  const fractional = value % factor;
  const fractionText = fractional
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const fullText = fractionText.length > 0 ? `${whole}.${fractionText}` : whole.toString();
  return Number(fullText);
}

function txDate(timestampNs) {
  const raw = typeof timestampNs === "bigint" ? timestampNs : BigInt(timestampNs);
  return new Date(Number(raw / 1_000_000n)).toISOString().slice(0, 10);
}

function accountOwner(account) {
  return account?.owner?.toText?.() ?? "";
}

function estimateBuybackUsdSpent(mgsnAcquired, date, poolChart) {
  const poolSnapshot = getPoolSnapshotForDate(poolChart, date);
  const priceUsd = getPoolTokenUsdPrice(poolSnapshot, MGSN_LEDGER_CANISTER);
  if (priceUsd == null) {
    return {
      usdSpent: null,
      usdBasis: "unavailable",
      priceUsd: null,
    };
  }

  return {
    usdSpent: mgsnAcquired * priceUsd,
    usdBasis: "estimated_pool_snapshot",
    priceUsd,
  };
}

function buildChunkJobs(start, end, canisterId) {
  const jobs = [];
  if (start > end) return jobs;

  for (let cursor = start; cursor <= end; cursor += ARCHIVE_BATCH_SIZE) {
    const remaining = end - cursor + 1n;
    jobs.push({
      canisterId,
      start: cursor,
      length: remaining > ARCHIVE_BATCH_SIZE ? ARCHIVE_BATCH_SIZE : remaining,
    });
  }

  return jobs;
}

async function parallelForEach(items, limit, worker) {
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, () => runWorker());
  await Promise.all(workers);
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readBurnCache(snapshot) {
  if (!canUseLocalStorage()) return null;

  try {
    const raw = window.localStorage.getItem(BURN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed?.ledgerId === MGSN_LEDGER_CANISTER &&
      parsed?.logLength === snapshot.logLength &&
      parsed?.currentSupplyRaw === snapshot.currentSupplyRaw
    ) {
      return parsed.data ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

function writeBurnCache(snapshot, data) {
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.setItem(
      BURN_CACHE_KEY,
      JSON.stringify({
        ledgerId: MGSN_LEDGER_CANISTER,
        logLength: snapshot.logLength,
        currentSupplyRaw: snapshot.currentSupplyRaw,
        data,
      })
    );
  } catch {
    // Ignore storage quota and privacy-mode failures.
  }
}

export async function fetchMgsnLedgerSnapshot(force = false) {
  if (!force && isFresh(ledgerSnapshotCache, SNAPSHOT_CACHE_MS)) {
    return ledgerSnapshotCache.value;
  }

  try {
    const burnAccount = {
      owner: Principal.fromText(ICP_BLACKHOLE),
      subaccount: [],
    };

    const [decimalsNat, totalSupplyNat, burnBalanceNat, archives, mainWindow] =
      await Promise.all([
        withTimeout(ledgerActor.icrc1_decimals(), 10_000),
        withTimeout(ledgerActor.icrc1_total_supply(), 10_000),
        withTimeout(ledgerActor.icrc1_balance_of(burnAccount), 10_000),
        withTimeout(ledgerActor.archives(), 10_000),
        withTimeout(ledgerActor.get_transactions({ start: 0n, length: 1n }), 10_000),
      ]);

    const decimals = Number(decimalsNat);
    const value = {
      canisterId: MGSN_LEDGER_CANISTER,
      decimals,
      currentSupply: tokenAmountToNumber(totalSupplyNat, decimals),
      currentSupplyRaw: totalSupplyNat.toString(),
      burnAddress: ICP_BLACKHOLE,
      burnAddressBalance: tokenAmountToNumber(burnBalanceNat, decimals),
      burnBalanceRaw: burnBalanceNat.toString(),
      logLength: Number(mainWindow.log_length),
      mainFirstIndex: Number(mainWindow.first_index),
      archives: archives.map((archive) => ({
        start: Number(archive.block_range_start),
        end: Number(archive.block_range_end),
        canisterId: archive.canister_id.toText(),
      })),
    };

    ledgerSnapshotCache = { ts: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

export async function fetchTokenLedgerSnapshot(canisterId, force = false) {
  if (!canisterId) return null;
  if (canisterId === MGSN_LEDGER_CANISTER) {
    return fetchMgsnLedgerSnapshot(force);
  }

  const cached = tokenLedgerSnapshotCache.get(canisterId);
  if (!force && isFresh(cached, SNAPSHOT_CACHE_MS)) {
    return cached.value;
  }

  try {
    const actor = getLedgerActor(canisterId);
    const [decimalsNat, totalSupplyNat] = await Promise.all([
      withTimeout(actor.icrc1_decimals(), 10_000),
      withTimeout(actor.icrc1_total_supply(), 10_000),
    ]);

    const decimals = Number(decimalsNat);
    const value = {
      canisterId,
      decimals,
      currentSupply: tokenAmountToNumber(totalSupplyNat, decimals),
      currentSupplyRaw: totalSupplyNat.toString(),
    };

    tokenLedgerSnapshotCache.set(canisterId, { ts: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

async function scanLedgerTransactions(onTransaction, force = false) {
  const snapshot = await fetchMgsnLedgerSnapshot(force);
  if (!snapshot) return null;

  const archiveJobs = snapshot.archives.flatMap((archive) =>
    buildChunkJobs(BigInt(archive.start), BigInt(archive.end), archive.canisterId)
  );

  await parallelForEach(archiveJobs, ARCHIVE_CONCURRENCY, async (job) => {
    const actor = getArchiveActor(job.canisterId);
    const response = await withTimeout(
      actor.get_transactions({ start: job.start, length: job.length }),
      20_000
    );

    response.transactions.forEach((tx, index) => {
      onTransaction(tx, job.start + BigInt(index));
    });
  });

  const mainStart = BigInt(snapshot.mainFirstIndex);
  const mainEnd = BigInt(Math.max(snapshot.logLength - 1, snapshot.mainFirstIndex - 1));
  const mainJobs = buildChunkJobs(mainStart, mainEnd, MGSN_LEDGER_CANISTER);

  await parallelForEach(mainJobs, 2, async (job) => {
    const response = await withTimeout(
      ledgerActor.get_transactions({ start: job.start, length: job.length }),
      20_000
    );

    response.transactions.forEach((tx, index) => {
      onTransaction(tx, BigInt(response.first_index) + BigInt(index));
    });
  });

  return snapshot;
}

function createBurnEvent(tx, blockIndex, decimals) {
  const transfer = tx.transfer?.[0];
  if (transfer && accountOwner(transfer.to) === ICP_BLACKHOLE) {
    return {
      blockIndex: Number(blockIndex),
      txId: blockIndex.toString(),
      date: txDate(tx.timestamp),
      timestampNs: tx.timestamp.toString(),
      address: accountOwner(transfer.from),
      mgsnBurned: tokenAmountToNumber(transfer.amount, decimals),
      note: "Transfer to ICP blackhole",
      method: "transfer_to_blackhole",
    };
  }

  const burn = tx.burn?.[0];
  if (burn) {
    return {
      blockIndex: Number(blockIndex),
      txId: blockIndex.toString(),
      date: txDate(tx.timestamp),
      timestampNs: tx.timestamp.toString(),
      address: accountOwner(burn.from),
      mgsnBurned: tokenAmountToNumber(burn.amount, decimals),
      note: "Native ledger burn",
      method: "native_burn",
    };
  }

  return null;
}

export async function fetchBurnProgramData(force = false) {
  if (!force && isFresh(burnProgramCache, PROGRAM_CACHE_MS)) {
    return burnProgramCache.value;
  }

  const snapshot = await fetchMgsnLedgerSnapshot(force);
  if (!snapshot) {
    const unavailable = {
      status: "unavailable",
      burnAddress: ICP_BLACKHOLE,
      burnAddressBalance: null,
      currentSupply: null,
      originalSupply: null,
      totalBurned: 0,
      log: [],
      note: "MGSN ledger history is temporarily unavailable.",
    };
    burnProgramCache = { ts: Date.now(), value: unavailable };
    return unavailable;
  }

  if (!force) {
    const cached = readBurnCache(snapshot);
    if (cached) {
      burnProgramCache = { ts: Date.now(), value: cached };
      return cached;
    }
  }

  const log = [];
  await scanLedgerTransactions((tx, blockIndex) => {
    const burnEvent = createBurnEvent(tx, blockIndex, snapshot.decimals);
    if (burnEvent) {
      log.push(burnEvent);
    }
  }, force);

  log.sort((a, b) => a.blockIndex - b.blockIndex);

  const totalBurned = log.reduce((sum, entry) => sum + entry.mgsnBurned, 0);
  const value = {
    status: "live",
    burnAddress: snapshot.burnAddress,
    burnAddressBalance: snapshot.burnAddressBalance,
    currentSupply: snapshot.currentSupply,
    originalSupply: snapshot.currentSupply + totalBurned,
    totalBurned,
    log,
    note: "Derived directly from the MGSN ledger, including blackhole transfers and native burn operations.",
  };

  writeBurnCache(snapshot, value);
  burnProgramCache = { ts: Date.now(), value };
  return value;
}

export async function fetchBuybackProgramData(force = false) {
  if (!force && isFresh(buybackProgramCache, PROGRAM_CACHE_MS)) {
    return buybackProgramCache.value;
  }

  const snapshot = await fetchMgsnLedgerSnapshot(force);
  const publicAccount = PROGRAM_ADDRESSES.buybackVaultOwner ?? null;

  if (!publicAccount) {
    const value = {
      status: "unconfigured",
      publicAccount: null,
      currentSupply: snapshot?.currentSupply ?? null,
      log: [],
      note: "Publish a dedicated public buyback vault account to auto-index buyback fills from the MGSN ledger.",
    };
    buybackProgramCache = { ts: Date.now(), value };
    return value;
  }

  if (!snapshot) {
    const value = {
      status: "unavailable",
      publicAccount,
      currentSupply: null,
      log: [],
      note: "The MGSN ledger could not be reached to verify buyback transfers.",
    };
    buybackProgramCache = { ts: Date.now(), value };
    return value;
  }

  const log = [];
  await scanLedgerTransactions((tx, blockIndex) => {
    const transfer = tx.transfer?.[0];
    if (!transfer || accountOwner(transfer.to) !== publicAccount) return;

    const mgsnAcquired = tokenAmountToNumber(transfer.amount, snapshot.decimals);
    log.push({
      blockIndex: Number(blockIndex),
      txId: blockIndex.toString(),
      date: txDate(tx.timestamp),
      usdSpent: null,
      usdBasis: "unavailable",
      usdReferencePrice: null,
      mgsnAcquired,
      note: "Detected transfer into public buyback vault",
    });
  }, force);

  log.sort((a, b) => a.blockIndex - b.blockIndex);

  let estimatedUsdCount = 0;
  if (log.length > 0) {
    try {
      const infoSnapshot = await fetchICPSwapInfoSnapshot(force);
      if (infoSnapshot.mgsnIcpPool?.poolId) {
        const poolChart = await fetchPoolChartDaily(infoSnapshot.mgsnIcpPool.poolId, {
          limit: 400,
          force,
        });
        for (const entry of log) {
          const estimate = estimateBuybackUsdSpent(
            entry.mgsnAcquired,
            entry.date,
            poolChart
          );
          entry.usdSpent = estimate.usdSpent;
          entry.usdBasis = estimate.usdBasis;
          entry.usdReferencePrice = estimate.priceUsd;
          if (estimate.usdSpent != null) estimatedUsdCount += 1;
        }
      }
    } catch {
      // Leave USD values null if the pool pricing reference cannot be fetched.
    }
  }

  const value = {
    status: "live",
    publicAccount,
    currentSupply: snapshot.currentSupply,
    log,
    note:
      estimatedUsdCount > 0
        ? "Indexed from MGSN transfers into the public buyback vault. USD values are estimated from daily ICPSwap MGSN/ICP pool snapshots until the paired ICP settlement path is published."
        : "Indexed from MGSN transfers into the public buyback vault. Matching USD settlement values will appear once the paired ICP execution path is published.",
  };

  buybackProgramCache = { ts: Date.now(), value };
  return value;
}

export async function fetchStakingProgramData(force = false) {
  if (!force && isFresh(stakingProgramCache, PROGRAM_CACHE_MS)) {
    return stakingProgramCache.value;
  }

  const snapshot = await fetchMgsnLedgerSnapshot(force);
  const canisterId = PROGRAM_ADDRESSES.stakingCanisterId ?? null;

  let value;
  if (!canisterId) {
    value = {
      status: "prelaunch",
      canisterId: null,
      currentSupply: snapshot?.currentSupply ?? null,
      positions: [],
      totalLocked: 0,
      totalWeight: 0,
      note: "No public staking canister has been published yet, so no live staking positions can be displayed.",
    };
  } else {
    value = {
      status: "configured",
      canisterId,
      currentSupply: snapshot?.currentSupply ?? null,
      positions: [],
      totalLocked: 0,
      totalWeight: 0,
      note: "A public staking canister is configured. Publish its public position methods and this page can upgrade from status-only reporting to live lock tiers and unlock dates.",
    };
  }

  stakingProgramCache = { ts: Date.now(), value };
  return value;
}
