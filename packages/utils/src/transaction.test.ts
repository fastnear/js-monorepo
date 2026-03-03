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
  publicKeyFromPrivate,
  privateKeyFromRandom,
  signHash,
  sha256,
} from "./crypto.js";
import { toBase58 } from "./misc.js";

// ── helpers ─────────────────────────────────────────────────────────

function fakeTx(publicKey: string): PlainTransaction {
  return {
    signerId: "alice.near",
    publicKey,
    nonce: 1,
    receiverId: "bob.near",
    blockHash: toBase58(new Uint8Array(32)), // 32 zero bytes
    actions: [{ type: "Transfer", deposit: "1000000000000000000000000" }],
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
      delegateAction: { type: "Transfer", deposit: "1" },
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
      delegateAction: { type: "Transfer", deposit: "1" },
      signature: sig,
      publicKey: pub,
    }) as any;
    expect(mapped.signedDelegate.signature).toHaveProperty(
      "secp256k1Signature",
    );
  });
});
