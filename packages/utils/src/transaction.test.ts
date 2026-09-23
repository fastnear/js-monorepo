import { describe, it, expect } from "vitest";
import {
  mapTransaction,
  serializeTransaction,
  serializeSignedTransaction,
  mapAction,
  isTransactionV1,
  MAX_GAS_KEY_NONCES,
  SCHEMA,
  PlainTransaction,
} from "./transaction.js";
import { serialize } from "@fastnear/borsh";
import {
  keyFromString,
  keyToString,
  publicKeyFromPrivate,
  privateKeyFromRandom,
  signHash,
  sha256,
  type NearPublicKey,
} from "./crypto.js";
import { toBase58 } from "./misc.js";

// ── helpers ─────────────────────────────────────────────────────────

function fakeTx(publicKey: NearPublicKey): PlainTransaction {
  return {
    signerId: "alice.near",
    publicKey,
    nonce: 1,
    receiverId: "bob.near",
    blockHash: toBase58(new Uint8Array(32)), // 32 zero bytes
    actions: [{ type: "Transfer", deposit: "1000000000000000000000000" }],
  };
}

function fakeDelegate(publicKey: NearPublicKey) {
  return {
    senderId: "alice.near",
    receiverId: "bob.near",
    actions: [{ type: "Transfer" as const, deposit: "1" }],
    nonce: 1,
    maxBlockHeight: 100,
    publicKey,
  };
}

function keyPair(curve: "ed25519" | "secp256k1") {
  const priv = privateKeyFromRandom(curve);
  const pub = publicKeyFromPrivate(priv);
  return { priv, pub };
}

// ── mapTransaction ──────────────────────────────────────────────────

describe("mapTransaction", () => {
  it("ed25519 key → ed25519Key variant with 32-byte data", () => {
    const { pub } = keyPair("ed25519");
    const mapped = mapTransaction(fakeTx(pub));
    expect(mapped.publicKey).toHaveProperty("ed25519Key");
    expect((mapped.publicKey as any).ed25519Key.data.length).toBe(32);
  });

  it("secp256k1 key → secp256k1Key variant with 64-byte data", () => {
    const { pub } = keyPair("secp256k1");
    const mapped = mapTransaction(fakeTx(pub));
    expect(mapped.publicKey).toHaveProperty("secp256k1Key");
    expect((mapped.publicKey as any).secp256k1Key.data.length).toBe(64);
  });

  it("ML-DSA-65 key → tag-2 variant with 1952-byte data", () => {
    const publicKey = keyToString(new Uint8Array(1952), "ml-dsa-65");
    const mapped = mapTransaction(fakeTx(publicKey));
    expect(mapped.publicKey).toHaveProperty("mlDsa65Key");
    expect((mapped.publicKey as any).mlDsa65Key.data.length).toBe(1952);
  });

  it("rejects ML-DSA-65 hash handles as transaction keys", () => {
    expect(() =>
      mapTransaction(
        fakeTx("ml-dsa-65-hash:11111111111111111111111111111111" as any),
      ),
    ).toThrow("handles cannot be used");
  });
});

// ── serializeTransaction ────────────────────────────────────────────

