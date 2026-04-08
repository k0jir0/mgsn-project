import Blob "mo:core/Blob";
import Nat8 "mo:core/Nat8";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Text "mo:core/Text";

module {
  public type Subaccount = Blob;

  public type Account = {
    owner : Principal.Principal;
    subaccount : ?Subaccount;
  };

  public type TransferArgs = {
    from_subaccount : ?Subaccount;
    to : Account;
    amount : Nat;
    fee : ?Nat;
    memo : ?Blob;
    created_at_time : ?Nat64;
  };

  public type TransferError = {
    #BadFee : { expected_fee : Nat };
    #BadBurn : { min_burn_amount : Nat };
    #InsufficientFunds : { balance : Nat };
    #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #TemporarilyUnavailable;
    #Duplicate : { duplicate_of : Nat };
    #GenericError : { error_code : Nat; message : Text };
  };

  public type TransferResult = {
    #Ok : Nat;
    #Err : TransferError;
  };

  public type ICRC1 = actor {
    icrc1_balance_of : shared Account -> async Nat;
    icrc1_transfer : shared TransferArgs -> async TransferResult;
    icrc1_fee : shared () -> async Nat;
    icrc1_decimals : shared () -> async Nat8;
    icrc1_symbol : shared () -> async Text;
  };
};