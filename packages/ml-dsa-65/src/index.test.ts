import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import awsLcWycheproofVector from "../test-fixtures/aws-lc-wycheproof-ml-dsa-65.json";
import {
  ML_DSA_65_PROTOCOL_VERSION,
  ML_DSA_65_PUBLIC_KEY_HANDLE_LENGTH,
  ML_DSA_65_PUBLIC_KEY_LENGTH,
  ML_DSA_65_SECRET_KEY_LENGTH,
  ML_DSA_65_SEED_LENGTH,
  ML_DSA_65_SIGNATURE_LENGTH,
  decodePublicKey,
  decodePublicKeyHandle,
  decodeSecretKey,
  decodeSignature,
  encodePublicKey,
  encodePublicKeyHandle,
  encodeSecretKey,
  encodeSignature,
  generateSigner,
  publicKeyToHandle,
  signerFromSecretKey,
  signerFromSeed,
  verifyHash,
} from "./index.js";

const KAT_SEED_HEX =
  "6b61742d736565642d7631202020202020202020202020202020202020202020";
const KAT_PUBLIC_KEY_SHA256 =
  "d592b03a1d6d202e01cb38b891ab5adb140e1dc7c58abfc0d9f62fd277bcffe0";
const KAT_PUBLIC_KEY_HANDLE =
  "ml-dsa-65-hash:8cUHv6GMQBn2tQRkqS6eGaPq8kuReqXXFY5qNQquSa5j";
const AWS_LC_EXPANDED_SECRET_SHA256 =
  "3513e0881fb738ae2979779f76c221eca35bd4563e198ba1b1d9f8699cbe5b85";
const AWS_LC_PUBLIC_KEY_SHA256 =
  "b7acce2ddb11f8cc1aa46e2bafac6eacfa2b732ef192bd636ad8d3a56d649c66";
const AWS_LC_SIGNATURE_SHA256 =
  "54dffec43b1410c8f11bd3f9534830dd2cb98fcd3809a2af3634a89d936954d9";

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("ML-DSA-65 constants", () => {
  it("matches nearcore 2.13.0 protocol and wire sizes", () => {
    expect(ML_DSA_65_PROTOCOL_VERSION).toBe(85);
    expect(ML_DSA_65_SEED_LENGTH).toBe(32);
    expect(ML_DSA_65_PUBLIC_KEY_LENGTH).toBe(1952);
    expect(ML_DSA_65_SECRET_KEY_LENGTH).toBe(4032);
    expect(ML_DSA_65_SIGNATURE_LENGTH).toBe(3309);
    expect(ML_DSA_65_PUBLIC_KEY_HANDLE_LENGTH).toBe(32);
  });
});

describe("nearcore 2.13.0 interoperability", () => {
  it("pins the padded KAT seed to the nearcore public key and handle", () => {
    const signer = signerFromSeed(fromHex(KAT_SEED_HEX));
    const publicKeyBytes = decodePublicKey(signer.publicKey);

    // A compact cryptographic pin of nearcore's full 1,952-byte KAT fixture.
    expect(toHex(sha256(publicKeyBytes))).toBe(KAT_PUBLIC_KEY_SHA256);
    expect(signer.publicKey.startsWith("ml-dsa-65:JX86tc6EwW1EFL5Q9B84")).toBe(true);
    expect(signer.publicKeyHandle).toBe(KAT_PUBLIC_KEY_HANDLE);
    expect(publicKeyToHandle(signer.publicKey)).toBe(KAT_PUBLIC_KEY_HANDLE);
    expect(toHex(decodePublicKeyHandle(signer.publicKeyHandle))).toBe(
      "7117fedd2e78d860850f3af7491c12e1194e479b99fc374e9a3370c2b7b3061e",
    );
    signer.destroy();
  });

  it("signs and verifies pure randomized ML-DSA over a 32-byte hash", () => {
    const signer = signerFromSeed(fromHex(KAT_SEED_HEX));
    const hash = sha256(new TextEncoder().encode("near transaction fixture"));
    const first = signer.signHash(hash);
    const second = signer.signHash(hash);

    expect(first).toHaveLength(ML_DSA_65_SIGNATURE_LENGTH);
    expect(second).toHaveLength(ML_DSA_65_SIGNATURE_LENGTH);
    expect(first).not.toEqual(second);
    expect(verifyHash({ hash, signature: first, publicKey: signer.publicKey })).toBe(true);
    expect(
      verifyHash({
        hash,
        signature: encodeSignature(second),
        publicKey: signer.publicKey,
      }),
    ).toBe(true);

    const tampered = first.slice();
    tampered[100] ^= 1;
    expect(verifyHash({ hash, signature: tampered, publicKey: signer.publicKey })).toBe(false);
    signer.destroy();
  });

  it("imports and verifies the AWS-LC/Wycheproof expanded-key fixture", () => {
    // This is an intentionally public test vector, never production key
    // material. nearcore 2.13.0 pins the exact AWS-LC revision that consumes
    // the source vectors identified in the fixture's provenance metadata.
    const expandedSecretKey = fromHex(
      awsLcWycheproofVector.expandedSecretKeyHexChunks.join(""),
    );
    const publicKey = fromHex(
      awsLcWycheproofVector.publicKeyHexChunks.join(""),
    );
    const signature = fromHex(
      awsLcWycheproofVector.signatureHexChunks.join(""),
    );
    const hash = fromHex(awsLcWycheproofVector.messageHex);

    expect(awsLcWycheproofVector.notice).toMatch(/PUBLIC TEST VECTOR/);
    expect(awsLcWycheproofVector.provenance.nearcoreTag).toBe("2.13.0");
    expect(awsLcWycheproofVector.provenance.nearcoreCommit).toBe(
      "499283a5e3a6f8ea52bc068c28e3a7bebb1e38c0",
    );
    expect(awsLcWycheproofVector.provenance.awsLcCommit).toBe(
      "47389586f8aa77c83245173793f4d44ed1d6c3a8",
    );
    expect(awsLcWycheproofVector.sha256).toEqual({
      expandedSecretKey: AWS_LC_EXPANDED_SECRET_SHA256,
      publicKey: AWS_LC_PUBLIC_KEY_SHA256,
      signature: AWS_LC_SIGNATURE_SHA256,
    });
    expect(expandedSecretKey).toHaveLength(ML_DSA_65_SECRET_KEY_LENGTH);
    expect(publicKey).toHaveLength(ML_DSA_65_PUBLIC_KEY_LENGTH);
    expect(signature).toHaveLength(ML_DSA_65_SIGNATURE_LENGTH);
    expect(hash).toHaveLength(32);
    expect(toHex(sha256(expandedSecretKey))).toBe(AWS_LC_EXPANDED_SECRET_SHA256);
    expect(toHex(sha256(publicKey))).toBe(AWS_LC_PUBLIC_KEY_SHA256);
    expect(toHex(sha256(signature))).toBe(AWS_LC_SIGNATURE_SHA256);

    const signer = signerFromSecretKey(expandedSecretKey);
    expect(signer.publicKey).toBe(encodePublicKey(publicKey));
    expect(signer.exportSeed()).toBeNull();
    expect(verifyHash({ hash, signature, publicKey })).toBe(true);
    signer.destroy();
  });
});

