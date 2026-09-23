import type { Schema } from "@fastnear/borsh"

export const nearChainSchema = new (class BorshSchema {
  Ed25519Signature: Schema = {
    struct: {
      data: { array: { type: "u8", len: 64 } },
    },
  };
  Secp256k1Signature: Schema = {
    struct: {
      data: { array: { type: "u8", len: 65 } },
    },
  };
  MlDsa65Signature: Schema = {
    struct: {
      data: { array: { type: "u8", len: 3309 } },
    },
  };
  Signature: Schema = {
    enum: [
      { struct: { ed25519Signature: this.Ed25519Signature } },
      { struct: { secp256k1Signature: this.Secp256k1Signature } },
      { struct: { mlDsa65Signature: this.MlDsa65Signature } },
    ],
  };
  Ed25519Data: Schema = {
    struct: {
      data: { array: { type: "u8", len: 32 } },
    },
  };
  Secp256k1Data: Schema = {
    struct: {
      data: { array: { type: "u8", len: 64 } },
    },
  };
  MlDsa65Data: Schema = {
    struct: {
      data: { array: { type: "u8", len: 1952 } },
    },
  };
  PublicKey: Schema = {
    enum: [
      { struct: { ed25519Key: this.Ed25519Data } },
      { struct: { secp256k1Key: this.Secp256k1Data } },
      { struct: { mlDsa65Key: this.MlDsa65Data } },
    ],
  };
  FunctionCallPermission: Schema = {
    struct: {
      allowance: { option: "u128" },
      receiverId: "string",
      methodNames: { array: { type: "string" } },
    },
  };
  FullAccessPermission: Schema = {
    struct: {},
  };
  // Gas keys (protocol 85+): a prepaid balance that pays gas, and `numNonces`
  // independent nonce lanes. `balance` is u128 yoctoNEAR, `numNonces` is u16.
  GasKeyInfo: Schema = {
    struct: {
      balance: "u128",
      numNonces: "u16",
    },
  };
  // nearcore: `GasKeyFunctionCall(GasKeyInfo, FunctionCallPermission)` — a tuple
  // variant. A two-field struct in the same order encodes the identical bytes.
  GasKeyFunctionCallPermission: Schema = {
    struct: {
      gasKeyInfo: this.GasKeyInfo,
      functionCall: this.FunctionCallPermission,
    },
  };
  AccessKeyPermission: Schema = {
    enum: [
      { struct: { functionCall: this.FunctionCallPermission } },             // 0
      { struct: { fullAccess: this.FullAccessPermission } },                 // 1
      { struct: { gasKeyFunctionCall: this.GasKeyFunctionCallPermission } }, // 2
      { struct: { gasKeyFullAccess: this.GasKeyInfo } },                     // 3
    ],
  };
  AccessKey: Schema = {
    struct: {
      nonce: "u64",
      permission: this.AccessKeyPermission,
    },
  };
  CreateAccount: Schema = {
    struct: {},
  };
  DeployContract: Schema = {
    struct: {
      code: { array: { type: "u8" } },
    },
  };
  FunctionCall: Schema = {
    struct: {
      methodName: "string",
      args: { array: { type: "u8" } },
      gas: "u64",
      deposit: "u128",
    },
  };
  Transfer: Schema = {
    struct: {
      deposit: "u128",
    },
  };
  Stake: Schema = {
    struct: {
      stake: "u128",
      publicKey: this.PublicKey,
    },
  };
  AddKey: Schema = {
    struct: {
      publicKey: this.PublicKey,
      accessKey: this.AccessKey,
    },
  };
  DeleteKey: Schema = {
    struct: {
      publicKey: this.PublicKey,
    },
  };
  DeleteAccount: Schema = {
    struct: {
      beneficiaryId: "string",
    },
  };
  // Fund a gas key's balance (Action discriminant 12). Any account may send it.
  TransferToGasKey: Schema = {
    struct: {
      publicKey: this.PublicKey,
      deposit: "u128",
    },
  };
  // Move balance from a gas key back to its account (Action discriminant 13).
  // Signer must be the owning account; not allowed inside a delegate action.
  WithdrawFromGasKey: Schema = {
    struct: {
      publicKey: this.PublicKey,
      amount: "u128",
    },
  };
  // Actions a NEP-366 DelegateAction may carry (nearcore `NonDelegateAction`,
  // which shares `Action`'s discriminants). Discriminants 9-11 (global-contract
  // and state-init actions) are not modelled, so the gas-key entries pin their
  // wire tags explicitly. Tag 13 is kept here so a delegate carrying it decodes
  // to a clear "not delegatable" error upstream rather than a codec error; the
  // chain itself rejects WithdrawFromGasKey inside delegates from protocol 87.
  ClassicAction: Schema = {
    enum: [
      { struct: { createAccount: this.CreateAccount } },             // 0
      { struct: { deployContract: this.DeployContract } },           // 1
      { struct: { functionCall: this.FunctionCall } },               // 2
      { struct: { transfer: this.Transfer } },                       // 3
      { struct: { stake: this.Stake } },                             // 4
      { struct: { addKey: this.AddKey } },                           // 5
      { struct: { deleteKey: this.DeleteKey } },                     // 6
      { struct: { deleteAccount: this.DeleteAccount } },             // 7
      { tag: 12, struct: { transferToGasKey: this.TransferToGasKey } },
      { tag: 13, struct: { withdrawFromGasKey: this.WithdrawFromGasKey } },
    ],
  };
  DelegateAction: Schema = {
    struct: {
      senderId: "string",
      receiverId: "string",
      actions: { array: { type: this.ClassicAction } },
      nonce: "u64",
      maxBlockHeight: "u64",
      publicKey: this.PublicKey,
    },
  };
  SignedDelegate: Schema = {
    struct: {
      delegateAction: this.DelegateAction,
      signature: this.Signature,
    },
  };
  Action: Schema = {
    enum: [
      { struct: { createAccount: this.CreateAccount } },             // 0
      { struct: { deployContract: this.DeployContract } },           // 1
      { struct: { functionCall: this.FunctionCall } },               // 2
      { struct: { transfer: this.Transfer } },                       // 3
      { struct: { stake: this.Stake } },                             // 4
      { struct: { addKey: this.AddKey } },                           // 5
      { struct: { deleteKey: this.DeleteKey } },                     // 6
      { struct: { deleteAccount: this.DeleteAccount } },             // 7
      { struct: { signedDelegate: this.SignedDelegate } },           // 8
      // 9-11 (DeployGlobalContract, UseGlobalContract, DeterministicStateInit) not modelled.
      { tag: 12, struct: { transferToGasKey: this.TransferToGasKey } },
      { tag: 13, struct: { withdrawFromGasKey: this.WithdrawFromGasKey } },
    ],
  };
  Transaction: Schema = {
    struct: {
      signerId: "string",
      publicKey: this.PublicKey,
      nonce: "u64",
      receiverId: "string",
      blockHash: { array: { type: "u8", len: 32 } },
      actions: { array: { type: this.Action } },
    },
  };
  SignedTransaction: Schema = {
    struct: {
      transaction: this.Transaction,
      signature: this.Signature,
    },
  };
  // ── TransactionV1 (protocol 85+; required to sign with a gas key) ──────────
  // nearcore `TransactionNonce`: 0 = Nonce { nonce }, 1 = GasKeyNonce { nonce, nonce_index }.
  TransactionNonce: Schema = {
    enum: [
      { struct: { nonce: { struct: { nonce: "u64" } } } },
      { struct: { gasKeyNonce: { struct: { nonce: "u64", nonceIndex: "u16" } } } },
    ],
  };
  // nearcore `NonceMode`: 0 = Monotonic (nonce > current), 1 = Strict (nonce == current + 1).
  NonceMode: Schema = {
    enum: [
      { struct: { monotonic: { struct: {} } } },
      { struct: { strict: { struct: {} } } },
    ],
  };
  // Wire format: `Transaction::V1` is a single 0x01 byte followed by the V1 body
  // (V0 has no prefix). The prefix is modelled as a leading `version` field so
  // plain borsh reproduces the exact bytes that are hashed and signed. Encoders
  // must set `version: 1`.
  TransactionV1: Schema = {
    struct: {
      version: "u8",
      signerId: "string",
      publicKey: this.PublicKey,
      nonce: this.TransactionNonce,
      receiverId: "string",
      blockHash: { array: { type: "u8", len: 32 } },
      actions: { array: { type: this.Action } },
      nonceMode: this.NonceMode,
    },
  };
  SignedTransactionV1: Schema = {
    struct: {
      transaction: this.TransactionV1,
      signature: this.Signature,
    },
  };
})();

export const getBorshSchema = () => nearChainSchema;
