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
    "MlDsa65Signature",
    "Signature",
    "Ed25519Data",
    "Secp256k1Data",
    "MlDsa65Data",
    "PublicKey",
    "FunctionCallPermission",
    "FullAccessPermission",
    "GasKeyInfo",
    "GasKeyFunctionCallPermission",
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
    "TransferToGasKey",
    "WithdrawFromGasKey",
    "ClassicAction",
    "DelegateAction",
    "SignedDelegate",
    "Action",
    "Transaction",
    "SignedTransaction",
    "TransactionNonce",
    "NonceMode",
    "TransactionV1",
    "SignedTransactionV1",
  ];

  it("has all expected schemas", () => {
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

  it("MlDsa65Signature has 3309-byte fixed array", () => {
    const s = nearChainSchema.MlDsa65Signature as any;
    expect(s.struct.data.array.len).toBe(3309);
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

  it("MlDsa65Data has 1952-byte fixed array", () => {
    const s = nearChainSchema.MlDsa65Data as any;
    expect(s.struct.data.array.len).toBe(1952);
  });

  it("Signature enum has 3 variants", () => {
    const s = nearChainSchema.Signature as any;
    expect(s.enum).toHaveLength(3);
  });

  it("PublicKey enum has 3 variants", () => {
    const s = nearChainSchema.PublicKey as any;
    expect(s.enum).toHaveLength(3);
  });

  it("ClassicAction enum has 10 entries (classic 8 + tagged gas-key actions)", () => {
    const s = nearChainSchema.ClassicAction as any;
    expect(s.enum).toHaveLength(10);
  });

  it("Action enum has 11 entries (classic 8 + signedDelegate + tagged gas-key actions)", () => {
    const s = nearChainSchema.Action as any;
    expect(s.enum).toHaveLength(11);
  });

  it("gas-key actions pin nearcore's discriminants 12 and 13 in both action enums", () => {
    for (const name of ["Action", "ClassicAction"] as const) {
      const entries = (nearChainSchema[name] as any).enum as Array<{ tag?: number; struct: object }>;
      const byKey = Object.fromEntries(entries.map((e) => [Object.keys(e.struct)[0], e.tag]));
      expect(byKey.transferToGasKey, name).toBe(12);
      expect(byKey.withdrawFromGasKey, name).toBe(13);
      // Every other entry keeps its positional discriminant.
      entries.forEach((e, i) => {
        if (e.tag === undefined) expect(i, `${name}[${i}]`).toBeLessThan(9);
      });
    }
  });

  it("AccessKeyPermission enum has 4 variants", () => {
    const s = nearChainSchema.AccessKeyPermission as any;
    expect(s.enum).toHaveLength(4);
  });

  it("GasKeyInfo is { balance: u128, numNonces: u16 } in that order", () => {
    const s = nearChainSchema.GasKeyInfo as any;
    expect(Object.entries(s.struct)).toEqual([["balance", "u128"], ["numNonces", "u16"]]);
  });

  it("TransactionV1 leads with the u8 version byte and ends with nonceMode", () => {
    const keys = Object.keys((nearChainSchema.TransactionV1 as any).struct);
    expect(keys).toEqual([
      "version", "signerId", "publicKey", "nonce", "receiverId", "blockHash", "actions", "nonceMode",
    ]);
    expect((nearChainSchema.TransactionV1 as any).struct.version).toBe("u8");
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

const zeroBytes = (n: number) => new Array(n).fill(0);

// These tests verify the NEAR chain schema's byte layout, so they decode in
// bigint mode to stay symmetric with the bigint inputs. The default
// string-decode behavior is covered in the @fastnear/borsh package tests.
function roundtrip(schema: Schema, value: unknown) {
  const encoded = serialize(schema, value);
  const decoded = deserialize(schema, encoded, { bigints: "bigint" });
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

  it("ML-DSA-65 public key round-trips with enum index 2", () => {
    const pk = { mlDsa65Key: { data: zeroBytes(1952) } };
    const encoded = serialize(nearChainSchema.PublicKey, pk);

    expect(encoded[0]).toBe(2);
    expect(encoded.length).toBe(1 + 1952);
    expect(deserialize(nearChainSchema.PublicKey, encoded)).toEqual(pk);
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

  it("ML-DSA-65 signature round-trips with enum index 2", () => {
    const sig = { mlDsa65Signature: { data: zeroBytes(3309) } };
    const encoded = serialize(nearChainSchema.Signature, sig);

    expect(encoded[0]).toBe(2);
    expect(encoded.length).toBe(1 + 3309);
    expect(deserialize(nearChainSchema.Signature, encoded)).toEqual(sig);
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

// ── Gas keys: golden vectors and round-trips ─────────────────────────
//
// Provenance: Rust-verified against near-primitives 0.38.0-rc.2 (nearcore
// fast-2.14.0-rc.2) — every hex string below, and the V1 sha256, was emitted
// by `borsh::to_vec` / `Transaction::get_hash_and_size` from the real Rust
// types via a throwaway integration test in core/primitives, and matched the
// values first derived from nearcore's pytest borsh schema
// (pytest/lib/messages/tx.py). The public key is ed25519 with bytes 00..1f.

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

describe("gas keys — golden vectors", () => {
  const pkBytes = Array.from({ length: 32 }, (_, i) => i);
  const pk = { ed25519Key: { data: pkBytes } };
  const pkHex = "00" + toHex(Uint8Array.from(pkBytes));

  it("AccessKey with GasKeyFullAccess { balance: 0, numNonces: 3 }", () => {
    const ak = { nonce: 0n, permission: { gasKeyFullAccess: { balance: 0n, numNonces: 3 } } };
    const encoded = serialize(nearChainSchema.AccessKey, ak);
    expect(toHex(encoded)).toBe("000000000000000003000000000000000000000000000000000300");
    expect(roundtrip(nearChainSchema.AccessKey, ak)).toEqual(ak);
  });

  it("AccessKey with GasKeyFunctionCall ({0, 3}, {None, app.near, [foo]})", () => {
    const ak = {
      nonce: 0n,
      permission: {
        gasKeyFunctionCall: {
          gasKeyInfo: { balance: 0n, numNonces: 3 },
          functionCall: { allowance: null, receiverId: "app.near", methodNames: ["foo"] },
        },
      },
    };
    const encoded = serialize(nearChainSchema.AccessKey, ak);
    expect(toHex(encoded)).toBe(
      "00000000000000000200000000000000000000000000000000030000080000006170702e6e6561720100000003000000666f6f",
    );
    expect(roundtrip(nearChainSchema.AccessKey, ak)).toEqual(ak);
  });

  it("Action::AddKey with a full-access gas key (discriminant 5)", () => {
    const action = {
      addKey: { publicKey: pk, accessKey: { nonce: 0n, permission: { gasKeyFullAccess: { balance: 0n, numNonces: 3 } } } },
    };
    const encoded = serialize(nearChainSchema.Action, action);
    expect(toHex(encoded)).toBe("05" + pkHex + "000000000000000003000000000000000000000000000000000300");
    expect(roundtrip(nearChainSchema.Action, action)).toEqual(action);
  });

  it("Action::TransferToGasKey (discriminant 12) with 1 NEAR", () => {
    const action = { transferToGasKey: { publicKey: pk, deposit: 10n ** 24n } };
    const encoded = serialize(nearChainSchema.Action, action);
    expect(encoded[0]).toBe(12);
    expect(toHex(encoded)).toBe("0c" + pkHex + "000000a1edccce1bc2d3000000000000");
    expect(roundtrip(nearChainSchema.Action, action)).toEqual(action);
    expect(roundtrip(nearChainSchema.ClassicAction, action)).toEqual(action);
  });

  it("Action::WithdrawFromGasKey (discriminant 13) with 0.01 NEAR", () => {
    const action = { withdrawFromGasKey: { publicKey: pk, amount: 10n ** 22n } };
    const encoded = serialize(nearChainSchema.Action, action);
    expect(encoded[0]).toBe(13);
    expect(toHex(encoded)).toBe("0d" + pkHex + "000040b2bac9e0191e02000000000000");
    expect(roundtrip(nearChainSchema.Action, action)).toEqual(action);
  });

  it("discriminants 9-11 are not decodable (not modelled)", () => {
    for (const tag of [9, 10, 11]) {
      expect(() => deserialize(nearChainSchema.Action, Uint8Array.from([tag])), `tag ${tag}`).toThrow(
        `Borsh: enum index ${tag} out of range`,
      );
    }
  });

  it("Transaction::V1 with a GasKeyNonce { nonce: 5, nonceIndex: 2 } and Monotonic mode", () => {
    const tx = {
      version: 1,
      signerId: "alice.near",
      publicKey: pk,
      nonce: { gasKeyNonce: { nonce: 5n, nonceIndex: 2 } },
      receiverId: "bob.near",
      blockHash: zeroBytes(32),
      actions: [{ transfer: { deposit: 1n } }],
      nonceMode: { monotonic: {} },
    };
    const encoded = serialize(nearChainSchema.TransactionV1, tx);
    expect(toHex(encoded)).toBe(
      "01" +
        "0a000000" + "616c6963652e6e656172" +
        pkHex +
        "01" + "0500000000000000" + "0200" +
        "08000000" + "626f622e6e656172" +
        "00".repeat(32) +
        "01000000" + "03" + "01000000000000000000000000000000" +
        "00",
    );
    expect(roundtrip(nearChainSchema.TransactionV1, tx)).toEqual(tx);
  });

  it("Transaction::V1 with a plain Nonce and Strict mode round-trips with the expected tags", () => {
    const tx = {
      version: 1,
      signerId: "a.near",
      publicKey: pk,
      nonce: { nonce: { nonce: 7n } },
      receiverId: "b.near",
      blockHash: zeroBytes(32),
      actions: [],
      nonceMode: { strict: {} },
    };
    const encoded = serialize(nearChainSchema.TransactionV1, tx);
    expect(encoded[0]).toBe(1);
    // nonce enum tag 0 sits right after the 1+32-byte public key and the 4+6-byte signer id.
    expect(encoded[1 + 4 + 6 + 33]).toBe(0);
    expect(encoded[encoded.length - 1]).toBe(1); // NonceMode::Strict
    expect(roundtrip(nearChainSchema.TransactionV1, tx)).toEqual(tx);
  });

  it("SignedTransactionV1 = V1 bytes followed by the signature", () => {
    const tx = {
      version: 1,
      signerId: "alice.near",
      publicKey: pk,
      nonce: { gasKeyNonce: { nonce: 5n, nonceIndex: 2 } },
      receiverId: "bob.near",
      blockHash: zeroBytes(32),
      actions: [{ transfer: { deposit: 1n } }],
      nonceMode: { monotonic: {} },
    };
    const signature = { ed25519Signature: { data: zeroBytes(64) } };
    const signed = serialize(nearChainSchema.SignedTransactionV1, { transaction: tx, signature });
    const txBytes = serialize(nearChainSchema.TransactionV1, tx);
    expect(toHex(signed)).toBe(toHex(txBytes) + "00" + "00".repeat(64));
  });
});
