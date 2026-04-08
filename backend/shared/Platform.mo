import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Principal "mo:core/Principal";
import Text "mo:core/Text";

module {
  public type GovernanceConfig = {
    owner : ?Principal.Principal;
    snsRoot : ?Principal.Principal;
    snsGovernance : ?Principal.Principal;
    configuredAt : ?Int;
  };

  public let DAY_NS : Int = 86_400_000_000_000;
  public let ICP_LEDGER_TEXT : Text = "ryjl3-tyaaa-aaaaa-aaaba-cai";

  public func icpLedger() : Principal.Principal {
    Principal.fromText(ICP_LEDGER_TEXT);
  };

  public func containsPrincipal(items : [Principal.Principal], value : Principal.Principal) : Bool {
    Array.find(items, func(item) = Principal.equal(item, value)) != null;
  };

  public func removePrincipal(items : [Principal.Principal], value : Principal.Principal) : [Principal.Principal] {
    Array.filter(items, func(item) = not Principal.equal(item, value));
  };

  public func containsText(items : [Text], value : Text) : Bool {
    Array.find(items, func(item) = Text.equal(item, value)) != null;
  };

  public func isAdmin(owner : ?Principal.Principal, operators : [Principal.Principal], caller : Principal.Principal) : Bool {
    switch (owner) {
      case (?currentOwner) {
        Principal.equal(currentOwner, caller) or containsPrincipal(operators, caller);
      };
      case null { false };
    };
  };

  public func push<T>(items : [T], item : T) : [T] {
    Array.concat(items, [item]);
  };

  public func replaceAt<T>(items : [T], index : Nat, nextItem : T) : [T] {
    Array.tabulate<T>(
      items.size(),
      func(currentIndex) {
        if (currentIndex == index) {
          nextItem;
        } else {
          items[currentIndex];
        };
      },
    );
  };

  public func takeLast<T>(items : [T], count : Nat) : [T] {
    let size = items.size();

    if (count >= size) {
      items;
    } else {
      let start = Int.abs(Nat.toInt(size) - Nat.toInt(count));
      Array.tabulate<T>(count, func(index) = items[start + index]);
    };
  };

  public func subaccountFromNat(seed : Nat) : Blob {
    let bytes = Array.toVarArray(Array.repeat<Nat8>(0, 32));
    var remainder = seed;
    var index = 32;

    while (index > 0 and remainder > 0) {
      index -= 1;
      bytes[index] := Nat8.fromNat(remainder % 256);
      remainder /= 256;
    };

    Blob.fromArray(Array.fromVarArray(bytes));
  };

  public func trailingWindowThreshold(days : Nat, now : Int) : Int {
    now - Nat.toInt(days) * DAY_NS;
  };
};