import { describe, it, expect } from "vitest";
import {
  mapTransaction,
  serializeTransaction,
  serializeSignedTransaction,
  mapAction,
  PlainTransaction,
} from "./transaction.js";
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
