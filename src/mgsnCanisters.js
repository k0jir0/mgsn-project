import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { safeGetCanisterEnv } from "@icp-sdk/core/agent/canister-env";
import { TOKEN_CANISTERS } from "./demoData.js";

const canisterEnv = safeGetCanisterEnv();
const IC_API_HOST = "https://icp-api.io";

function getCanisterHost() {
  return window.location.hostname.includes("localhost")
    ? window.location.origin
    : IC_API_HOST;
}

function resultVariant(okType) {
  return IDL.Variant({ ok: okType, err: IDL.Text });
}

function accountType() {
  return IDL.Record({
    owner: IDL.Principal,
    subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
}

function icrcTransferErrorType() {
  return IDL.Variant({
    BadFee: IDL.Record({ expected_fee: IDL.Nat }),
    BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
    InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
    TooOld: IDL.Null,
    CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
    TemporarilyUnavailable: IDL.Null,
    Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
    GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
  });
}

function icrcLedgerIdlFactory({ IDL }) {
  const Account = accountType();
  const TransferArgs = IDL.Record({
    from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    to: Account,
    amount: IDL.Nat,
    fee: IDL.Opt(IDL.Nat),
    memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    created_at_time: IDL.Opt(IDL.Nat64),
  });

  return IDL.Service({
    icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
    icrc1_decimals: IDL.Func([], [IDL.Nat8], ["query"]),
    icrc1_fee: IDL.Func([], [IDL.Nat], ["query"]),
    icrc1_symbol: IDL.Func([], [IDL.Text], ["query"]),
    icrc1_transfer: IDL.Func(
      [TransferArgs],
      [IDL.Variant({ Ok: IDL.Nat, Err: icrcTransferErrorType() })],
      []
    ),
  });
}

function governanceConfigType() {
  return IDL.Record({
    owner: IDL.Opt(IDL.Principal),
    snsRoot: IDL.Opt(IDL.Principal),
    snsGovernance: IDL.Opt(IDL.Principal),
    configuredAt: IDL.Opt(IDL.Int),
  });
}

function adminStateType() {
  return IDL.Record({
    owner: IDL.Opt(IDL.Principal),
    operators: IDL.Vec(IDL.Principal),
    authorizedReporters: IDL.Vec(IDL.Principal),
  });
}

function analyticsIdlFactory({ IDL }) {
  const AdminState = adminStateType();
  const RevenueEvent = IDL.Record({
    id: IDL.Nat,
    category: IDL.Text,
    ledgerId: IDL.Principal,
    amountE8s: IDL.Nat,
    occurredAt: IDL.Int,
    sourceCanister: IDL.Opt(IDL.Principal),
    metadata: IDL.Text,
  });
  const RevenueEventInput = IDL.Record({
    category: IDL.Text,
    ledgerId: IDL.Principal,
    amountE8s: IDL.Nat,
    occurredAt: IDL.Int,
    sourceCanister: IDL.Opt(IDL.Principal),
    metadata: IDL.Text,
  });
  const SubscriptionEvent = IDL.Record({
    id: IDL.Nat,
    subscriber: IDL.Principal,
    planId: IDL.Nat,
    planSlug: IDL.Text,
    status: IDL.Text,
    amountE8s: IDL.Nat,
    intervalDays: IDL.Nat,
    occurredAt: IDL.Int,
    sourceCanister: IDL.Opt(IDL.Principal),
    metadata: IDL.Text,
  });
  const SubscriptionEventInput = IDL.Record({
    subscriber: IDL.Principal,
    planId: IDL.Nat,
    planSlug: IDL.Text,
    status: IDL.Text,
    amountE8s: IDL.Nat,
    intervalDays: IDL.Nat,
    occurredAt: IDL.Int,
    sourceCanister: IDL.Opt(IDL.Principal),
    metadata: IDL.Text,
  });
  const SubscriptionState = IDL.Record({
    subscriber: IDL.Principal,
    planId: IDL.Nat,
    planSlug: IDL.Text,
    status: IDL.Text,
    amountE8s: IDL.Nat,
    intervalDays: IDL.Nat,
    updatedAt: IDL.Int,
  });
  const Dashboard = IDL.Record({
    admin: AdminState,
    totalRevenueE8s: IDL.Nat,
    trailing30dRevenueE8s: IDL.Nat,
    monthlyRecurringRevenueE8s: IDL.Nat,
    annualRecurringRevenueE8s: IDL.Nat,
    activeSubscriptions: IDL.Nat,
    payingSubscribers: IDL.Nat,
    recentRevenue: IDL.Vec(RevenueEvent),
    recentSubscriptionEvents: IDL.Vec(SubscriptionEvent),
    activeStates: IDL.Vec(SubscriptionState),
  });

  return IDL.Service({
    addOperator: IDL.Func([IDL.Principal], [resultVariant(IDL.Vec(IDL.Principal))], []),
    authorizeReporter: IDL.Func([IDL.Principal, IDL.Bool], [resultVariant(IDL.Vec(IDL.Principal))], []),
    claimOwner: IDL.Func([], [resultVariant(IDL.Principal)], []),
    getAdminState: IDL.Func([], [AdminState], ["query"]),
    getDashboard: IDL.Func([], [Dashboard], ["query"]),
    listRevenueEvents: IDL.Func([IDL.Nat], [IDL.Vec(RevenueEvent)], ["query"]),
    listSubscriptionEvents: IDL.Func([IDL.Nat], [IDL.Vec(SubscriptionEvent)], ["query"]),
    listSubscriptionStates: IDL.Func([], [IDL.Vec(SubscriptionState)], ["query"]),
    recordRevenueEvent: IDL.Func([RevenueEventInput], [resultVariant(RevenueEvent)], []),
    recordSubscriptionEvent: IDL.Func([SubscriptionEventInput], [resultVariant(SubscriptionEvent)], []),
    removeOperator: IDL.Func([IDL.Principal], [resultVariant(IDL.Vec(IDL.Principal))], []),
    transferOwnership: IDL.Func([IDL.Principal], [resultVariant(IDL.Principal)], []),
  });
}

function treasuryIdlFactory({ IDL }) {
  const Account = accountType();
  const GovernanceConfig = governanceConfigType();
  const TokenConfig = IDL.Record({
    symbol: IDL.Text,
    ledgerId: IDL.Principal,
    decimals: IDL.Nat8,
    fee: IDL.Nat,
    enabled: IDL.Bool,
  });
  const RevenuePolicy = IDL.Record({
    category: IDL.Text,
    targetBps: IDL.Nat,
    notes: IDL.Text,
  });
  const RevenueEvent = IDL.Record({
    id: IDL.Nat,
    ledgerId: IDL.Principal,
    tokenSymbol: IDL.Text,
    amountE8s: IDL.Nat,
    source: IDL.Text,
    memo: IDL.Text,
    recordedBy: IDL.Principal,
    recordedAt: IDL.Int,
    txIndex: IDL.Opt(IDL.Nat),
    fromCanister: IDL.Opt(IDL.Principal),
  });
  const RevenueRecordRequest = IDL.Record({
    ledgerId: IDL.Principal,
    tokenSymbol: IDL.Text,
    amountE8s: IDL.Nat,
    source: IDL.Text,
    memo: IDL.Text,
    txIndex: IDL.Opt(IDL.Nat),
    fromCanister: IDL.Opt(IDL.Principal),
  });
  const BalanceSnapshot = IDL.Record({
    ledgerId: IDL.Principal,
    tokenSymbol: IDL.Text,
    balanceE8s: IDL.Nat,
    capturedAt: IDL.Int,
  });
  const Disbursement = IDL.Record({
    id: IDL.Nat,
    ledgerId: IDL.Principal,
    tokenSymbol: IDL.Text,
    to: Account,
    amountE8s: IDL.Nat,
    feeE8s: IDL.Nat,
    reason: IDL.Text,
    memoText: IDL.Text,
    executedAt: IDL.Int,
    executedBy: IDL.Principal,
    txIndex: IDL.Nat,
  });
  const DisbursementRequest = IDL.Record({
    ledgerId: IDL.Principal,
    tokenSymbol: IDL.Text,
    to: Account,
    amountE8s: IDL.Nat,
    feeE8s: IDL.Opt(IDL.Nat),
    reason: IDL.Text,
    memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    memoText: IDL.Text,
  });
  const GovernanceUpdate = IDL.Record({
    owner: IDL.Opt(IDL.Principal),
    snsRoot: IDL.Opt(IDL.Principal),
    snsGovernance: IDL.Opt(IDL.Principal),
  });
  const AdminState = IDL.Record({
    owner: IDL.Opt(IDL.Principal),
    operators: IDL.Vec(IDL.Principal),
    authorizedRevenueReporters: IDL.Vec(IDL.Principal),
    analyticsCanister: IDL.Opt(IDL.Principal),
    governance: GovernanceConfig,
  });
  const Overview = IDL.Record({
    admin: AdminState,
    account: Account,
    trackedTokens: IDL.Vec(TokenConfig),
    revenuePolicies: IDL.Vec(RevenuePolicy),
    recentRevenue: IDL.Vec(RevenueEvent),
    recentDisbursements: IDL.Vec(Disbursement),
    recentSnapshots: IDL.Vec(BalanceSnapshot),
  });

  return IDL.Service({
    addOperator: IDL.Func([IDL.Principal], [resultVariant(IDL.Vec(IDL.Principal))], []),
    authorizeRevenueReporter: IDL.Func([IDL.Principal, IDL.Bool], [resultVariant(IDL.Vec(IDL.Principal))], []),
    claimOwner: IDL.Func([], [resultVariant(IDL.Principal)], []),
    configureGovernance: IDL.Func([GovernanceUpdate], [resultVariant(GovernanceConfig)], []),
    disburse: IDL.Func([DisbursementRequest], [resultVariant(Disbursement)], []),
    getAccount: IDL.Func([], [Account], ["query"]),
    getOverview: IDL.Func([], [Overview], ["query"]),
    listBalanceSnapshots: IDL.Func([IDL.Nat], [IDL.Vec(BalanceSnapshot)], ["query"]),
    listDisbursements: IDL.Func([IDL.Nat], [IDL.Vec(Disbursement)], ["query"]),
    listRevenueEvents: IDL.Func([IDL.Nat], [IDL.Vec(RevenueEvent)], ["query"]),
    recordRevenue: IDL.Func([RevenueRecordRequest], [resultVariant(RevenueEvent)], []),
    removeOperator: IDL.Func([IDL.Principal], [resultVariant(IDL.Vec(IDL.Principal))], []),
    setAnalyticsCanister: IDL.Func([IDL.Opt(IDL.Principal)], [resultVariant(IDL.Opt(IDL.Principal))], []),
    setRevenuePolicies: IDL.Func([IDL.Vec(RevenuePolicy)], [resultVariant(IDL.Vec(RevenuePolicy))], []),
    snapshotBalance: IDL.Func([IDL.Principal], [resultVariant(BalanceSnapshot)], []),
    transferOwnership: IDL.Func([IDL.Principal], [resultVariant(IDL.Principal)], []),
    upsertTrackedToken: IDL.Func([TokenConfig], [resultVariant(IDL.Vec(TokenConfig))], []),
  });
}

function subscriptionsIdlFactory({ IDL }) {
  const Account = accountType();
  const Plan = IDL.Record({
    id: IDL.Nat,
    slug: IDL.Text,
    name: IDL.Text,
    description: IDL.Text,
    priceE8s: IDL.Nat,
    intervalDays: IDL.Nat,
    active: IDL.Bool,
    features: IDL.Vec(IDL.Text),
    createdAt: IDL.Int,
  });
  const PlanInput = IDL.Record({
    slug: IDL.Text,
    name: IDL.Text,
    description: IDL.Text,
    priceE8s: IDL.Nat,
    intervalDays: IDL.Nat,
    active: IDL.Bool,
    features: IDL.Vec(IDL.Text),
  });
  const InvoiceStatus = IDL.Variant({
    pending: IDL.Null,
    paid: IDL.Null,
    swept: IDL.Null,
    expired: IDL.Null,
    cancelled: IDL.Null,
  });
  const Invoice = IDL.Record({
    id: IDL.Nat,
    planId: IDL.Nat,
    subscriber: IDL.Principal,
    quotedAmountE8s: IDL.Nat,
    revenueE8s: IDL.Nat,
    transferFeeE8s: IDL.Nat,
    subaccount: IDL.Vec(IDL.Nat8),
    account: Account,
    createdAt: IDL.Int,
    expiresAt: IDL.Int,
    paidAt: IDL.Opt(IDL.Int),
    sweptAt: IDL.Opt(IDL.Int),
    sweptTxIndex: IDL.Opt(IDL.Nat),
    balanceE8s: IDL.Nat,
    status: InvoiceStatus,
    memo: IDL.Text,
  });
  const SubscriptionStatus = IDL.Variant({
    active: IDL.Null,
    past_due: IDL.Null,
    cancelled: IDL.Null,
  });
  const Subscription = IDL.Record({
    id: IDL.Nat,
    planId: IDL.Nat,
    subscriber: IDL.Principal,
    startedAt: IDL.Int,
    renewedAt: IDL.Int,
    expiresAt: IDL.Int,
    lastInvoiceId: IDL.Nat,
    totalPaidE8s: IDL.Nat,
    status: SubscriptionStatus,
  });
  const IntegrationConfig = IDL.Record({
    treasuryCanister: IDL.Opt(IDL.Principal),
    analyticsCanister: IDL.Opt(IDL.Principal),
    ledgerId: IDL.Principal,
    tokenSymbol: IDL.Text,
    tokenDecimals: IDL.Nat8,
    tokenFee: IDL.Nat,
    invoiceTtlDays: IDL.Nat,
  });
  const Settlement = IDL.Record({
    invoice: Invoice,
    subscription: Subscription,
    treasuryTransferTxIndex: IDL.Nat,
    treasuryRecorded: IDL.Bool,
    analyticsRecorded: IDL.Bool,
  });
  const TrenchRouteMode = IDL.Variant({
    phase_one_liquidity: IDL.Null,
    bob_reserve_planned: IDL.Null,
  });
  const TrenchStage = IDL.Variant({
    intent_created: IDL.Null,
    funds_detected: IDL.Null,
    icp_swept: IDL.Null,
    mgsn_execution_ready: IDL.Null,
    liquidity_routed: IDL.Null,
    lp_locked: IDL.Null,
    lp_burned: IDL.Null,
    proof_published: IDL.Null,
  });
  const TrenchCheckpoint = IDL.Record({
    stage: TrenchStage,
    recordedAt: IDL.Int,
    note: IDL.Text,
    recordedBy: IDL.Principal,
    txIndex: IDL.Opt(IDL.Nat),
  });
  const TrenchIntent = IDL.Record({
    id: IDL.Nat,
    subscriber: IDL.Principal,
    routeMode: TrenchRouteMode,
    requestedAmountE8s: IDL.Nat,
    routedAmountE8s: IDL.Nat,
    quotedAmountE8s: IDL.Nat,
    transferFeeE8s: IDL.Nat,
    subaccount: IDL.Vec(IDL.Nat8),
    account: Account,
    createdAt: IDL.Int,
    expiresAt: IDL.Int,
    paidAt: IDL.Opt(IDL.Int),
    sweptAt: IDL.Opt(IDL.Int),
    sweptTxIndex: IDL.Opt(IDL.Nat),
    balanceE8s: IDL.Nat,
    status: InvoiceStatus,
    currentStage: TrenchStage,
    memo: IDL.Text,
    checkpoints: IDL.Vec(TrenchCheckpoint),
  });
  const TrenchSettlement = IDL.Record({
    intent: TrenchIntent,
    treasuryTransferTxIndex: IDL.Nat,
    treasuryRecorded: IDL.Bool,
  });
  const TrenchOverview = IDL.Record({
    owner: IDL.Opt(IDL.Principal),
    operators: IDL.Vec(IDL.Principal),
    config: IntegrationConfig,
    intents: IDL.Vec(TrenchIntent),
    totalRequestedE8s: IDL.Nat,
    totalObservedE8s: IDL.Nat,
    totalSettledE8s: IDL.Nat,
    settledCount: IDL.Nat,
    pendingCount: IDL.Nat,
  });
  const PortalState = IDL.Record({
    owner: IDL.Opt(IDL.Principal),
    operators: IDL.Vec(IDL.Principal),
    config: IntegrationConfig,
    plans: IDL.Vec(Plan),
    invoices: IDL.Vec(Invoice),
    subscriptions: IDL.Vec(Subscription),
  });

  return IDL.Service({
    addOperator: IDL.Func([IDL.Principal], [resultVariant(IDL.Vec(IDL.Principal))], []),
    advanceTrenchIntent: IDL.Func([IDL.Nat, TrenchStage, IDL.Text, IDL.Opt(IDL.Nat)], [resultVariant(TrenchIntent)], []),
    cancelMySubscription: IDL.Func([IDL.Nat], [resultVariant(Subscription)], []),
    claimOwner: IDL.Func([], [resultVariant(IDL.Principal)], []),
    configure: IDL.Func([IntegrationConfig], [resultVariant(IntegrationConfig)], []),
    createInvoice: IDL.Func([IDL.Nat, IDL.Text], [resultVariant(Invoice)], []),
    createPlan: IDL.Func([PlanInput], [resultVariant(Plan)], []),
    createTrenchIntent: IDL.Func([IDL.Nat, TrenchRouteMode, IDL.Text], [resultVariant(TrenchIntent)], []),
    getConfig: IDL.Func([], [IntegrationConfig], ["query"]),
    getPortalState: IDL.Func([IDL.Opt(IDL.Principal)], [PortalState], ["query"]),
    getTrenchState: IDL.Func([IDL.Opt(IDL.Principal)], [TrenchOverview], ["query"]),
    listPlans: IDL.Func([], [IDL.Vec(Plan)], ["query"]),
    refreshInvoice: IDL.Func([IDL.Nat], [resultVariant(Invoice)], []),
    refreshTrenchIntent: IDL.Func([IDL.Nat], [resultVariant(TrenchIntent)], []),
    removeOperator: IDL.Func([IDL.Principal], [resultVariant(IDL.Vec(IDL.Principal))], []),
    settleInvoice: IDL.Func([IDL.Nat], [resultVariant(Settlement)], []),
    settleTrenchIntent: IDL.Func([IDL.Nat], [resultVariant(TrenchSettlement)], []),
    transferOwnership: IDL.Func([IDL.Principal], [resultVariant(IDL.Principal)], []),
    updatePlan: IDL.Func([IDL.Nat, PlanInput], [resultVariant(Plan)], []),
  });
}

export function getPublicCanisterId(name) {
  return canisterEnv?.[`PUBLIC_CANISTER_ID:${name}`] ?? null;
}

async function createManagedActor(name, idlFactory, identity) {
  const canisterId = getPublicCanisterId(name);
  if (!canisterId) {
    return null;
  }

  const agent = new HttpAgent({
    host: getCanisterHost(),
    identity,
    rootKey: canisterEnv?.IC_ROOT_KEY,
  });

  return Actor.createActor(idlFactory, {
    agent,
    canisterId,
  });
}

export async function createAnalyticsActor(identity) {
  return createManagedActor("analytics", analyticsIdlFactory, identity);
}

export async function createTreasuryActor(identity) {
  return createManagedActor("treasury", treasuryIdlFactory, identity);
}

export async function createSubscriptionsActor(identity) {
  return createManagedActor("subscriptions", subscriptionsIdlFactory, identity);
}

export async function createMgsnLedgerActor(identity) {
  const agent = new HttpAgent({
    host: getCanisterHost(),
    identity,
    rootKey: canisterEnv?.IC_ROOT_KEY,
  });

  return Actor.createActor(icrcLedgerIdlFactory, {
    agent,
    canisterId: TOKEN_CANISTERS.MGSN,
  });
}
