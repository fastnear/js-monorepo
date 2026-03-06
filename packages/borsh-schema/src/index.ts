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
  Signature: Schema = {
    enum: [
      { struct: { ed25519Signature: this.Ed25519Signature } },
      { struct: { secp256k1Signature: this.Secp256k1Signature } },
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
  PublicKey: Schema = {
    enum: [
      { struct: { ed25519Key: this.Ed25519Data } },
      { struct: { secp256k1Key: this.Secp256k1Data } },
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
  AccessKeyPermission: Schema = {
    enum: [
      { struct: { functionCall: this.FunctionCallPermission } },
      { struct: { fullAccess: this.FullAccessPermission } },
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
  ClassicAction: Schema = {
    enum: [
      { struct: { createAccount: this.CreateAccount } },
      { struct: { deployContract: this.DeployContract } },
      { struct: { functionCall: this.FunctionCall } },
      { struct: { transfer: this.Transfer } },
      { struct: { stake: this.Stake } },
      { struct: { addKey: this.AddKey } },
      { struct: { deleteKey: this.DeleteKey } },
      { struct: { deleteAccount: this.DeleteAccount } },
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
      { struct: { createAccount: this.CreateAccount } },
      { struct: { deployContract: this.DeployContract } },
      { struct: { functionCall: this.FunctionCall } },
      { struct: { transfer: this.Transfer } },
      { struct: { stake: this.Stake } },
      { struct: { addKey: this.AddKey } },
      { struct: { deleteKey: this.DeleteKey } },
      { struct: { deleteAccount: this.DeleteAccount } },
      { struct: { signedDelegate: this.SignedDelegate } },
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
})();

export const getBorshSchema = () => nearChainSchema;
