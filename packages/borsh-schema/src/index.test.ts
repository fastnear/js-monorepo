import { describe, it, expect } from "vitest";
import { serialize, deserialize } from "@fastnear/borsh";
import type { Schema } from "@fastnear/borsh";
import { nearChainSchema, getBorshSchema } from "./index.js";

// ── Schema structure ─────────────────────────────────────────────────

describe("schema structure", () => {
  it("getBorshSchema returns nearChainSchema", () => {
    expect(getBorshSchema()).toBe(nearChainSchema);
  });

  const expectedSchemas = [
    "Ed25519Signature",
    "Secp256k1Signature",
    "Signature",
    "Ed25519Data",
    "Secp256k1Data",
    "PublicKey",
    "FunctionCallPermission",
    "FullAccessPermission",
    "AccessKeyPermission",
    "AccessKey",
    "CreateAccount",
    "DeployContract",
    "FunctionCall",
    "Transfer",
    "Stake",
    "AddKey",
    "DeleteKey",
    "DeleteAccount",
    "ClassicAction",
    "DelegateAction",
    "SignedDelegate",
    "Action",
    "Transaction",
    "SignedTransaction",
  ];

  it("has all 24 expected schemas", () => {
    for (const name of expectedSchemas) {
      expect(nearChainSchema).toHaveProperty(name);
    }
  });

  it("Ed25519Signature has 64-byte fixed array", () => {
    const s = nearChainSchema.Ed25519Signature as any;
    expect(s.struct.data.array.len).toBe(64);
    expect(s.struct.data.array.type).toBe("u8");
  });

  it("Secp256k1Signature has 65-byte fixed array", () => {
    const s = nearChainSchema.Secp256k1Signature as any;
    expect(s.struct.data.array.len).toBe(65);
    expect(s.struct.data.array.type).toBe("u8");
  });

  it("Ed25519Data has 32-byte fixed array", () => {
    const s = nearChainSchema.Ed25519Data as any;
    expect(s.struct.data.array.len).toBe(32);
  });

  it("Secp256k1Data has 64-byte fixed array", () => {
    const s = nearChainSchema.Secp256k1Data as any;
    expect(s.struct.data.array.len).toBe(64);
  });

  it("Signature enum has 2 variants (ed25519, secp256k1)", () => {
    const s = nearChainSchema.Signature as any;
    expect(s.enum).toHaveLength(2);
  });

  it("PublicKey enum has 2 variants (ed25519, secp256k1)", () => {
    const s = nearChainSchema.PublicKey as any;
    expect(s.enum).toHaveLength(2);
  });

  it("ClassicAction enum has 8 variants", () => {
    const s = nearChainSchema.ClassicAction as any;
    expect(s.enum).toHaveLength(8);
  });

  it("Action enum has 9 variants (classic 8 + signedDelegate)", () => {
    const s = nearChainSchema.Action as any;
    expect(s.enum).toHaveLength(9);
  });

  it("AccessKeyPermission enum has 2 variants", () => {
    const s = nearChainSchema.AccessKeyPermission as any;
    expect(s.enum).toHaveLength(2);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

const zeroBytes = (n: number) => new Array(n).fill(0);

function roundtrip(schema: Schema, value: unknown) {
  const encoded = serialize(schema, value);
  const decoded = deserialize(schema, encoded);
  return decoded;
}

// ── PublicKey serialization ──────────────────────────────────────────

describe("PublicKey serialization", () => {
  it("Ed25519 public key round-trips (enum index 0, 32 bytes)", () => {
    const pk = { ed25519Key: { data: zeroBytes(32) } };
    const result = roundtrip(nearChainSchema.PublicKey, pk);
    expect(result).toEqual(pk);
  });

  it("Ed25519 public key wire format starts with 0x00", () => {
    const pk = { ed25519Key: { data: zeroBytes(32) } };
    const encoded = serialize(nearChainSchema.PublicKey, pk);
    expect(encoded[0]).toBe(0); // enum index 0
    expect(encoded.length).toBe(1 + 32);
  });

  it("Secp256k1 public key round-trips (enum index 1, 64 bytes)", () => {
    const pk = { secp256k1Key: { data: zeroBytes(64) } };
    const result = roundtrip(nearChainSchema.PublicKey, pk);
    expect(result).toEqual(pk);
  });

  it("Secp256k1 public key wire format starts with 0x01", () => {
    const pk = { secp256k1Key: { data: zeroBytes(64) } };
    const encoded = serialize(nearChainSchema.PublicKey, pk);
    expect(encoded[0]).toBe(1); // enum index 1
    expect(encoded.length).toBe(1 + 64);
  });
});

// ── Signature serialization ──────────────────────────────────────────

describe("Signature serialization", () => {
  it("Ed25519 signature round-trips (64 bytes)", () => {
    const sig = { ed25519Signature: { data: zeroBytes(64) } };
    const result = roundtrip(nearChainSchema.Signature, sig);
    expect(result).toEqual(sig);
  });

  it("Ed25519 signature wire length = 1 + 64", () => {
    const sig = { ed25519Signature: { data: zeroBytes(64) } };
    const encoded = serialize(nearChainSchema.Signature, sig);
    expect(encoded.length).toBe(65);
  });

  it("Secp256k1 signature round-trips (65 bytes)", () => {
    const sig = { secp256k1Signature: { data: zeroBytes(65) } };
    const result = roundtrip(nearChainSchema.Signature, sig);
    expect(result).toEqual(sig);
  });

  it("Secp256k1 signature wire length = 1 + 65", () => {
    const sig = { secp256k1Signature: { data: zeroBytes(65) } };
    const encoded = serialize(nearChainSchema.Signature, sig);
    expect(encoded.length).toBe(66);
  });
});

// ── AccessKey serialization ──────────────────────────────────────────

describe("AccessKey serialization", () => {
  it("FullAccessPermission round-trips", () => {
    const ak = {
      nonce: 1n,
      permission: { fullAccess: {} },
    };
    const result = roundtrip(nearChainSchema.AccessKey, ak);
    expect(result).toEqual(ak);
  });

  it("FunctionCallPermission round-trips", () => {
    const ak = {
      nonce: 42n,
      permission: {
        functionCall: {
          allowance: 1000000n,
          receiverId: "contract.near",
          methodNames: ["method1", "method2"],
        },
      },
    };
    const result = roundtrip(nearChainSchema.AccessKey, ak);
    expect(result).toEqual(ak);
  });

  it("FunctionCallPermission with null allowance", () => {
    const ak = {
      nonce: 0n,
      permission: {
        functionCall: {
          allowance: null,
          receiverId: "test.near",
          methodNames: [],
        },
      },
    };
    const result = roundtrip(nearChainSchema.AccessKey, ak);
    expect(result).toEqual(ak);
  });
});

// ── Action variants ──────────────────────────────────────────────────

describe("Action variants", () => {
  const ed25519Pk = { ed25519Key: { data: zeroBytes(32) } };

  it("CreateAccount (index 0)", () => {
    const action = { createAccount: {} };
    const encoded = serialize(nearChainSchema.Action, action);
    expect(encoded[0]).toBe(0);
    const result = roundtrip(nearChainSchema.Action, action);
    expect(result).toEqual(action);
  });

  it("DeployContract (index 1)", () => {
    const action = { deployContract: { code: [1, 2, 3] } };
    const result = roundtrip(nearChainSchema.Action, action);
    expect(result).toEqual(action);
    const encoded = serialize(nearChainSchema.Action, action);
    expect(encoded[0]).toBe(1);
  });

  it("FunctionCall (index 2)", () => {
    const action = {
      functionCall: {
        methodName: "set_greeting",
        args: Array.from(new TextEncoder().encode('{"greeting":"hi"}')),
        gas: 30000000000000n,
        deposit: 0n,
      },
    };
    const result = roundtrip(nearChainSchema.Action, action);
    expect(result).toEqual(action);
    const encoded = serialize(nearChainSchema.Action, action);
    expect(encoded[0]).toBe(2);
  });

  it("Transfer (index 3)", () => {
    const action = { transfer: { deposit: 1000000000000000000000000n } };
    const result = roundtrip(nearChainSchema.Action, action);
    expect(result).toEqual(action);
    const encoded = serialize(nearChainSchema.Action, action);
    expect(encoded[0]).toBe(3);
  });

  it("Stake (index 4)", () => {
    const action = {
      stake: { stake: 500n, publicKey: ed25519Pk },
    };
    const result = roundtrip(nearChainSchema.Action, action);
    expect(result).toEqual(action);
    const encoded = serialize(nearChainSchema.Action, action);
    expect(encoded[0]).toBe(4);
  });

  it("AddKey (index 5)", () => {
    const action = {
      addKey: {
        publicKey: ed25519Pk,
        accessKey: { nonce: 0n, permission: { fullAccess: {} } },
      },
    };
    const result = roundtrip(nearChainSchema.Action, action);
    expect(result).toEqual(action);
    const encoded = serialize(nearChainSchema.Action, action);
    expect(encoded[0]).toBe(5);
  });

  it("DeleteKey (index 6)", () => {
    const action = { deleteKey: { publicKey: ed25519Pk } };
    const result = roundtrip(nearChainSchema.Action, action);
    expect(result).toEqual(action);
    const encoded = serialize(nearChainSchema.Action, action);
    expect(encoded[0]).toBe(6);
  });

  it("DeleteAccount (index 7)", () => {
    const action = { deleteAccount: { beneficiaryId: "beneficiary.near" } };
    const result = roundtrip(nearChainSchema.Action, action);
    expect(result).toEqual(action);
    const encoded = serialize(nearChainSchema.Action, action);
    expect(encoded[0]).toBe(7);
  });

  it("SignedDelegate (index 8)", () => {
    const action = {
      signedDelegate: {
        delegateAction: {
          senderId: "sender.near",
          receiverId: "receiver.near",
          actions: [{ createAccount: {} }],
          nonce: 1n,
          maxBlockHeight: 100n,
          publicKey: ed25519Pk,
        },
        signature: { ed25519Signature: { data: zeroBytes(64) } },
      },
    };
    const result = roundtrip(nearChainSchema.Action, action);
    expect(result).toEqual(action);
    const encoded = serialize(nearChainSchema.Action, action);
    expect(encoded[0]).toBe(8);
  });
});

// ── Transaction round-trip ───────────────────────────────────────────

describe("Transaction serialization", () => {
  it("minimal Transaction with Transfer action round-trips", () => {
    const tx = {
      signerId: "alice.near",
      publicKey: { ed25519Key: { data: zeroBytes(32) } },
      nonce: 1n,
      receiverId: "bob.near",
      blockHash: zeroBytes(32),
      actions: [{ transfer: { deposit: 1000000000000000000000000n } }],
    };
    const result = roundtrip(nearChainSchema.Transaction, tx);
    expect(result).toEqual(tx);
  });

  it("Transaction with multiple actions round-trips", () => {
    const tx = {
      signerId: "alice.near",
      publicKey: { ed25519Key: { data: zeroBytes(32) } },
      nonce: 5n,
      receiverId: "contract.near",
      blockHash: zeroBytes(32),
      actions: [
        {
          functionCall: {
            methodName: "set",
            args: [1, 2, 3],
            gas: 30000000000000n,
            deposit: 0n,
          },
        },
        { transfer: { deposit: 100n } },
      ],
    };
    const result = roundtrip(nearChainSchema.Transaction, tx);
    expect(result).toEqual(tx);
  });

  it("SignedTransaction round-trips", () => {
    const stx = {
      transaction: {
        signerId: "alice.near",
        publicKey: { ed25519Key: { data: zeroBytes(32) } },
        nonce: 1n,
        receiverId: "bob.near",
        blockHash: zeroBytes(32),
        actions: [{ transfer: { deposit: 0n } }],
      },
      signature: { ed25519Signature: { data: zeroBytes(64) } },
    };
    const result = roundtrip(nearChainSchema.SignedTransaction, stx);
    expect(result).toEqual(stx);
  });

  it("Transaction with secp256k1 key round-trips", () => {
    const tx = {
      signerId: "alice.near",
      publicKey: { secp256k1Key: { data: zeroBytes(64) } },
      nonce: 1n,
      receiverId: "bob.near",
      blockHash: zeroBytes(32),
      actions: [{ createAccount: {} }],
    };
    const result = roundtrip(nearChainSchema.Transaction, tx);
    expect(result).toEqual(tx);
  });
});
