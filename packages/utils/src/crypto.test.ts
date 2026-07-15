import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  curveFromKey,
  decodeNearPublicKey,
  keyFromString,
  keyTypeFromString,
  keyToString,
  NEAR_KEY_DESCRIPTORS,
  privateKeyFromRandom,
  publicKeyFromPrivate,
  signHash,
  signBytes,
  signerFromPrivateKey,
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

describe("NEAR key types", () => {
  it("recognizes ML-DSA-65 without treating it as an elliptic curve", () => {
    expect(keyTypeFromString("ml-dsa-65:abc")).toBe("ml-dsa-65");
    expect(() => curveFromKey("ml-dsa-65:abc")).toThrow("Unsupported curve");
  });

  it("publishes the protocol key and signature lengths", () => {
    expect(NEAR_KEY_DESCRIPTORS["ml-dsa-65"]).toMatchObject({
      borshTag: 2,
      publicKeyLength: 1952,
      signatureLength: 3309,
    });
  });

  it("validates full ML-DSA-65 public keys", () => {
    const publicKey = keyToString(new Uint8Array(1952), "ml-dsa-65");
    expect(decodeNearPublicKey(publicKey)).toEqual({
      keyType: "ml-dsa-65",
      data: new Uint8Array(1952),
    });
  });

  it("rejects malformed public-key lengths", () => {
    const publicKey = keyToString(new Uint8Array(32), "ml-dsa-65");
    expect(() => decodeNearPublicKey(publicKey)).toThrow(
      "expected 1952 bytes, got 32",
    );
  });

  it("rejects non-base58 characters instead of silently changing a key", () => {
    const publicKey = keyToString(new Uint8Array(1952).fill(7), "ml-dsa-65");
    const separator = publicKey.indexOf(":") + 1;
    const malformed = `${publicKey.slice(0, separator)}!${publicKey.slice(separator + 1)}`;
    expect(() => decodeNearPublicKey(malformed)).toThrow("Invalid base58");
  });

  it("rejects an ML-DSA hash handle where a full key is required", () => {
    expect(() =>
      decodeNearPublicKey(`ml-dsa-65-hash:${"1".repeat(32)}`),
    ).toThrow("handles cannot be used");
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
    const secret = keyFromString(priv);
    expect(secret.length).toBe(64);
    expect(secret.slice(32)).toEqual(ed25519.getPublicKey(secret.slice(0, 32)));
  });

  it("secp256k1: prefixed, decodes to 32 bytes", () => {
    const priv = privateKeyFromRandom("secp256k1");
    expect(priv.startsWith("secp256k1:")).toBe(true);
    expect(keyFromString(priv).length).toBe(32);
  });
});

describe("signerFromPrivateKey", () => {
  it("exposes the derived public key and signs hashes", () => {
    const privateKey = privateKeyFromRandom("ed25519");
    const signer = signerFromPrivateKey(privateKey);
    const hash = sha256(new TextEncoder().encode("structural signer"));
    const signature = signer.signHash(hash) as Uint8Array;

    expect(signer.publicKey).toBe(publicKeyFromPrivate(privateKey));
    expect(ed25519.verify(signature, hash, keyFromString(signer.publicKey))).toBe(
      true,
    );
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

  it.each([31, 33, 63, 65, 100])(
    "rejects a malformed %i-byte Ed25519 private key",
    (length) => {
      const privateKey = keyToString(new Uint8Array(length), "ed25519");
      expect(() => publicKeyFromPrivate(privateKey)).toThrow(
        "expected 32 or 64 bytes",
      );
    },
  );

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
