import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  curveFromKey,
  keyFromString,
  keyToString,
  privateKeyFromRandom,
  publicKeyFromPrivate,
  signHash,
  signBytes,
  sha256,
} from "./crypto.js";

// ── curveFromKey ────────────────────────────────────────────────────

describe("curveFromKey", () => {
  it("returns ed25519 for ed25519: prefix", () => {
    expect(curveFromKey("ed25519:abc")).toBe("ed25519");
  });

  it("returns secp256k1 for secp256k1: prefix", () => {
    expect(curveFromKey("secp256k1:abc")).toBe("secp256k1");
  });

  it("returns ed25519 for bare key (no colon)", () => {
    expect(curveFromKey("3gZJCFTcXzmQNJhKbV7tp1")).toBe("ed25519");
  });

  it("throws on unsupported prefix", () => {
    expect(() => curveFromKey("rsa:abc")).toThrow("Unsupported curve");
  });
});

// ── keyFromString / keyToString round-trip ──────────────────────────

describe("keyFromString / keyToString round-trip", () => {
  it("ed25519 round-trip", () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const encoded = keyToString(raw, "ed25519");
    const decoded = keyFromString(encoded);
    expect(decoded).toEqual(raw);
  });

  it("secp256k1 round-trip", () => {
    const raw = crypto.getRandomValues(new Uint8Array(64));
    const encoded = keyToString(raw, "secp256k1");
    const decoded = keyFromString(encoded);
    expect(decoded).toEqual(raw);
  });
});

// ── privateKeyFromRandom ────────────────────────────────────────────

describe("privateKeyFromRandom", () => {
  it("ed25519: prefixed, decodes to 64 bytes", () => {
    const priv = privateKeyFromRandom("ed25519");
    expect(priv.startsWith("ed25519:")).toBe(true);
    expect(keyFromString(priv).length).toBe(64);
  });

  it("secp256k1: prefixed, decodes to 32 bytes", () => {
    const priv = privateKeyFromRandom("secp256k1");
    expect(priv.startsWith("secp256k1:")).toBe(true);
    expect(keyFromString(priv).length).toBe(32);
  });
});

// ── publicKeyFromPrivate ────────────────────────────────────────────

describe("publicKeyFromPrivate", () => {
  it("ed25519: prefixed, decodes to 32 bytes", () => {
    const priv = privateKeyFromRandom("ed25519");
    const pub = publicKeyFromPrivate(priv);
    expect(pub.startsWith("ed25519:")).toBe(true);
    expect(keyFromString(pub).length).toBe(32);
  });

  it("secp256k1: prefixed, decodes to 64 bytes", () => {
    const priv = privateKeyFromRandom("secp256k1");
    const pub = publicKeyFromPrivate(priv);
    expect(pub.startsWith("secp256k1:")).toBe(true);
    expect(keyFromString(pub).length).toBe(64);
  });

  it("deterministic: same private key → same public key (ed25519)", () => {
    const priv = privateKeyFromRandom("ed25519");
    expect(publicKeyFromPrivate(priv)).toBe(publicKeyFromPrivate(priv));
  });

  it("deterministic: same private key → same public key (secp256k1)", () => {
    const priv = privateKeyFromRandom("secp256k1");
    expect(publicKeyFromPrivate(priv)).toBe(publicKeyFromPrivate(priv));
  });
});

// ── signHash ────────────────────────────────────────────────────────

describe("signHash", () => {
  it("ed25519: 64-byte sig that verifies", () => {
    const priv = privateKeyFromRandom("ed25519");
    const pub = publicKeyFromPrivate(priv);
    const hash = sha256(new TextEncoder().encode("test message"));

    const sig = signHash(hash, priv) as Uint8Array;
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);

    const pubBytes = keyFromString(pub);
    expect(ed25519.verify(sig, hash, pubBytes)).toBe(true);
  });

  it("secp256k1: 65-byte sig that verifies", () => {
    const priv = privateKeyFromRandom("secp256k1");
    const pub = publicKeyFromPrivate(priv);
    const hash = sha256(new TextEncoder().encode("test message"));

    const sig = signHash(hash, priv) as Uint8Array;
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(65);

    // sig layout: [r(32), s(32), v(1)]
    // noble verify wants compact [r, s] and uncompressed pubkey (0x04 ‖ x ‖ y)
    const compactSig = sig.slice(0, 64);
    const pubBytes = keyFromString(pub); // 64 bytes: x ‖ y
    const fullPub = new Uint8Array(65);
    fullPub[0] = 0x04;
    fullPub.set(pubBytes, 1);

    // signHash uses prehash:false (input is already a hash), so verify must match
    expect(
      secp256k1.verify(compactSig, hash, fullPub, { prehash: false }),
    ).toBe(true);
  });

  it("returnBase58 returns a string (ed25519)", () => {
    const priv = privateKeyFromRandom("ed25519");
    const hash = sha256(new TextEncoder().encode("data"));
    const result = signHash(hash, priv, { returnBase58: true });
    expect(typeof result).toBe("string");
  });

  it("returnBase58 returns a string (secp256k1)", () => {
    const priv = privateKeyFromRandom("secp256k1");
    const hash = sha256(new TextEncoder().encode("data"));
    const result = signHash(hash, priv, { returnBase58: true });
    expect(typeof result).toBe("string");
  });
});

// ── signBytes ───────────────────────────────────────────────────────

describe("signBytes", () => {
  it("ed25519 end-to-end: sign raw bytes and verify", () => {
    const priv = privateKeyFromRandom("ed25519");
    const pub = publicKeyFromPrivate(priv);
    const msg = new TextEncoder().encode("hello NEAR");

    const sig = signBytes(msg, priv) as Uint8Array;
    const hash = sha256(msg);
    const pubBytes = keyFromString(pub);
    expect(ed25519.verify(sig, hash, pubBytes)).toBe(true);
  });

  it("secp256k1 end-to-end: sign raw bytes and verify", () => {
    const priv = privateKeyFromRandom("secp256k1");
    const pub = publicKeyFromPrivate(priv);
    const msg = new TextEncoder().encode("hello NEAR");

    const sig = signBytes(msg, priv) as Uint8Array;
    const hash = sha256(msg);
    const compactSig = sig.slice(0, 64);
    const pubBytes = keyFromString(pub);
    const fullPub = new Uint8Array(65);
    fullPub[0] = 0x04;
    fullPub.set(pubBytes, 1);

    expect(
      secp256k1.verify(compactSig, hash, fullPub, { prehash: false }),
    ).toBe(true);
  });
});
