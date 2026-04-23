import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Error "mo:core/Error";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Time "mo:core/Time";

import Ledger "../shared/Ledger";
import Platform "../shared/Platform";

persistent actor Subscriptions {
  type Result<T> = {
    #ok : T;
    #err : Text;
  };

  public type Account = Ledger.Account;

  public type Plan = {
    id : Nat;
    slug : Text;
    name : Text;
    description : Text;
    priceE8s : Nat;
    intervalDays : Nat;
    active : Bool;
    features : [Text];
    createdAt : Int;
  };

  public type PlanInput = {
    slug : Text;
    name : Text;
    description : Text;
    priceE8s : Nat;
    intervalDays : Nat;
    active : Bool;
    features : [Text];
  };

  public type InvoiceStatus = {
    #pending;
    #paid;
    #swept;
    #expired;
    #cancelled;
  };

  public type Invoice = {
    id : Nat;
    planId : Nat;
    subscriber : Principal;
    quotedAmountE8s : Nat;
    revenueE8s : Nat;
    transferFeeE8s : Nat;
    subaccount : Blob;
    account : Account;
    createdAt : Int;
    expiresAt : Int;
    paidAt : ?Int;
    sweptAt : ?Int;
    sweptTxIndex : ?Nat;
    balanceE8s : Nat;
    status : InvoiceStatus;
    memo : Text;
  };

  public type SubscriptionStatus = {
    #active;
    #past_due;
    #cancelled;
  };

  public type Subscription = {
    id : Nat;
    planId : Nat;
    subscriber : Principal;
    startedAt : Int;
    renewedAt : Int;
    expiresAt : Int;
    lastInvoiceId : Nat;
    totalPaidE8s : Nat;
    status : SubscriptionStatus;
  };

  public type IntegrationConfig = {
    treasuryCanister : ?Principal;
    analyticsCanister : ?Principal;
    ledgerId : Principal;
    tokenSymbol : Text;
    tokenDecimals : Nat8;
    tokenFee : Nat;
    invoiceTtlDays : Nat;
  };

  public type Settlement = {
    invoice : Invoice;
    subscription : Subscription;
    treasuryTransferTxIndex : Nat;
    treasuryRecorded : Bool;
    analyticsRecorded : Bool;
  };

  public type TrenchRouteMode = {
    #phase_one_liquidity;
    #bob_reserve_planned;
  };

  public type TrenchStage = {
    #intent_created;
    #funds_detected;
    #icp_swept;
    #mgsn_execution_ready;
    #liquidity_routed;
    #lp_locked;
    #lp_burned;
    #proof_published;
  };

  public type TrenchCheckpoint = {
    stage : TrenchStage;
    recordedAt : Int;
    note : Text;
    recordedBy : Principal;
    txIndex : ?Nat;
  };

  public type TrenchIntent = {
    id : Nat;
    subscriber : Principal;
    routeMode : TrenchRouteMode;
    requestedAmountE8s : Nat;
    routedAmountE8s : Nat;
    quotedAmountE8s : Nat;
    transferFeeE8s : Nat;
    subaccount : Blob;
    account : Account;
    createdAt : Int;
    expiresAt : Int;
    paidAt : ?Int;
    sweptAt : ?Int;
    sweptTxIndex : ?Nat;
    balanceE8s : Nat;
    status : InvoiceStatus;
    currentStage : TrenchStage;
    memo : Text;
    checkpoints : [TrenchCheckpoint];
  };

  public type TrenchSettlement = {
    intent : TrenchIntent;
    treasuryTransferTxIndex : Nat;
    treasuryRecorded : Bool;
  };

  public type TrenchOverview = {
    owner : ?Principal;
    operators : [Principal];
    config : IntegrationConfig;
    intents : [TrenchIntent];
    totalRequestedE8s : Nat;
    totalObservedE8s : Nat;
    totalSettledE8s : Nat;
    settledCount : Nat;
    pendingCount : Nat;
  };

  public type PortalState = {
    owner : ?Principal;
    operators : [Principal];
    config : IntegrationConfig;
    plans : [Plan];
    invoices : [Invoice];
    subscriptions : [Subscription];
  };

  type TreasuryRevenueRequest = {
    ledgerId : Principal;
    tokenSymbol : Text;
    amountE8s : Nat;
    source : Text;
    memo : Text;
    txIndex : ?Nat;
    fromCanister : ?Principal;
  };

  type TreasuryRevenueEvent = {
    id : Nat;
    ledgerId : Principal;
    tokenSymbol : Text;
    amountE8s : Nat;
    source : Text;
    memo : Text;
    recordedBy : Principal;
    recordedAt : Int;
    txIndex : ?Nat;
    fromCanister : ?Principal;
  };

  type TreasuryActor = actor {
    recordRevenue : shared TreasuryRevenueRequest -> async Result<TreasuryRevenueEvent>;
  };

  type AnalyticsSubscriptionInput = {
    subscriber : Principal;
    planId : Nat;
    planSlug : Text;
    status : Text;
    amountE8s : Nat;
    intervalDays : Nat;
    occurredAt : Int;
    sourceCanister : ?Principal;
    metadata : Text;
  };

  type AnalyticsSubscriptionEvent = {
    id : Nat;
    subscriber : Principal;
    planId : Nat;
    planSlug : Text;
    status : Text;
    amountE8s : Nat;
    intervalDays : Nat;
    occurredAt : Int;
    sourceCanister : ?Principal;
    metadata : Text;
  };

  type AnalyticsActor = actor {
    recordSubscriptionEvent : shared AnalyticsSubscriptionInput -> async Result<AnalyticsSubscriptionEvent>;
  };

  let TRENCH_SUBACCOUNT_OFFSET : Nat = 1_000_000_000;

  var owner : ?Principal = null;
  var operators : [Principal] = [];
  var config : IntegrationConfig = {
    treasuryCanister = null;
    analyticsCanister = null;
    ledgerId = Platform.icpLedger();
    tokenSymbol = "ICP";
    tokenDecimals = 8;
    tokenFee = 10_000;
    invoiceTtlDays = 7;
  };
  var plans : [Plan] = [
    {
      id = 1;
      slug = "pro";
      name = "MGSN Pro";
      description = "Recurring treasury-backed access to premium market intelligence and DAO operations modules.";
      priceE8s = 500_000_000;
      intervalDays = 30;
      active = true;
      features = ["Treasury analytics", "DAO execution feeds", "Revenue reporting exports"];
      createdAt = Time.now();
    },
    {
      id = 2;
      slug = "dao-seat";
      name = "DAO Ops Seat";
      description = "Team seat for treasury operators, reporting automation, and governance workflows.";
      priceE8s = 2_000_000_000;
      intervalDays = 30;
      active = true;
      features = ["Seat provisioning", "Policy snapshots", "Shared treasury controls"];
      createdAt = Time.now();
    },
  ];
  var invoices : [Invoice] = [];
  var subscriptions : [Subscription] = [];
  var trenchIntents : [TrenchIntent] = [];
  var nextPlanId : Nat = 3;
  var nextInvoiceId : Nat = 1;
  var nextSubscriptionId : Nat = 1;
  var nextTrenchIntentId : Nat = 1;

  func selfPrincipal() : Principal {
    Principal.fromActor(Subscriptions);
  };

  func isAdmin(caller : Principal) : Bool {
    Platform.isAdmin(owner, operators, caller);
  };

  func findPlanIndex(planId : Nat) : ?Nat {
    Array.findIndex<Plan>(plans, func(plan) = plan.id == planId);
  };

  func findInvoiceIndex(invoiceId : Nat) : ?Nat {
    Array.findIndex<Invoice>(invoices, func(invoice) = invoice.id == invoiceId);
  };

  func findSubscriptionIndex(subscriber : Principal, planId : Nat) : ?Nat {
    Array.findIndex<Subscription>(
      subscriptions,
      func(subscription) = Principal.equal(subscription.subscriber, subscriber) and subscription.planId == planId,
    );
  };

  func findTrenchIntentIndex(intentId : Nat) : ?Nat {
    Array.findIndex<TrenchIntent>(trenchIntents, func(intent) = intent.id == intentId);
  };

  func deriveInvoiceStatus(invoice : Invoice, balance : Nat, now : Int) : InvoiceStatus {
    switch (invoice.status) {
      case (#cancelled) { #cancelled };
      case (#swept) { #swept };
      case _ {
        if (balance >= invoice.quotedAmountE8s) {
          #paid;
        } else if (now > invoice.expiresAt) {
          #expired;
        } else {
          #pending;
        };
      };
    };
  };

  func replaceInvoice(index : Nat, invoice : Invoice) {
    invoices := Platform.replaceAt(invoices, index, invoice);
  };

  func replaceSubscription(index : Nat, subscription : Subscription) {
    subscriptions := Platform.replaceAt(subscriptions, index, subscription);
  };

  func replaceTrenchIntent(index : Nat, intent : TrenchIntent) {
    trenchIntents := Platform.replaceAt(trenchIntents, index, intent);
  };

  func trenchStageRank(stage : TrenchStage) : Nat {
    switch (stage) {
      case (#intent_created) { 0 };
      case (#funds_detected) { 1 };
      case (#icp_swept) { 2 };
      case (#mgsn_execution_ready) { 3 };
      case (#liquidity_routed) { 4 };
      case (#lp_locked) { 5 };
      case (#lp_burned) { 6 };
      case (#proof_published) { 7 };
    };
  };

  func trenchHasCheckpoint(intent : TrenchIntent, stage : TrenchStage) : Bool {
    Array.find<TrenchCheckpoint>(intent.checkpoints, func(checkpoint) = checkpoint.stage == stage) != null;
  };

  func trenchCheckpoint(stage : TrenchStage, note : Text, recordedBy : Principal, recordedAt : Int, txIndex : ?Nat) : TrenchCheckpoint {
    {
      stage;
      recordedAt;
      note;
      recordedBy;
      txIndex;
    };
  };

  func appendTrenchCheckpoint(intent : TrenchIntent, checkpoint : TrenchCheckpoint) : TrenchIntent {
    if (trenchHasCheckpoint(intent, checkpoint.stage)) {
      return intent;
    };

    let nextStage = if (trenchStageRank(checkpoint.stage) > trenchStageRank(intent.currentStage)) {
      checkpoint.stage;
    } else {
      intent.currentStage;
    };

    {
      id = intent.id;
      subscriber = intent.subscriber;
      routeMode = intent.routeMode;
      requestedAmountE8s = intent.requestedAmountE8s;
      routedAmountE8s = intent.routedAmountE8s;
      quotedAmountE8s = intent.quotedAmountE8s;
      transferFeeE8s = intent.transferFeeE8s;
      subaccount = intent.subaccount;
      account = intent.account;
      createdAt = intent.createdAt;
      expiresAt = intent.expiresAt;
      paidAt = intent.paidAt;
      sweptAt = intent.sweptAt;
      sweptTxIndex = intent.sweptTxIndex;
      balanceE8s = intent.balanceE8s;
      status = intent.status;
      currentStage = nextStage;
      memo = intent.memo;
      checkpoints = Platform.push(intent.checkpoints, checkpoint);
    };
  };

  func defaultTrenchStageNote(stage : TrenchStage) : Text {
    switch (stage) {
      case (#intent_created) { "Trench intent created." };
      case (#funds_detected) { "Ingress detected on-chain." };
      case (#icp_swept) { "ICP swept to treasury. Phase one route is ready." };
      case (#mgsn_execution_ready) { "MGSN execution rail armed for phase one routing." };
      case (#liquidity_routed) { "Liquidity route marked." };
      case (#lp_locked) { "LP lock published." };
      case (#lp_burned) { "LP burn published." };
      case (#proof_published) { "Proof note published." };
    };
  };

  func trenchIntentWithState(
    intent : TrenchIntent,
    balance : Nat,
    now : Int,
    routedAmountE8s : ?Nat,
    sweptAt : ?Int,
    sweptTxIndex : ?Nat,
    statusOverride : ?InvoiceStatus,
  ) : TrenchIntent {
    let status = switch (statusOverride) {
      case (?value) { value };
      case null {
        switch (intent.status) {
          case (#cancelled) { #cancelled };
          case (#swept) { #swept };
          case _ {
            if (balance >= intent.quotedAmountE8s) {
              #paid;
            } else if (now > intent.expiresAt) {
              #expired;
            } else {
              #pending;
            };
          };
        };
      };
    };

    let paidAt = if (balance >= intent.quotedAmountE8s) {
      switch (intent.paidAt) {
        case (?existing) { ?existing };
        case null { ?now };
      };
    } else {
      intent.paidAt;
    };

    let base : TrenchIntent = {
      id = intent.id;
      subscriber = intent.subscriber;
      routeMode = intent.routeMode;
      requestedAmountE8s = intent.requestedAmountE8s;
      routedAmountE8s = switch (routedAmountE8s) {
        case (?value) { value };
        case null { intent.routedAmountE8s };
      };
      quotedAmountE8s = intent.quotedAmountE8s;
      transferFeeE8s = intent.transferFeeE8s;
      subaccount = intent.subaccount;
      account = intent.account;
      createdAt = intent.createdAt;
      expiresAt = intent.expiresAt;
      paidAt;
      sweptAt = switch (sweptAt) {
        case (?value) { ?value };
        case null { intent.sweptAt };
      };
      sweptTxIndex = switch (sweptTxIndex) {
        case (?value) { ?value };
        case null { intent.sweptTxIndex };
      };
      balanceE8s = balance;
      status;
      currentStage = intent.currentStage;
      memo = intent.memo;
      checkpoints = intent.checkpoints;
    };

    if (balance >= intent.quotedAmountE8s and not trenchHasCheckpoint(base, #funds_detected)) {
      appendTrenchCheckpoint(
        base,
        trenchCheckpoint(
          #funds_detected,
          defaultTrenchStageNote(#funds_detected),
          selfPrincipal(),
          switch (paidAt) {
            case (?value) { value };
            case null { now };
          },
          null,
        ),
      );
    } else {
      base;
    };
  };

  func invoiceWithState(invoice : Invoice, balance : Nat, now : Int, sweptAt : ?Int, sweptTxIndex : ?Nat, statusOverride : ?InvoiceStatus) : Invoice {
    let status = switch (statusOverride) {
      case (?value) { value };
      case null { deriveInvoiceStatus(invoice, balance, now) };
    };

    {
      id = invoice.id;
      planId = invoice.planId;
      subscriber = invoice.subscriber;
      quotedAmountE8s = invoice.quotedAmountE8s;
      revenueE8s = invoice.revenueE8s;
      transferFeeE8s = invoice.transferFeeE8s;
      subaccount = invoice.subaccount;
      account = invoice.account;
      createdAt = invoice.createdAt;
      expiresAt = invoice.expiresAt;
      paidAt = if (balance >= invoice.quotedAmountE8s) {
        switch (invoice.paidAt) {
          case (?existing) { ?existing };
          case null { ?now };
        };
      } else {
        invoice.paidAt;
      };
      sweptAt = switch (sweptAt) {
        case (?value) { ?value };
        case null { invoice.sweptAt };
      };
      sweptTxIndex = switch (sweptTxIndex) {
        case (?value) { ?value };
        case null { invoice.sweptTxIndex };
      };
      balanceE8s = balance;
      status;
      memo = invoice.memo;
    };
  };

  func subscriptionStatus(subscription : Subscription, now : Int) : SubscriptionStatus {
    switch (subscription.status) {
      case (#cancelled) { #cancelled };
      case _ {
        if (subscription.expiresAt <= now) {
          #past_due;
        } else {
          #active;
        };
      };
    };
  };

  func materializeSubscription(subscription : Subscription, now : Int) : Subscription {
    {
      id = subscription.id;
      planId = subscription.planId;
      subscriber = subscription.subscriber;
      startedAt = subscription.startedAt;
      renewedAt = subscription.renewedAt;
      expiresAt = subscription.expiresAt;
      lastInvoiceId = subscription.lastInvoiceId;
      totalPaidE8s = subscription.totalPaidE8s;
      status = subscriptionStatus(subscription, now);
    };
  };

  func requireUserOrAdmin(caller : Principal, target : Principal) : Bool {
    Principal.equal(caller, target) or isAdmin(caller);
  };

  func syncInvoice(invoiceId : Nat) : async Result<Invoice> {
    let invoiceIndex = switch (findInvoiceIndex(invoiceId)) {
      case (?index) { index };
      case null { return #err("Invoice not found") };
    };

    let invoice = invoices[invoiceIndex];
    let ledger : Ledger.ICRC1 = actor (Principal.toText(config.ledgerId));
    let now = Time.now();

    try {
      let balance = await ledger.icrc1_balance_of(invoice.account);
      let updated = invoiceWithState(invoice, balance, now, null, null, null);
      replaceInvoice(invoiceIndex, updated);
      #ok(updated);
    } catch (error) {
      #err("Unable to refresh invoice balance: " # Error.message(error));
    };
  };

  func renewSubscription(plan : Plan, subscriber : Principal, invoiceId : Nat, paidAmount : Nat, now : Int) : Subscription {
    let existingIndex = findSubscriptionIndex(subscriber, plan.id);
    let intervalNs = Nat.toInt(plan.intervalDays) * Platform.DAY_NS;

    switch (existingIndex) {
      case (?index) {
        let existing = materializeSubscription(subscriptions[index], now);
        let baseTime = if (existing.expiresAt > now and existing.status != #cancelled) {
          existing.expiresAt;
        } else {
          now;
        };

        let updated : Subscription = {
          id = existing.id;
          planId = existing.planId;
          subscriber = existing.subscriber;
          startedAt = existing.startedAt;
          renewedAt = now;
          expiresAt = baseTime + intervalNs;
          lastInvoiceId = invoiceId;
          totalPaidE8s = existing.totalPaidE8s + paidAmount;
          status = #active;
        };

        replaceSubscription(index, updated);
        updated;
      };
      case null {
        let created : Subscription = {
          id = nextSubscriptionId;
          planId = plan.id;
          subscriber;
          startedAt = now;
          renewedAt = now;
          expiresAt = now + intervalNs;
          lastInvoiceId = invoiceId;
          totalPaidE8s = paidAmount;
          status = #active;
        };

        nextSubscriptionId += 1;
        subscriptions := Platform.push(subscriptions, created);
        created;
      };
    };
  };

  public shared ({ caller }) func claimOwner() : async Result<Principal> {
    switch (owner) {
      case (?currentOwner) {
        if (Principal.equal(currentOwner, caller)) {
          #ok(currentOwner);
        } else {
          #err("Owner already claimed");
        };
      };
      case null {
        owner := ?caller;
        #ok(caller);
      };
    };
  };

  public shared ({ caller }) func transferOwnership(nextOwner : Principal) : async Result<Principal> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can transfer subscription ownership");
    };

    owner := ?nextOwner;
    #ok(nextOwner);
  };

  public shared ({ caller }) func addOperator(nextOperator : Principal) : async Result<[Principal]> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can add operators");
    };

    if (Platform.containsPrincipal(operators, nextOperator)) {
      return #ok(operators);
    };

    operators := Platform.push(operators, nextOperator);
    #ok(operators);
  };

  public shared ({ caller }) func removeOperator(target : Principal) : async Result<[Principal]> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can remove operators");
    };

    operators := Platform.removePrincipal(operators, target);
    #ok(operators);
  };

  public shared ({ caller }) func configure(configUpdate : IntegrationConfig) : async Result<IntegrationConfig> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can configure integrations");
    };

    config := configUpdate;
    #ok(config);
  };

  public shared ({ caller }) func createPlan(input : PlanInput) : async Result<Plan> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can create plans");
    };

    if (Platform.containsText(Array.map<Plan, Text>(plans, func(plan) = plan.slug), input.slug)) {
      return #err("Plan slug already exists");
    };

    let plan : Plan = {
      id = nextPlanId;
      slug = input.slug;
      name = input.name;
      description = input.description;
      priceE8s = input.priceE8s;
      intervalDays = input.intervalDays;
      active = input.active;
      features = input.features;
      createdAt = Time.now();
    };

    nextPlanId += 1;
    plans := Platform.push(plans, plan);

    #ok(plan);
  };

  public shared ({ caller }) func updatePlan(planId : Nat, input : PlanInput) : async Result<Plan> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can update plans");
    };

    let planIndex = switch (findPlanIndex(planId)) {
      case (?index) { index };
      case null { return #err("Plan not found") };
    };

    let existing = plans[planIndex];
    let updated : Plan = {
      id = existing.id;
      slug = input.slug;
      name = input.name;
      description = input.description;
      priceE8s = input.priceE8s;
      intervalDays = input.intervalDays;
      active = input.active;
      features = input.features;
      createdAt = existing.createdAt;
    };

    plans := Platform.replaceAt(plans, planIndex, updated);
    #ok(updated);
  };

  public query func listPlans() : async [Plan] {
    plans;
  };

  public query func getConfig() : async IntegrationConfig {
    config;
  };

  public query func getPortalState(subscriber : ?Principal) : async PortalState {
    let now = Time.now();
    let subjectInvoices = switch (subscriber) {
      case (?principal) {
        Array.map<Invoice, Invoice>(
          Array.filter<Invoice>(invoices, func(invoice) = Principal.equal(invoice.subscriber, principal)),
          func(invoice) = invoiceWithState(invoice, invoice.balanceE8s, now, null, null, null),
        );
      };
      case null { [] };
    };
    let subjectSubscriptions = switch (subscriber) {
      case (?principal) {
        Array.map<Subscription, Subscription>(
          Array.filter<Subscription>(subscriptions, func(subscription) = Principal.equal(subscription.subscriber, principal)),
          func(subscription) = materializeSubscription(subscription, now),
        );
      };
      case null { [] };
    };

    {
      owner;
      operators;
      config;
      plans;
      invoices = subjectInvoices;
      subscriptions = subjectSubscriptions;
    };
  };

  public query func getTrenchState(subscriber : ?Principal) : async TrenchOverview {
    let now = Time.now();
    let subjectIntents = switch (subscriber) {
      case (?principal) {
        Array.map<TrenchIntent, TrenchIntent>(
          Array.filter<TrenchIntent>(trenchIntents, func(intent) = Principal.equal(intent.subscriber, principal)),
          func(intent) = trenchIntentWithState(intent, intent.balanceE8s, now, null, null, null, null),
        );
      };
      case null {
        Array.map<TrenchIntent, TrenchIntent>(
          trenchIntents,
          func(intent) = trenchIntentWithState(intent, intent.balanceE8s, now, null, null, null, null),
        );
      };
    };

    {
      owner;
      operators;
      config;
      intents = subjectIntents;
      totalRequestedE8s = Array.foldLeft<TrenchIntent, Nat>(subjectIntents, 0, func(sum, intent) = sum + intent.requestedAmountE8s);
      totalObservedE8s = Array.foldLeft<TrenchIntent, Nat>(subjectIntents, 0, func(sum, intent) = sum + intent.balanceE8s);
      totalSettledE8s = Array.foldLeft<TrenchIntent, Nat>(subjectIntents, 0, func(sum, intent) = sum + intent.routedAmountE8s);
      settledCount = Array.foldLeft<TrenchIntent, Nat>(
        subjectIntents,
        0,
        func(sum, intent) = if (intent.status == #swept) { sum + 1 } else { sum },
      );
      pendingCount = Array.foldLeft<TrenchIntent, Nat>(
        subjectIntents,
        0,
        func(sum, intent) = if (intent.status == #swept or intent.status == #cancelled or intent.status == #expired) { sum } else { sum + 1 },
      );
    };
  };

  public shared ({ caller }) func createInvoice(planId : Nat, memo : Text) : async Result<Invoice> {
    let planIndex = switch (findPlanIndex(planId)) {
      case (?index) { index };
      case null { return #err("Plan not found") };
    };

    let plan = plans[planIndex];
    if (not plan.active) {
      return #err("Selected plan is not currently active");
    };

    let now = Time.now();
    let subaccount = Platform.subaccountFromNat(nextInvoiceId);
    let invoice : Invoice = {
      id = nextInvoiceId;
      planId;
      subscriber = caller;
      quotedAmountE8s = plan.priceE8s + config.tokenFee;
      revenueE8s = plan.priceE8s;
      transferFeeE8s = config.tokenFee;
      subaccount = subaccount;
      account = {
        owner = selfPrincipal();
        subaccount = ?subaccount;
      };
      createdAt = now;
      expiresAt = now + Nat.toInt(config.invoiceTtlDays) * Platform.DAY_NS;
      paidAt = null;
      sweptAt = null;
      sweptTxIndex = null;
      balanceE8s = 0;
      status = #pending;
      memo = memo;
    };

    nextInvoiceId += 1;
    invoices := Platform.push(invoices, invoice);
    #ok(invoice);
  };

  func syncTrenchIntent(intentId : Nat) : async Result<TrenchIntent> {
    let intentIndex = switch (findTrenchIntentIndex(intentId)) {
      case (?index) { index };
      case null { return #err("Trench intent not found") };
    };

    let intent = trenchIntents[intentIndex];
    let ledger : Ledger.ICRC1 = actor (Principal.toText(config.ledgerId));
    let now = Time.now();

    try {
      let balance = await ledger.icrc1_balance_of(intent.account);
      let updated = trenchIntentWithState(intent, balance, now, null, null, null, null);
      replaceTrenchIntent(intentIndex, updated);
      #ok(updated);
    } catch (error) {
      #err("Unable to refresh trench ingress: " # Error.message(error));
    };
  };

  public shared ({ caller }) func createTrenchIntent(requestedAmountE8s : Nat, routeMode : TrenchRouteMode, memo : Text) : async Result<TrenchIntent> {
    if (requestedAmountE8s == 0) {
      return #err("Enter a positive ICP amount for the trench intent");
    };

    let now = Time.now();
    let subaccount = Platform.subaccountFromNat(TRENCH_SUBACCOUNT_OFFSET + nextTrenchIntentId);
    let intent : TrenchIntent = {
      id = nextTrenchIntentId;
      subscriber = caller;
      routeMode;
      requestedAmountE8s;
      routedAmountE8s = 0;
      quotedAmountE8s = requestedAmountE8s + config.tokenFee;
      transferFeeE8s = config.tokenFee;
      subaccount = subaccount;
      account = {
        owner = selfPrincipal();
        subaccount = ?subaccount;
      };
      createdAt = now;
      expiresAt = now + Nat.toInt(config.invoiceTtlDays) * Platform.DAY_NS;
      paidAt = null;
      sweptAt = null;
      sweptTxIndex = null;
      balanceE8s = 0;
      status = #pending;
      currentStage = #intent_created;
      memo = memo;
      checkpoints = [
        trenchCheckpoint(#intent_created, defaultTrenchStageNote(#intent_created), caller, now, null),
      ];
    };

    nextTrenchIntentId += 1;
    trenchIntents := Platform.push(trenchIntents, intent);
    #ok(intent);
  };

  public shared ({ caller }) func refreshTrenchIntent(intentId : Nat) : async Result<TrenchIntent> {
    let intentIndex = switch (findTrenchIntentIndex(intentId)) {
      case (?index) { index };
      case null { return #err("Trench intent not found") };
    };

    let intent = trenchIntents[intentIndex];
    if (not requireUserOrAdmin(caller, intent.subscriber)) {
      return #err("Only the subscriber or an admin can refresh this trench intent");
    };

    await syncTrenchIntent(intentId);
  };

  public shared ({ caller }) func settleTrenchIntent(intentId : Nat) : async Result<TrenchSettlement> {
    let intentIndex = switch (findTrenchIntentIndex(intentId)) {
      case (?index) { index };
      case null { return #err("Trench intent not found") };
    };

    let intent = trenchIntents[intentIndex];
    if (not requireUserOrAdmin(caller, intent.subscriber)) {
      return #err("Only the subscriber or an admin can settle this trench intent");
    };

    let syncedIntent = switch (await syncTrenchIntent(intentId)) {
      case (#ok(value)) { value };
      case (#err(message)) { return #err(message) };
    };

    if (syncedIntent.status == #swept) {
      return #err("Trench intent has already been settled");
    };

    if (syncedIntent.status != #paid or syncedIntent.balanceE8s < syncedIntent.quotedAmountE8s) {
      return #err("Trench intent is not fully paid yet");
    };

    let treasuryPrincipal = switch (config.treasuryCanister) {
      case (?value) { value };
      case null { return #err("Treasury canister is not configured") };
    };

    let routedAmount = if (syncedIntent.balanceE8s > config.tokenFee) {
      Nat.sub(syncedIntent.balanceE8s, config.tokenFee);
    } else {
      return #err("Trench intent balance is too small to cover the transfer fee");
    };

    let ledger : Ledger.ICRC1 = actor (Principal.toText(config.ledgerId));
    let now = Time.now();

    try {
      let transferResult = await ledger.icrc1_transfer({
        from_subaccount = ?syncedIntent.subaccount;
        to = {
          owner = treasuryPrincipal;
          subaccount = null;
        };
        amount = routedAmount;
        fee = ?config.tokenFee;
        memo = null;
        created_at_time = null;
      });

      switch (transferResult) {
        case (#Err(error)) {
          return #err("Ledger transfer failed: " # debug_show (error));
        };
        case (#Ok(txIndex)) {
          var settledIntent = trenchIntentWithState(
            syncedIntent,
            syncedIntent.balanceE8s,
            now,
            ?routedAmount,
            ?now,
            ?txIndex,
            ?#swept,
          );
          settledIntent := appendTrenchCheckpoint(
            settledIntent,
            trenchCheckpoint(#icp_swept, defaultTrenchStageNote(#icp_swept), selfPrincipal(), now, ?txIndex),
          );
          replaceTrenchIntent(intentIndex, settledIntent);

          var treasuryRecorded = false;
          let treasury : TreasuryActor = actor (Principal.toText(treasuryPrincipal));
          try {
            switch (await treasury.recordRevenue({
              ledgerId = config.ledgerId;
              tokenSymbol = config.tokenSymbol;
              amountE8s = routedAmount;
              source = "trench_ingress";
              memo = "Trench intent #" # debug_show (settledIntent.id);
              txIndex = ?txIndex;
              fromCanister = ?selfPrincipal();
            })) {
              case (#ok(_)) { treasuryRecorded := true };
              case (#err(_)) {};
            };
          } catch (_) {};

          #ok({
            intent = settledIntent;
            treasuryTransferTxIndex = txIndex;
            treasuryRecorded;
          });
        };
      };
    } catch (error) {
      #err("Unable to settle trench intent: " # Error.message(error));
    };
  };

  public shared ({ caller }) func advanceTrenchIntent(intentId : Nat, stage : TrenchStage, note : Text, txIndex : ?Nat) : async Result<TrenchIntent> {
    let intentIndex = switch (findTrenchIntentIndex(intentId)) {
      case (?index) { index };
      case null { return #err("Trench intent not found") };
    };

    let intent = trenchIntents[intentIndex];
    if (not requireUserOrAdmin(caller, intent.subscriber)) {
      return #err("Only the subscriber or an admin can advance this trench intent");
    };

    if (trenchStageRank(stage) <= trenchStageRank(intent.currentStage)) {
      return #err("Choose a later trench stage");
    };

    if (trenchStageRank(stage) > trenchStageRank(#icp_swept) and intent.status != #swept) {
      return #err("Settle the trench intent before publishing later route stages");
    };

    let nextNote = if (Text.size(note) > 0) { note } else { defaultTrenchStageNote(stage) };
    let updated = appendTrenchCheckpoint(
      intent,
      trenchCheckpoint(stage, nextNote, caller, Time.now(), txIndex),
    );
    replaceTrenchIntent(intentIndex, updated);
    #ok(updated);
  };

  public shared ({ caller }) func refreshInvoice(invoiceId : Nat) : async Result<Invoice> {
    let invoiceIndex = switch (findInvoiceIndex(invoiceId)) {
      case (?index) { index };
      case null { return #err("Invoice not found") };
    };

    let invoice = invoices[invoiceIndex];
    if (not requireUserOrAdmin(caller, invoice.subscriber)) {
      return #err("Only the subscriber or an admin can refresh this invoice");
    };

    await syncInvoice(invoiceId);
  };

  public shared ({ caller }) func settleInvoice(invoiceId : Nat) : async Result<Settlement> {
    let invoiceIndex = switch (findInvoiceIndex(invoiceId)) {
      case (?index) { index };
      case null { return #err("Invoice not found") };
    };

    let invoice = invoices[invoiceIndex];
    if (not requireUserOrAdmin(caller, invoice.subscriber)) {
      return #err("Only the subscriber or an admin can settle this invoice");
    };

    let syncedInvoice = switch (await syncInvoice(invoiceId)) {
      case (#ok(value)) { value };
      case (#err(message)) { return #err(message) };
    };

    if (syncedInvoice.status == #swept) {
      return #err("Invoice has already been settled");
    };

    if (syncedInvoice.status != #paid or syncedInvoice.balanceE8s < syncedInvoice.quotedAmountE8s) {
      return #err("Invoice is not fully paid yet");
    };

    let treasuryPrincipal = switch (config.treasuryCanister) {
      case (?value) { value };
      case null { return #err("Treasury canister is not configured") };
    };

    let sweepAmount = if (syncedInvoice.balanceE8s > config.tokenFee) {
      Nat.sub(syncedInvoice.balanceE8s, config.tokenFee);
    } else {
      return #err("Invoice balance is too small to cover the transfer fee");
    };

    let plan = switch (Array.find<Plan>(plans, func(current) = current.id == syncedInvoice.planId)) {
      case (?value) { value };
      case null { return #err("Plan associated with invoice no longer exists") };
    };

    let ledger : Ledger.ICRC1 = actor (Principal.toText(config.ledgerId));
    let now = Time.now();

    try {
      let transferResult = await ledger.icrc1_transfer({
        from_subaccount = ?syncedInvoice.subaccount;
        to = {
          owner = treasuryPrincipal;
          subaccount = null;
        };
        amount = sweepAmount;
        fee = ?config.tokenFee;
        memo = null;
        created_at_time = null;
      });

      switch (transferResult) {
        case (#Err(error)) {
          return #err("Ledger transfer failed: " # debug_show (error));
        };
        case (#Ok(txIndex)) {
          let settledInvoice = invoiceWithState(syncedInvoice, syncedInvoice.balanceE8s, now, ?now, ?txIndex, ?#swept);
          replaceInvoice(invoiceIndex, settledInvoice);

          let subscription = renewSubscription(plan, settledInvoice.subscriber, settledInvoice.id, sweepAmount, now);

          var treasuryRecorded = false;
          var analyticsRecorded = false;

          let treasury : TreasuryActor = actor (Principal.toText(treasuryPrincipal));
          try {
            switch (await treasury.recordRevenue({
              ledgerId = config.ledgerId;
              tokenSymbol = config.tokenSymbol;
              amountE8s = sweepAmount;
              source = "subscription";
              memo = "Invoice #" # debug_show (settledInvoice.id) # " / " # plan.slug;
              txIndex = ?txIndex;
              fromCanister = ?selfPrincipal();
            })) {
              case (#ok(_)) { treasuryRecorded := true };
              case (#err(_)) {};
            };
          } catch (_) {};

          switch (config.analyticsCanister) {
            case (?analyticsId) {
              let analytics : AnalyticsActor = actor (Principal.toText(analyticsId));
              try {
                switch (await analytics.recordSubscriptionEvent({
                  subscriber = settledInvoice.subscriber;
                  planId = plan.id;
                  planSlug = plan.slug;
                  status = "active";
                  amountE8s = sweepAmount;
                  intervalDays = plan.intervalDays;
                  occurredAt = now;
                  sourceCanister = ?selfPrincipal();
                  metadata = "Invoice #" # debug_show (settledInvoice.id);
                })) {
                  case (#ok(_)) { analyticsRecorded := true };
                  case (#err(_)) {};
                };
              } catch (_) {};
            };
            case null {};
          };

          #ok({
            invoice = settledInvoice;
            subscription = subscription;
            treasuryTransferTxIndex = txIndex;
            treasuryRecorded;
            analyticsRecorded;
          });
        };
      };
    } catch (error) {
      #err("Unable to settle invoice: " # Error.message(error));
    };
  };

  public shared ({ caller }) func cancelMySubscription(planId : Nat) : async Result<Subscription> {
    let subscriptionIndex = switch (findSubscriptionIndex(caller, planId)) {
      case (?index) { index };
      case null { return #err("Subscription not found") };
    };

    let current = subscriptions[subscriptionIndex];
    let now = Time.now();
    let cancelled : Subscription = {
      id = current.id;
      planId = current.planId;
      subscriber = current.subscriber;
      startedAt = current.startedAt;
      renewedAt = current.renewedAt;
      expiresAt = current.expiresAt;
      lastInvoiceId = current.lastInvoiceId;
      totalPaidE8s = current.totalPaidE8s;
      status = #cancelled;
    };

    replaceSubscription(subscriptionIndex, cancelled);

    switch (config.analyticsCanister) {
      case (?analyticsId) {
        let plan = switch (Array.find<Plan>(plans, func(candidate) = candidate.id == planId)) {
          case (?value) { value };
          case null { return #ok(cancelled) };
        };
        let analytics : AnalyticsActor = actor (Principal.toText(analyticsId));
        ignore analytics.recordSubscriptionEvent({
          subscriber = caller;
          planId = plan.id;
          planSlug = plan.slug;
          status = "cancelled";
          amountE8s = plan.priceE8s;
          intervalDays = plan.intervalDays;
          occurredAt = now;
          sourceCanister = ?selfPrincipal();
          metadata = "Subscription cancelled by subscriber";
        });
      };
      case null {};
    };

    #ok(cancelled);
  };
};
