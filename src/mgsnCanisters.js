import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { safeGetCanisterEnv } from "@icp-sdk/core/agent/canister-env";

const canisterEnv = safeGetCanisterEnv();

function resultVariant(okType) {
  return IDL.Variant({ ok: okType, err: IDL.Text });
}

function accountType() {
  return IDL.Record({
    owner: IDL.Principal,
    subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
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
    cancelMySubscription: IDL.Func([IDL.Nat], [resultVariant(Subscription)], []),
    claimOwner: IDL.Func([], [resultVariant(IDL.Principal)], []),
    configure: IDL.Func([IntegrationConfig], [resultVariant(IntegrationConfig)], []),
    createInvoice: IDL.Func([IDL.Nat, IDL.Text], [resultVariant(Invoice)], []),
    createPlan: IDL.Func([PlanInput], [resultVariant(Plan)], []),
    getConfig: IDL.Func([], [IntegrationConfig], ["query"]),
    getPortalState: IDL.Func([IDL.Opt(IDL.Principal)], [PortalState], ["query"]),
    listPlans: IDL.Func([], [IDL.Vec(Plan)], ["query"]),
    refreshInvoice: IDL.Func([IDL.Nat], [resultVariant(Invoice)], []),
    removeOperator: IDL.Func([IDL.Principal], [resultVariant(IDL.Vec(IDL.Principal))], []),
    settleInvoice: IDL.Func([IDL.Nat], [resultVariant(Settlement)], []),
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
    host: window.location.origin,
    identity,
  });

  if (window.location.hostname.includes("localhost")) {
    try {
      await agent.fetchRootKey();
    } catch {
      // Ignore local root key failures and let the caller surface any follow-up issues.
    }
  }

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