describe("serializeTransaction", () => {
  it("ed25519: serializes without throwing", () => {
    const { pub } = keyPair("ed25519");
    const bytes = serializeTransaction(fakeTx(pub));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("secp256k1: serializes without throwing", () => {
    const { pub } = keyPair("secp256k1");
    const bytes = serializeTransaction(fakeTx(pub));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });
});

// ── serializeSignedTransaction ──────────────────────────────────────

describe("serializeSignedTransaction", () => {
  it("ed25519: serializes with ed25519Signature", () => {
    const { priv, pub } = keyPair("ed25519");
    const tx = fakeTx(pub);
    const hash = sha256(serializeTransaction(tx));
    const sig = signHash(hash, priv, { returnBase58: true }) as string;

    const bytes = serializeSignedTransaction(tx, sig);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("secp256k1: serializes with secp256k1Signature", () => {
    const { priv, pub } = keyPair("secp256k1");
    const tx = fakeTx(pub);
    const hash = sha256(serializeTransaction(tx));
    const sig = signHash(hash, priv, { returnBase58: true }) as string;

    const bytes = serializeSignedTransaction(tx, sig);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("accepts raw signature bytes", () => {
    const { priv, pub } = keyPair("ed25519");
    const tx = fakeTx(pub);
    const signature = signHash(sha256(serializeTransaction(tx)), priv);

    expect(serializeSignedTransaction(tx, signature)).toEqual(
      serializeSignedTransaction(tx, signHash(sha256(serializeTransaction(tx)), priv, {
        returnBase58: true,
      })),
    );
  });

  it("serializes an ML-DSA-65 raw signature with enum tag 2", () => {
    const publicKey = keyToString(new Uint8Array(1952), "ml-dsa-65");
    const tx = fakeTx(publicKey);
    const transactionBytes = serializeTransaction(tx);
    const bytes = serializeSignedTransaction(tx, new Uint8Array(3309));

    expect(bytes[transactionBytes.length]).toBe(2);
    expect(bytes.length).toBe(transactionBytes.length + 1 + 3309);
  });

  it("accepts a canonical prefixed ML-DSA-65 signature", () => {
    const publicKey = keyToString(new Uint8Array(1952), "ml-dsa-65");
    const signature = keyToString(new Uint8Array(3309), "ml-dsa-65");
    const tx = fakeTx(publicKey);
    const transactionBytes = serializeTransaction(tx);
    const bytes = serializeSignedTransaction(tx, signature);

    expect(bytes[transactionBytes.length]).toBe(2);
  });

  it("rejects a prefixed signature that does not match its signer key type", () => {
    const { pub } = keyPair("ed25519");
    const signature = keyToString(new Uint8Array(65), "secp256k1");
    expect(() => serializeSignedTransaction(fakeTx(pub), signature)).toThrow(
      "does not match signer key type",
    );
  });

  it("rejects a signature with the wrong length for its key type", () => {
    const { pub } = keyPair("ed25519");
    expect(() => serializeSignedTransaction(fakeTx(pub), new Uint8Array(63))).toThrow(
      "expected 64 bytes, got 63",
    );
  });

  it.each(["bare", "prefixed"])(
    "rejects non-base58 characters in a %s signature",
    (form) => {
      const { pub } = keyPair("ed25519");
      const valid = toBase58(new Uint8Array(64));
      const malformed = `!${valid.slice(1)}`;
      const signature = form === "prefixed"
        ? `ed25519:${malformed}`
        : malformed;
      expect(() => serializeSignedTransaction(fakeTx(pub), signature)).toThrow(
        "Invalid base58",
      );
    },
  );
});

// ── mapAction: FunctionCall amount coercion ─────────────────────────

describe("mapAction — FunctionCall gas/deposit units", () => {
  it("accepts human unit strings the demo site and wallet path use", () => {
    const mapped = mapAction({
      type: "FunctionCall",
      methodName: "buy_tokens",
      args: {},
      gas: "100 Tgas",
      deposit: "0.01 NEAR",
    }) as any;
    expect(mapped.functionCall.gas).toBe(100_000_000_000_000n);
    expect(mapped.functionCall.deposit).toBe(10_000_000_000_000_000_000_000n);
  });

  it("is a no-op on unit-less integer strings (idempotent with pre-converted values)", () => {
    const mapped = mapAction({
      type: "FunctionCall",
      methodName: "draw",
      args: {},
      gas: "30000000000000",
      deposit: "0",
    }) as any;
    expect(mapped.functionCall.gas).toBe(30_000_000_000_000n);
    expect(mapped.functionCall.deposit).toBe(0n);
  });

  it("accepts bigint and number amounts unchanged", () => {
    const mapped = mapAction({
      type: "FunctionCall",
      methodName: "m",
      args: {},
      gas: 30_000_000_000_000n,
      deposit: 1,
    }) as any;
    expect(mapped.functionCall.gas).toBe(30_000_000_000_000n);
    expect(mapped.functionCall.deposit).toBe(1n);
  });

  it("defaults gas to 300 Tgas and deposit to 0 when omitted", () => {
    const mapped = mapAction({
      type: "FunctionCall",
      methodName: "m",
      args: {},
    }) as any;
    expect(mapped.functionCall.gas).toBe(300_000_000_000_000n);
    expect(mapped.functionCall.deposit).toBe(0n);
  });

  it("rejects an unknown unit with a clear message", () => {
    expect(() =>
      mapAction({
        type: "FunctionCall",
        methodName: "m",
        args: {},
        gas: "100 potato",
      }),
    ).toThrow(/Unknown unit/);
  });

  it("Transfer deposit also accepts NEAR units", () => {
    const mapped = mapAction({ type: "Transfer", deposit: "1.5 NEAR" }) as any;
    expect(mapped.transfer.deposit).toBe(1_500_000_000_000_000_000_000_000n);
  });
});

// ── mapAction: Stake ────────────────────────────────────────────────

describe("mapAction — Stake", () => {
  it("ed25519: publicKey is ed25519Key", () => {
    const { pub } = keyPair("ed25519");
    const mapped = mapAction({
      type: "Stake",
      stake: "1000",
      publicKey: pub,
    }) as any;
    expect(mapped.stake.publicKey).toHaveProperty("ed25519Key");
  });

  it("secp256k1: publicKey is secp256k1Key", () => {
    const { pub } = keyPair("secp256k1");
    const mapped = mapAction({
      type: "Stake",
      stake: "1000",
      publicKey: pub,
    }) as any;
    expect(mapped.stake.publicKey).toHaveProperty("secp256k1Key");
  });

  it("rejects ML-DSA-65 validator keys", () => {
    const publicKey = keyToString(new Uint8Array(1952), "ml-dsa-65");
    expect(() =>
      mapAction({ type: "Stake", stake: "1000", publicKey }),
    ).toThrow("validator staking keys must be Ed25519");
  });
});

// ── mapAction: AddKey ───────────────────────────────────────────────

describe("mapAction — AddKey", () => {
  it("ed25519: publicKey is ed25519Key", () => {
    const { pub } = keyPair("ed25519");
    const mapped = mapAction({
      type: "AddKey",
      publicKey: pub,
      accessKey: {
        nonce: 0,
        permission: "FullAccess",
      },
    }) as any;
    expect(mapped.addKey.publicKey).toHaveProperty("ed25519Key");
  });

  it("secp256k1: publicKey is secp256k1Key", () => {
    const { pub } = keyPair("secp256k1");
    const mapped = mapAction({
      type: "AddKey",
      publicKey: pub,
      accessKey: {
        nonce: 0,
        permission: "FullAccess",
      },
    }) as any;
    expect(mapped.addKey.publicKey).toHaveProperty("secp256k1Key");
  });

  it("defaults an omitted access-key nonce to zero", () => {
    const { pub } = keyPair("ed25519");
    const mapped = mapAction({
      type: "AddKey",
      publicKey: pub,
      accessKey: { permission: "FullAccess" },
    }) as any;
    expect(mapped.addKey.accessKey.nonce).toBe(0n);
  });

  it("normalizes a nested function-call permission", () => {
    const { pub } = keyPair("ed25519");
    const mapped = mapAction({
      type: "AddKey",
      publicKey: pub,
      accessKey: {
        permission: {
          allowance: "0",
          receiverId: "contract.near",
          methodNames: ["ping"],
        },
      },
    }) as any;
    expect(mapped.addKey.accessKey.permission.functionCall).toEqual({
      allowance: 0n,
      receiverId: "contract.near",
      methodNames: ["ping"],
    });
  });
});

// ── mapAction: DeleteKey ────────────────────────────────────────────

describe("mapAction — DeleteKey", () => {
  it("ed25519: correct enum variant", () => {
    const { pub } = keyPair("ed25519");
    const mapped = mapAction({ type: "DeleteKey", publicKey: pub }) as any;
    expect(mapped.deleteKey.publicKey).toHaveProperty("ed25519Key");
  });

  it("secp256k1: correct enum variant", () => {
    const { pub } = keyPair("secp256k1");
    const mapped = mapAction({ type: "DeleteKey", publicKey: pub }) as any;
    expect(mapped.deleteKey.publicKey).toHaveProperty("secp256k1Key");
  });
});

// ── mapAction: SignedDelegate ───────────────────────────────────────

describe("mapAction — SignedDelegate", () => {
  it("ed25519: signature uses ed25519Signature", () => {
    const { priv, pub } = keyPair("ed25519");
    const hash = sha256(new TextEncoder().encode("delegate"));
    const sig = signHash(hash, priv, { returnBase58: true }) as string;

    const mapped = mapAction({
      type: "SignedDelegate",
      delegateAction: fakeDelegate(pub),
      signature: sig,
      publicKey: pub,
    }) as any;
    expect(mapped.signedDelegate.signature).toHaveProperty("ed25519Signature");
  });

  it("secp256k1: signature uses secp256k1Signature", () => {
    const { priv, pub } = keyPair("secp256k1");
    const hash = sha256(new TextEncoder().encode("delegate"));
    const sig = signHash(hash, priv, { returnBase58: true }) as string;

    const mapped = mapAction({
      type: "SignedDelegate",
      delegateAction: fakeDelegate(pub),
      signature: sig,
      publicKey: pub,
    }) as any;
    expect(mapped.signedDelegate.signature).toHaveProperty(
      "secp256k1Signature",
    );
  });

  it("maps the complete delegate action structure", () => {
    const { priv, pub } = keyPair("ed25519");
    const signature = signHash(
      sha256(new TextEncoder().encode("delegate")),
      priv,
    );
    const mapped = mapAction({
      type: "SignedDelegate",
      delegateAction: fakeDelegate(pub),
      signature,
    }) as any;

    expect(mapped.signedDelegate.delegateAction).toMatchObject({
      senderId: "alice.near",
      receiverId: "bob.near",
      nonce: 1n,
      maxBlockHeight: 100n,
    });
    expect(mapped.signedDelegate.delegateAction.actions[0]).toEqual({
      transfer: { deposit: 1n },
    });
  });

  it("rejects a redundant delegate signer key that does not match", () => {
    const ed = keyPair("ed25519");
    const secp = keyPair("secp256k1");
    const signature = signHash(
      sha256(new TextEncoder().encode("delegate")),
      ed.priv,
    );

    expect(() =>
      mapAction({
        type: "SignedDelegate",
        delegateAction: fakeDelegate(ed.pub),
        publicKey: secp.pub,
        signature,
      }),
    ).toThrow("must match delegateAction.publicKey");
  });
});

// ── Gas keys ─────────────────────────────────────────────────────────
//
// Golden bytes: Rust-verified against near-primitives 0.38.0-rc.2 (nearcore
// fast-2.14.0-rc.2) via `borsh::to_vec` on the real types; the same vectors
// are pinned in @fastnear/borsh-schema with full provenance. Public key =
// ed25519 with bytes 00..1f.

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const GK_PK_BYTES = Uint8Array.from({ length: 32 }, (_, i) => i);
const GK_PK = keyToString(GK_PK_BYTES, "ed25519");
const GK_PK_HEX = "00" + hex(GK_PK_BYTES);
const GK_FULL_ACCESS_AK_HEX = "000000000000000003000000000000000000000000000000000300";
const GK_FUNCTION_CALL_AK_HEX =
  "00000000000000000200000000000000000000000000000000030000080000006170702e6e6561720100000003000000666f6f";

describe("gas keys — public key fixture", () => {
  it("is the documented base58 form", () => {
    expect(GK_PK).toBe("ed25519:1thX6LZfHDZZKUs92febYZhYRcXddmzfzF2NvTkPNE");
  });
});

describe("gas keys — mapAction AddKey", () => {
  it("GasKeyFullAccess maps to gasKeyFullAccess { balance: 0, numNonces } and matches the golden bytes", () => {
    const mapped = mapAction({
      type: "AddKey",
      publicKey: GK_PK,
      accessKey: { permission: "GasKeyFullAccess", numNonces: 3 },
    }) as any;
    expect(mapped.addKey.accessKey).toEqual({
      nonce: 0n,
      permission: { gasKeyFullAccess: { balance: 0n, numNonces: 3 } },
    });
    expect(hex(serialize(SCHEMA.Action, mapped))).toBe("05" + GK_PK_HEX + GK_FULL_ACCESS_AK_HEX);
  });

  it("GasKeyFunctionCall maps the tuple as gasKeyInfo then functionCall with a null allowance", () => {
    const mapped = mapAction({
      type: "AddKey",
      publicKey: GK_PK,
      accessKey: {
        permission: "GasKeyFunctionCall",
        numNonces: 3,
        receiverId: "app.near",
        methodNames: ["foo"],
      },
    }) as any;
    expect(mapped.addKey.accessKey.permission).toEqual({
      gasKeyFunctionCall: {
        gasKeyInfo: { balance: 0n, numNonces: 3 },
        functionCall: { allowance: null, receiverId: "app.near", methodNames: ["foo"] },
      },
    });
    expect(hex(serialize(SCHEMA.Action, mapped))).toBe("05" + GK_PK_HEX + GK_FUNCTION_CALL_AK_HEX);
  });

  it("rejects an allowance on a GasKeyFunctionCall key", () => {
    expect(() =>
      mapAction({
        type: "AddKey",
        publicKey: GK_PK,
        accessKey: {
          permission: "GasKeyFunctionCall",
          numNonces: 1,
          receiverId: "app.near",
          allowance: "1 NEAR",
        },
      }),
    ).toThrow("cannot carry an allowance");
  });

  it("GasKeyFunctionCall still requires a receiverId", () => {
    expect(() =>
      mapAction({
        type: "AddKey",
        publicKey: GK_PK,
        accessKey: { permission: "GasKeyFunctionCall", numNonces: 1 },
      }),
    ).toThrow("require a receiverId");
  });

  it("validates numNonces as an integer in 1..MAX_GAS_KEY_NONCES", () => {
    expect(MAX_GAS_KEY_NONCES).toBe(1024);
    for (const numNonces of [0, 1025, 1.5, -1, "3", undefined]) {
      expect(() =>
        mapAction({
          type: "AddKey",
          publicKey: GK_PK,
          accessKey: { permission: "GasKeyFullAccess", numNonces: numNonces as any },
        }),
        `numNonces ${String(numNonces)}`,
      ).toThrow("numNonces between 1 and 1024");
    }
    for (const numNonces of [1, 1024]) {
      const mapped = mapAction({
        type: "AddKey",
        publicKey: GK_PK,
        accessKey: { permission: "GasKeyFullAccess", numNonces },
      }) as any;
      expect(mapped.addKey.accessKey.permission.gasKeyFullAccess.numNonces).toBe(numNonces);
    }
  });

  it("re-encodes a nonzero balance verbatim (chain payloads round-trip)", () => {
    const mapped = mapAction({
      type: "AddKey",
      publicKey: GK_PK,
      accessKey: { permission: "GasKeyFullAccess", numNonces: 2, balance: "0.5 NEAR" },
    }) as any;
    expect(mapped.addKey.accessKey.permission.gasKeyFullAccess.balance).toBe(5n * 10n ** 23n);
  });

  it("still rejects unknown permission strings loudly", () => {
    expect(() =>
      mapAction({
        type: "AddKey",
        publicKey: GK_PK,
        accessKey: { permission: "GasKey" as any },
      }),
    ).toThrow("Unsupported access-key permission: GasKey");
  });
});

describe("gas keys — TransferToGasKey / WithdrawFromGasKey", () => {
  it("TransferToGasKey accepts a unit-suffixed deposit and encodes discriminant 12", () => {
    const mapped = mapAction({ type: "TransferToGasKey", publicKey: GK_PK, deposit: "1 NEAR" }) as any;
    expect(mapped.transferToGasKey.deposit).toBe(10n ** 24n);
    const bytes = serialize(SCHEMA.Action, mapped);
    expect(bytes[0]).toBe(12);
    expect(hex(bytes)).toBe("0c" + GK_PK_HEX + "000000a1edccce1bc2d3000000000000");
  });

  it("WithdrawFromGasKey maps amount and encodes discriminant 13", () => {
    const mapped = mapAction({ type: "WithdrawFromGasKey", publicKey: GK_PK, amount: "0.01 NEAR" }) as any;
    expect(mapped.withdrawFromGasKey.amount).toBe(10n ** 22n);
    const bytes = serialize(SCHEMA.Action, mapped);
    expect(bytes[0]).toBe(13);
    expect(hex(bytes)).toBe("0d" + GK_PK_HEX + "000040b2bac9e0191e02000000000000");
  });

  it("accepts ML-DSA-65 public keys and rejects hash handles", () => {
    const pq = keyToString(new Uint8Array(1952), "ml-dsa-65");
    const mapped = mapAction({ type: "TransferToGasKey", publicKey: pq, deposit: "1" }) as any;
    expect(mapped.transferToGasKey.publicKey).toHaveProperty("mlDsa65Key");
    expect(() =>
      mapAction({
        type: "WithdrawFromGasKey",
        publicKey: "ml-dsa-65-hash:11111111111111111111111111111111" as any,
        amount: "1",
      }),
    ).toThrow("handles cannot be used");
  });

  it("WithdrawFromGasKey cannot ride inside a SignedDelegate", () => {
    const { priv, pub } = keyPair("ed25519");
    expect(() =>
      mapAction({
        type: "SignedDelegate",
        delegateAction: {
          ...fakeDelegate(pub),
          actions: [{ type: "WithdrawFromGasKey", publicKey: pub, amount: "1" } as any],
        },
        signature: signHash(new Uint8Array(32), priv),
      }),
    ).toThrow("WithdrawFromGasKeyNotAllowedInDelegate");
  });
});

describe("gas keys — TransactionV1", () => {
  const V1_TX_HEX =
    "01" +
    "0a000000" + "616c6963652e6e656172" +
    GK_PK_HEX +
    "01" + "0500000000000000" + "0200" +
    "08000000" + "626f622e6e656172" +
    "00".repeat(32) +
    "01000000" + "03" + "01000000000000000000000000000000" +
    "00";
  const V1_TX_SHA256 = "d7927894465b6c094e4100e9ae2b1d9fb5174bb18415484fd61ef67d2241f0ae";

  function goldenTx(extra: Partial<PlainTransaction> = {}): PlainTransaction {
    return {
      signerId: "alice.near",
      publicKey: GK_PK,
      nonce: 5,
      receiverId: "bob.near",
      blockHash: toBase58(new Uint8Array(32)),
      actions: [{ type: "Transfer", deposit: "1" }],
      nonceIndex: 2,
      ...extra,
    };
  }

  it("a nonceIndex selects V1 and reproduces the golden bytes and hash", () => {
    const tx = goldenTx();
    expect(isTransactionV1(tx)).toBe(true);
    const bytes = serializeTransaction(tx);
    expect(hex(bytes)).toBe(V1_TX_HEX);
    expect(hex(sha256(bytes))).toBe(V1_TX_SHA256);
  });

  it("mapTransaction emits the V1 shape with a leading version byte", () => {
    const mapped = mapTransaction(goldenTx()) as any;
    expect(mapped.version).toBe(1);
    expect(mapped.nonce).toEqual({ gasKeyNonce: { nonce: 5n, nonceIndex: 2 } });
    expect(mapped.nonceMode).toEqual({ monotonic: {} });
  });

  it("nonceMode alone selects V1 with a plain nonce; strict sets the trailing byte", () => {
    const tx = goldenTx({ nonceIndex: undefined, nonceMode: "strict" });
    expect(isTransactionV1(tx)).toBe(true);
    const mapped = mapTransaction(tx) as any;
    expect(mapped.nonce).toEqual({ nonce: { nonce: 5n } });
    expect(mapped.nonceMode).toEqual({ strict: {} });
    const bytes = serializeTransaction(tx);
    expect(bytes[0]).toBe(1);
    expect(bytes[bytes.length - 1]).toBe(1);
    expect(serializeTransaction(goldenTx({ nonceMode: "monotonic" })).at(-1)).toBe(0);
  });

  it("V0 bytes are unchanged when no V1 field is present", () => {
    const tx = goldenTx({ nonceIndex: undefined });
    expect(isTransactionV1(tx)).toBe(false);
    const bytes = serializeTransaction(tx);
    // No version prefix: the first four bytes are the u32 length of "alice.near".
    expect(hex(bytes.slice(0, 4))).toBe("0a000000");
    expect(hex(bytes)).toBe(hex(serialize(SCHEMA.Transaction, mapTransaction(tx))));
    expect((mapTransaction(tx) as any).version).toBeUndefined();
  });

  it("rejects an out-of-range or non-integer nonceIndex and an unknown nonceMode", () => {
    for (const nonceIndex of [-1, 1024, 1.5, "2"]) {
      expect(() => serializeTransaction(goldenTx({ nonceIndex: nonceIndex as any })), String(nonceIndex))
        .toThrow("nonceIndex must be an integer in 0..1023");
    }
    expect(() => serializeTransaction(goldenTx({ nonceMode: "loose" as any }))).toThrow(
      "Unsupported nonceMode: loose",
    );
  });

  it("serializeSignedTransaction (V1) = V1 bytes ‖ signature, signed over sha256 of the V1 bytes", () => {
    const { priv, pub } = keyPair("ed25519");
    const tx = goldenTx({ publicKey: pub });
    const txBytes = serializeTransaction(tx);
    const sig = signHash(sha256(txBytes), priv);
    const signed = serializeSignedTransaction(tx, sig);
    expect(hex(signed)).toBe(hex(txBytes) + "00" + hex(sig));
    expect(signed[0]).toBe(1);
  });
});