describe("strict text codecs", () => {
  const cases = [
    ["public key", ML_DSA_65_PUBLIC_KEY_LENGTH, encodePublicKey, decodePublicKey],
    ["secret key", ML_DSA_65_SECRET_KEY_LENGTH, encodeSecretKey, decodeSecretKey],
    ["signature", ML_DSA_65_SIGNATURE_LENGTH, encodeSignature, decodeSignature],
    [
      "public key handle",
      ML_DSA_65_PUBLIC_KEY_HANDLE_LENGTH,
      encodePublicKeyHandle,
      decodePublicKeyHandle,
    ],
  ] as const;

  for (const [label, length, encode, decode] of cases) {
    it(`round-trips an exact-length ${label}`, () => {
      const bytes = new Uint8Array(length);
      bytes[0] = 1;
      bytes[length - 1] = 2;
      const text = encode(bytes as never);
      expect(decode(text)).toEqual(bytes);
      expect(decode(text)).not.toBe(bytes);
    });

    it(`rejects malformed or incorrectly-sized ${label} values`, () => {
      expect(() => encode(new Uint8Array(length - 1) as never)).toThrow(/exactly/);
      expect(() => decode("ed25519:111")).toThrow(/must start/);
      expect(() => decode(`${encode(new Uint8Array(length) as never)} `)).toThrow();
      expect(() => decode(encode(new Uint8Array(length) as never).slice(0, -1))).toThrow();
    });
  }
});

describe("signer lifecycle", () => {
  it("keeps secret state non-enumerable and exports defensive copies", () => {
    const signer = generateSigner();
    const seed = signer.exportSeed();
    const exportedSecret = signer.exportSecretKey();

    expect(seed).toHaveLength(ML_DSA_65_SEED_LENGTH);
    expect(Object.keys(signer).sort()).toEqual(["publicKey", "publicKeyHandle"]);
    expect(JSON.stringify(signer)).not.toContain("secret");
    expect(decodeSecretKey(exportedSecret)).toHaveLength(ML_DSA_65_SECRET_KEY_LENGTH);

    seed![0] ^= 1;
    expect(signer.exportSeed()).not.toEqual(seed);
    signer.destroy();
  });

  it("imports expanded secrets without inventing a seed", () => {
    const original = signerFromSeed(fromHex(KAT_SEED_HEX));
    const imported = signerFromSecretKey(original.exportSecretKey());

    expect(imported.publicKey).toBe(original.publicKey);
    expect(imported.publicKeyHandle).toBe(original.publicKeyHandle);
    expect(imported.exportSeed()).toBeNull();
    original.destroy();
    imported.destroy();
  });

  it("zeroizes best-effort, is idempotent, and disables secret operations", () => {
    const signer = signerFromSeed(fromHex(KAT_SEED_HEX));
    signer.destroy();
    signer.destroy();

    expect(signer.destroyed).toBe(true);
    expect(() => signer.signHash(new Uint8Array(32))).toThrow(/destroyed/);
    expect(() => signer.exportSeed()).toThrow(/destroyed/);
    expect(() => signer.exportSecretKey()).toThrow(/destroyed/);
  });

  it("rejects anything other than an exact 32-byte transaction hash", () => {
    const signer = signerFromSeed(fromHex(KAT_SEED_HEX));
    expect(() => signer.signHash(new Uint8Array(31))).toThrow(/exactly 32/);
    expect(() =>
      verifyHash({
        hash: new Uint8Array(33),
        signature: new Uint8Array(ML_DSA_65_SIGNATURE_LENGTH),
        publicKey: signer.publicKey,
      }),
    ).toThrow(/exactly 32/);
    signer.destroy();
  });
});
