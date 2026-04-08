import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Time "mo:core/Time";

import Platform "../shared/Platform";

persistent actor Analytics {
  type Result<T> = {
    #ok : T;
    #err : Text;
  };

  public type RevenueEvent = {
    id : Nat;
    category : Text;
    ledgerId : Principal;
    amountE8s : Nat;
    occurredAt : Int;
    sourceCanister : ?Principal;
    metadata : Text;
  };

  public type RevenueEventInput = {
    category : Text;
    ledgerId : Principal;
    amountE8s : Nat;
    occurredAt : Int;
    sourceCanister : ?Principal;
    metadata : Text;
  };

  public type SubscriptionEvent = {
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

  public type SubscriptionEventInput = {
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

  public type SubscriptionState = {
    subscriber : Principal;
    planId : Nat;
    planSlug : Text;
    status : Text;
    amountE8s : Nat;
    intervalDays : Nat;
    updatedAt : Int;
  };

  public type AdminState = {
    owner : ?Principal;
    operators : [Principal];
    authorizedReporters : [Principal];
  };

  public type Dashboard = {
    admin : AdminState;
    totalRevenueE8s : Nat;
    trailing30dRevenueE8s : Nat;
    monthlyRecurringRevenueE8s : Nat;
    annualRecurringRevenueE8s : Nat;
    activeSubscriptions : Nat;
    payingSubscribers : Nat;
    recentRevenue : [RevenueEvent];
    recentSubscriptionEvents : [SubscriptionEvent];
    activeStates : [SubscriptionState];
  };

  var owner : ?Principal = null;
  var operators : [Principal] = [];
  var authorizedReporters : [Principal] = [];
  var revenueEvents : [RevenueEvent] = [];
  var subscriptionEvents : [SubscriptionEvent] = [];
  var subscriptionStates : [SubscriptionState] = [];
  var nextRevenueId : Nat = 1;
  var nextSubscriptionEventId : Nat = 1;

  func isAdmin(caller : Principal) : Bool {
    Platform.isAdmin(owner, operators, caller);
  };

  func canReport(caller : Principal) : Bool {
    isAdmin(caller) or Platform.containsPrincipal(authorizedReporters, caller);
  };

  func activeStateCount() : Nat {
    Array.filter(subscriptionStates, func(state) = Text.equal(state.status, "active")).size();
  };

  func payingSubscriberCount() : Nat {
    var unique : [Principal] = [];

    for (state in subscriptionStates.vals()) {
      if (Text.equal(state.status, "active") and not Platform.containsPrincipal(unique, state.subscriber)) {
        unique := Platform.push(unique, state.subscriber);
      };
    };

    unique.size();
  };

  func monthlyRunRate() : Nat {
    var total : Nat = 0;

    for (state in subscriptionStates.vals()) {
      if (Text.equal(state.status, "active") and state.intervalDays > 0) {
        total += state.amountE8s * 30 / state.intervalDays;
      };
    };

    total;
  };

  func totalRevenue() : Nat {
    var total : Nat = 0;

    for (event in revenueEvents.vals()) {
      total += event.amountE8s;
    };

    total;
  };

  func trailingRevenue(days : Nat) : Nat {
    let threshold = Platform.trailingWindowThreshold(days, Time.now());
    var total : Nat = 0;

    for (event in revenueEvents.vals()) {
      if (event.occurredAt >= threshold) {
        total += event.amountE8s;
      };
    };

    total;
  };

  func upsertSubscriptionState(event : SubscriptionEvent) {
    let nextState : SubscriptionState = {
      subscriber = event.subscriber;
      planId = event.planId;
      planSlug = event.planSlug;
      status = event.status;
      amountE8s = event.amountE8s;
      intervalDays = event.intervalDays;
      updatedAt = event.occurredAt;
    };

    let stateIndex = Array.findIndex<SubscriptionState>(
      subscriptionStates,
      func(state) = Principal.equal(state.subscriber, event.subscriber) and state.planId == event.planId,
    );

    switch (stateIndex) {
      case (?index) {
        subscriptionStates := Platform.replaceAt(subscriptionStates, index, nextState);
      };
      case null {
        subscriptionStates := Platform.push(subscriptionStates, nextState);
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
      return #err("Only an admin can transfer ownership");
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

  public shared ({ caller }) func authorizeReporter(target : Principal, enabled : Bool) : async Result<[Principal]> {
    if (not isAdmin(caller)) {
      return #err("Only an admin can manage reporters");
    };

    if (enabled) {
      if (not Platform.containsPrincipal(authorizedReporters, target)) {
        authorizedReporters := Platform.push(authorizedReporters, target);
      };
    } else {
      authorizedReporters := Platform.removePrincipal(authorizedReporters, target);
    };

    #ok(authorizedReporters);
  };

  public query func getAdminState() : async AdminState {
    {
      owner;
      operators;
      authorizedReporters;
    };
  };

  public shared ({ caller }) func recordRevenueEvent(input : RevenueEventInput) : async Result<RevenueEvent> {
    if (not canReport(caller)) {
      return #err("Caller is not authorized to report analytics events");
    };

    let event : RevenueEvent = {
      id = nextRevenueId;
      category = input.category;
      ledgerId = input.ledgerId;
      amountE8s = input.amountE8s;
      occurredAt = input.occurredAt;
      sourceCanister = input.sourceCanister;
      metadata = input.metadata;
    };

    nextRevenueId += 1;
    revenueEvents := Platform.push(revenueEvents, event);

    #ok(event);
  };

  public shared ({ caller }) func recordSubscriptionEvent(input : SubscriptionEventInput) : async Result<SubscriptionEvent> {
    if (not canReport(caller)) {
      return #err("Caller is not authorized to report analytics events");
    };

    let event : SubscriptionEvent = {
      id = nextSubscriptionEventId;
      subscriber = input.subscriber;
      planId = input.planId;
      planSlug = input.planSlug;
      status = input.status;
      amountE8s = input.amountE8s;
      intervalDays = input.intervalDays;
      occurredAt = input.occurredAt;
      sourceCanister = input.sourceCanister;
      metadata = input.metadata;
    };

    nextSubscriptionEventId += 1;
    subscriptionEvents := Platform.push(subscriptionEvents, event);
    upsertSubscriptionState(event);

    #ok(event);
  };

  public query func listRevenueEvents(limit : Nat) : async [RevenueEvent] {
    Platform.takeLast(revenueEvents, limit);
  };

  public query func listSubscriptionEvents(limit : Nat) : async [SubscriptionEvent] {
    Platform.takeLast(subscriptionEvents, limit);
  };

  public query func listSubscriptionStates() : async [SubscriptionState] {
    subscriptionStates;
  };

  public query func getDashboard() : async Dashboard {
    let mrr = monthlyRunRate();

    {
      admin = {
        owner;
        operators;
        authorizedReporters;
      };
      totalRevenueE8s = totalRevenue();
      trailing30dRevenueE8s = trailingRevenue(30);
      monthlyRecurringRevenueE8s = mrr;
      annualRecurringRevenueE8s = mrr * 12;
      activeSubscriptions = activeStateCount();
      payingSubscribers = payingSubscriberCount();
      recentRevenue = Platform.takeLast(revenueEvents, 12);
      recentSubscriptionEvents = Platform.takeLast(subscriptionEvents, 12);
      activeStates = Array.filter(subscriptionStates, func(state) = Text.equal(state.status, "active"));
    };
  };
};