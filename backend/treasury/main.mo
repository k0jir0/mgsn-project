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

persistent actor Treasury {
  type Result<T> = {
    #ok : T;
    #err : Text;
  };

  public type Account = Ledger.Account;
  public type GovernanceConfig = Platform.GovernanceConfig;

  public type TokenConfig = {
    symbol : Text;
    ledgerId : Principal;
    decimals : Nat8;
    fee : Nat;
    enabled : Bool;
  };

  public type RevenuePolicy = {
    category : Text;
    targetBps : Nat;
    notes : Text;
  };

  public type RevenueEvent = {
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

  public type RevenueRecordRequest = {
    ledgerId : Principal;
    tokenSymbol : Text;
    amountE8s : Nat;
    source : Text;
    memo : Text;
    txIndex : ?Nat;
    fromCanister : ?Principal;
  };

  public type BalanceSnapshot = {
    ledgerId : Principal;
    tokenSymbol : Text;
    balanceE8s : Nat;
    capturedAt : Int;
  };

  public type Disbursement = {
    id : Nat;
    ledgerId : Principal;
    tokenSymbol : Text;
    to : Account;
    amountE8s : Nat;
    feeE8s : Nat;
    reason : Text;
    memoText : Text;
    executedAt : Int;
    executedBy : Principal;
    txIndex : Nat;
  };

  public type DisbursementRequest = {
    ledgerId : Principal;
    tokenSymbol : Text;
    to : Account;
    amountE8s : Nat;
    feeE8s : ?Nat;
    reason : Text;
    memo : ?Blob;
    memoText : Text;
  };

  public type GovernanceUpdate = {
    owner : ?Principal;
    snsRoot : ?Principal;
    snsGovernance : ?Principal;
  };

  public type AdminState = {
    owner : ?Principal;
    operators : [Principal];
    authorizedRevenueReporters : [Principal];
    analyticsCanister : ?Principal;
    governance : GovernanceConfig;
  };

  public type Overview = {
    admin : AdminState;
    account : Account;
    trackedTokens : [TokenConfig];
    revenuePolicies : [RevenuePolicy];
    recentRevenue : [RevenueEvent];
    recentDisbursements : [Disbursement];
    recentSnapshots : [BalanceSnapshot];
  };

  type AnalyticsRevenueInput = {
    category : Text;
    ledgerId : Principal;
    amountE8s : Nat;
    occurredAt : Int;
    sourceCanister : ?Principal;
    metadata : Text;
  };

  type AnalyticsActor = actor {
    recordRevenueEvent : shared AnalyticsRevenueInput -> async Result<AnalyticsRevenueInput>;
  };

  var owner : ?Principal = null;
  var operators : [Principal] = [];
  var authorizedRevenueReporters : [Principal] = [];
  var analyticsCanister : ?Principal = null;
  var governance : GovernanceConfig = {
    owner = null;
    snsRoot = null;
    snsGovernance = null;
    configuredAt = null;
  };
  var trackedTokens : [TokenConfig] = [
    {
      symbol = "ICP";
      ledgerId = Platform.icpLedger();
      decimals = 8;
      fee = 10_000;
      enabled = true;
    },
  ];
  var revenuePolicies : [RevenuePolicy] = [
    { category = "subscription"; targetBps = 6_000; notes = "Recurring product revenue retained for core treasury growth." },
    { category = "buyback"; targetBps = 2_000; notes = "Reserve route for market support and treasury-led buybacks." },
    { category = "operations"; targetBps = 2_000; notes = "Operational runway, audits, and DAO execution costs." },
  ];
  var revenueEvents : [RevenueEvent] = [];
  var disbursements : [Disbursement] = [];
  var balanceSnapshots : [BalanceSnapshot] = [];
  var nextRevenueId : Nat = 1;
  var nextDisbursementId : Nat = 1;

  func selfPrincipal() : Principal {
    Principal.fromActor(Treasury);
  };

  func selfAccount() : Account {
    {
      owner = selfPrincipal();
      subaccount = null;
    };
  };

  func isAdmin(caller : Principal) : Bool {
    Platform.isAdmin(owner, operators, caller);
  };

  func canRecordRevenue(caller : Principal) : Bool {
    isAdmin(caller) or Platform.containsPrincipal(authorizedRevenueReporters, caller);
  };

  func findTokenConfig(ledgerId : Principal) : ?TokenConfig {
    Array.find<TokenConfig>(trackedTokens, func(token) = Principal.equal(token.ledgerId, ledgerId));
  };

  func transferErrorText(error : Ledger.TransferError) : Text {
    switch (error) {
      case (#BadFee(details)) { "Ledger rejected transfer fee. Expected " # debug_show (details.expected_fee) };
      case (#BadBurn(details)) { "Bad burn amount. Minimum is " # debug_show (details.min_burn_amount) };
      case (#InsufficientFunds(details)) { "Insufficient funds. Balance is " # debug_show (details.balance) };
      case (#TooOld) { "Ledger transfer request is too old" };
      case (#CreatedInFuture(_)) { "Ledger rejected a future-dated transfer" };
      case (#TemporarilyUnavailable) { "Ledger is temporarily unavailable" };
      case (#Duplicate(details)) { "Duplicate transfer. Existing block index: " # debug_show (details.duplicate_of) };
      case (#GenericError(details)) { "Ledger error " # debug_show (details.error_code) # ": " # details.message };
    };
  };

  func defaultTokenConfig(ledgerId : Principal, tokenSymbol : Text) : TokenConfig {
    {
      symbol = tokenSymbol;
      ledgerId;
      decimals = 8;
      fee = 10_000;
      enabled = true;
    };
  };

  func appendBalanceSnapshot(snapshot : BalanceSnapshot) {
    balanceSnapshots := Platform.push(balanceSnapshots, snapshot);
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
      return #err("Only an admin can transfer treasury ownership");
    };

    owner := ?nextOwner;
    #ok(nextOwner);
  };

  public shared ({ caller }) func addOperator(nextOperator : Principal) : async Result<[Principal]> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can add treasury operators");
    };

    if (Platform.containsPrincipal(operators, nextOperator)) {
      return #ok(operators);
    };

    operators := Platform.push(operators, nextOperator);
    #ok(operators);
  };

  public shared ({ caller }) func removeOperator(target : Principal) : async Result<[Principal]> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can remove treasury operators");
    };

    operators := Platform.removePrincipal(operators, target);
    #ok(operators);
  };

  public shared ({ caller }) func authorizeRevenueReporter(target : Principal, enabled : Bool) : async Result<[Principal]> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can manage revenue reporters");
    };

    if (enabled) {
      if (not Platform.containsPrincipal(authorizedRevenueReporters, target)) {
        authorizedRevenueReporters := Platform.push(authorizedRevenueReporters, target);
      };
    } else {
      authorizedRevenueReporters := Platform.removePrincipal(authorizedRevenueReporters, target);
    };

    #ok(authorizedRevenueReporters);
  };

  public shared ({ caller }) func configureGovernance(update : GovernanceUpdate) : async Result<GovernanceConfig> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can update governance wiring");
    };

    governance := {
      owner = update.owner;
      snsRoot = update.snsRoot;
      snsGovernance = update.snsGovernance;
      configuredAt = ?Time.now();
    };

    #ok(governance);
  };

  public shared ({ caller }) func setAnalyticsCanister(nextAnalytics : ?Principal) : async Result<?Principal> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can set analytics wiring");
    };

    analyticsCanister := nextAnalytics;
    #ok(analyticsCanister);
  };

  public shared ({ caller }) func upsertTrackedToken(token : TokenConfig) : async Result<[TokenConfig]> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can manage tracked tokens");
    };

    let tokenIndex = Array.findIndex<TokenConfig>(trackedTokens, func(current) = Principal.equal(current.ledgerId, token.ledgerId));

    switch (tokenIndex) {
      case (?index) {
        trackedTokens := Platform.replaceAt(trackedTokens, index, token);
      };
      case null {
        trackedTokens := Platform.push(trackedTokens, token);
      };
    };

    #ok(trackedTokens);
  };

  public shared ({ caller }) func setRevenuePolicies(nextPolicies : [RevenuePolicy]) : async Result<[RevenuePolicy]> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can update revenue policies");
    };

    revenuePolicies := nextPolicies;
    #ok(revenuePolicies);
  };

  public query func getOverview() : async Overview {
    {
      admin = {
        owner;
        operators;
        authorizedRevenueReporters;
        analyticsCanister;
        governance;
      };
      account = selfAccount();
      trackedTokens;
      revenuePolicies;
      recentRevenue = Platform.takeLast(revenueEvents, 20);
      recentDisbursements = Platform.takeLast(disbursements, 20);
      recentSnapshots = Platform.takeLast(balanceSnapshots, 20);
    };
  };

  public query func getAccount() : async Account {
    selfAccount();
  };

  public query func listRevenueEvents(limit : Nat) : async [RevenueEvent] {
    Platform.takeLast(revenueEvents, limit);
  };

  public query func listDisbursements(limit : Nat) : async [Disbursement] {
    Platform.takeLast(disbursements, limit);
  };

  public query func listBalanceSnapshots(limit : Nat) : async [BalanceSnapshot] {
    Platform.takeLast(balanceSnapshots, limit);
  };

  public shared ({ caller }) func snapshotBalance(ledgerId : Principal) : async Result<BalanceSnapshot> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can snapshot treasury balances");
    };

    let ledger : Ledger.ICRC1 = actor (Principal.toText(ledgerId));
    let token = switch (findTokenConfig(ledgerId)) {
      case (?existing) { existing };
      case null { defaultTokenConfig(ledgerId, if (Principal.equal(ledgerId, Platform.icpLedger())) { "ICP" } else { Principal.toText(ledgerId) }) };
    };

    try {
      let balance = await ledger.icrc1_balance_of(selfAccount());
      let snapshot : BalanceSnapshot = {
        ledgerId;
        tokenSymbol = token.symbol;
        balanceE8s = balance;
        capturedAt = Time.now();
      };

      appendBalanceSnapshot(snapshot);
      #ok(snapshot);
    } catch (error) {
      #err("Unable to read ledger balance: " # Error.message(error));
    };
  };

  public shared ({ caller }) func recordRevenue(request : RevenueRecordRequest) : async Result<RevenueEvent> {
    if (not canRecordRevenue(caller)) {
      return #err("Caller is not authorized to record revenue");
    };

    let event : RevenueEvent = {
      id = nextRevenueId;
      ledgerId = request.ledgerId;
      tokenSymbol = request.tokenSymbol;
      amountE8s = request.amountE8s;
      source = request.source;
      memo = request.memo;
      recordedBy = caller;
      recordedAt = Time.now();
      txIndex = request.txIndex;
      fromCanister = request.fromCanister;
    };

    nextRevenueId += 1;
    revenueEvents := Platform.push(revenueEvents, event);

    switch (analyticsCanister) {
      case (?analyticsId) {
        let analytics : AnalyticsActor = actor (Principal.toText(analyticsId));
        try {
          ignore await analytics.recordRevenueEvent({
            category = event.source;
            ledgerId = event.ledgerId;
            amountE8s = event.amountE8s;
            occurredAt = event.recordedAt;
            sourceCanister = event.fromCanister;
            metadata = event.memo;
          });
        } catch (_) {};
      };
      case null {};
    };

    #ok(event);
  };

  public shared ({ caller }) func disburse(request : DisbursementRequest) : async Result<Disbursement> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can disburse treasury funds");
    };

    let token = switch (findTokenConfig(request.ledgerId)) {
      case (?existing) { existing };
      case null { return #err("Tracked token not configured for this ledger") };
    };

    if (not token.enabled) {
      return #err("Token is disabled for treasury disbursements");
    };

    let fee = switch (request.feeE8s) {
      case (?value) { value };
      case null { token.fee };
    };

    let ledger : Ledger.ICRC1 = actor (Principal.toText(request.ledgerId));

    try {
      let transferResult = await ledger.icrc1_transfer({
        from_subaccount = null;
        to = request.to;
        amount = request.amountE8s;
        fee = ?fee;
        memo = request.memo;
        created_at_time = null;
      });

      switch (transferResult) {
        case (#Ok(txIndex)) {
          let disbursement : Disbursement = {
            id = nextDisbursementId;
            ledgerId = request.ledgerId;
            tokenSymbol = request.tokenSymbol;
            to = request.to;
            amountE8s = request.amountE8s;
            feeE8s = fee;
            reason = request.reason;
            memoText = request.memoText;
            executedAt = Time.now();
            executedBy = caller;
            txIndex;
          };

          nextDisbursementId += 1;
          disbursements := Platform.push(disbursements, disbursement);
          #ok(disbursement);
        };
        case (#Err(transferError)) {
          #err(transferErrorText(transferError));
        };
      };
    } catch (error) {
      #err("Treasury disbursement failed: " # Error.message(error));
    };
  };
};