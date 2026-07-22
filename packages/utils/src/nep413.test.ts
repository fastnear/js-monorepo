import { describe, expect, it } from "vitest";
import {
  NEP413_OFFCHAIN_TAG,
  nep413Hash,
  serializeNep413Payload,
  signNep413Message,
  verifyNep413Signature,
} from "./nep413.js";
import {
  bytesToBase64,
  privateKeyFromRandom,
  publicKeyFromPrivate,
  sha256,
  toBase58,
} from "./index.js";

// Hand-rolled borsh serialization, written independently of @fastnear/borsh,
// so the schema (field order, string/array/option encodings) is checked
// against the NEP-413 wire format rather than against itself.
function manualNep413Bytes({
  message,
  nonce,
  recipient,
  callbackUrl,
}: {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string | null;
}): Uint8Array {
  const encoder = new TextEncoder();
  const u32le = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return bytes;
  };
  const borshString = (value: string) => {
    const utf8 = encoder.encode(value);
    const out = new Uint8Array(4 + utf8.length);
    out.set(u32le(utf8.length), 0);
    out.set(utf8, 4);
    return out;
  };

  const parts: Uint8Array[] = [
    u32le(NEP413_OFFCHAIN_TAG),
    borshString(message),
    nonce, // [u8; 32] — raw bytes, no length prefix
    borshString(recipient),
  ];
  if (callbackUrl == null) {
    parts.push(Uint8Array.of(0));
  } else {
    parts.push(Uint8Array.of(1), borshString(callbackUrl));
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const NONCE = Uint8Array.from({ length: 32 }, (_, i) => i);

describe("serializeNep413Payload", () => {
  it("matches a hand-rolled borsh encoding without callbackUrl", () => {
    const payload = {
      message: '{"signer_id":"alice.near","intents":[]}',
      nonce: NONCE,
      recipient: "intents.near",
    };
    expect(serializeNep413Payload(payload)).toEqual(
      manualNep413Bytes(payload),
    );
  });

  it("matches a hand-rolled borsh encoding with callbackUrl", () => {
    const payload = {
      message: "hello",
      nonce: NONCE,
      recipient: "app.near",
      callbackUrl: "https://example.com/cb",
    };
    expect(serializeNep413Payload(payload)).toEqual(
      manualNep413Bytes(payload),
    );
  });

  it("starts with the little-endian off-chain tag 2^31 + 413", () => {
    const bytes = serializeNep413Payload({
      message: "m",
      nonce: NONCE,
      recipient: "r",
    });
    // 2147484061 = 0x8000019D → LE bytes 9D 01 00 80
    expect([...bytes.slice(0, 4)]).toEqual([0x9d, 0x01, 0x00, 0x80]);
  });

  it("rejects nonces that are not exactly 32 bytes", () => {
    expect(() =>
      nep413Hash({ message: "m", nonce: new Uint8Array(31), recipient: "r" }),
    ).toThrow(/32 bytes/);
    expect(() =>
      nep413Hash({ message: "m", nonce: new Uint8Array(33), recipient: "r" }),
    ).toThrow(/32 bytes/);
  });
});

describe("nep413Hash", () => {
  it("is the sha256 of the tagged borsh payload", () => {
    const payload = { message: "m", nonce: NONCE, recipient: "intents.near" };
    expect(nep413Hash(payload)).toEqual(
      sha256(manualNep413Bytes(payload)),
    );
  });

  it("accepts number[] nonces (wallet-adapter JSON round-trips)", () => {
    const payload = { message: "m", nonce: NONCE, recipient: "r" };
    expect(nep413Hash({ ...payload, nonce: [...NONCE] })).toEqual(
      nep413Hash(payload),
    );
  });
});

describe("signNep413Message / verifyNep413Signature", () => {
  it("round-trips with an ed25519 key", () => {
    const privateKey = privateKeyFromRandom();
    const payload = {
      message:
        '{"signer_id":"alice.near","deadline":"2026-08-01T00:00:00.000Z","intents":[{"intent":"token_diff","diff":{"nep141:usdc.near":"-1000000","nep141:usdt.near":"1000000"}}]}',
      nonce: NONCE,
      recipient: "intents.near",
    };

    const signed = signNep413Message(payload, privateKey);
    expect(signed.publicKey).toBe(publicKeyFromPrivate(privateKey));
    expect(signed.signature).toHaveLength(64);

    expect(
      verifyNep413Signature({
        publicKey: signed.publicKey,
        signature: signed.signature,
        ...payload,
      }),
    ).toBe(true);
  });

  it("accepts the base64 signature string wallets return", () => {
    const privateKey = privateKeyFromRandom();
    const payload = { message: "m", nonce: NONCE, recipient: "intents.near" };
    const signed = signNep413Message(payload, privateKey);

    expect(
      verifyNep413Signature({
        publicKey: signed.publicKey,
        signature: bytesToBase64(signed.signature),
        ...payload,
      }),
    ).toBe(true);
  });

  it("accepts the curve-prefixed base58 form MultiPayloads carry", () => {
    const privateKey = privateKeyFromRandom();
    const payload = { message: "m", nonce: NONCE, recipient: "intents.near" };
    const signed = signNep413Message(payload, privateKey);

    expect(
      verifyNep413Signature({
        publicKey: signed.publicKey,
        signature: `ed25519:${toBase58(signed.signature)}`,
        ...payload,
      }),
    ).toBe(true);
  });

  it("rejects a tampered message, nonce, or recipient", () => {
    const privateKey = privateKeyFromRandom();
    const payload = { message: "m", nonce: NONCE, recipient: "intents.near" };
    const signed = signNep413Message(payload, privateKey);
    const check = (overrides: Partial<typeof payload>) =>
      verifyNep413Signature({
        publicKey: signed.publicKey,
        signature: signed.signature,
        ...payload,
        ...overrides,
      });

    expect(check({})).toBe(true);
    expect(check({ message: "m2" })).toBe(false);
    expect(check({ recipient: "evil.near" })).toBe(false);
    const flipped = Uint8Array.from(NONCE);
    flipped[0] ^= 1;
    expect(check({ nonce: flipped })).toBe(false);
  });

  it("binds callbackUrl into the signature when present", () => {
    const privateKey = privateKeyFromRandom();
    const payload = {
      message: "m",
      nonce: NONCE,
      recipient: "r",
      callbackUrl: "https://example.com/cb",
    };
    const signed = signNep413Message(payload, privateKey);

    expect(
      verifyNep413Signature({
        publicKey: signed.publicKey,
        signature: signed.signature,
        ...payload,
      }),
    ).toBe(true);
    expect(
      verifyNep413Signature({
        publicKey: signed.publicKey,
        signature: signed.signature,
        ...payload,
        callbackUrl: null,
      }),
    ).toBe(false);
  });

  it("round-trips with a secp256k1 key", () => {
    const privateKey = privateKeyFromRandom("secp256k1");
    const payload = { message: "m", nonce: NONCE, recipient: "r" };
    const signed = signNep413Message(payload, privateKey);
    expect(signed.signature).toHaveLength(65);

    expect(
      verifyNep413Signature({
        publicKey: signed.publicKey,
        signature: signed.signature,
        ...payload,
      }),
    ).toBe(true);
    expect(
      verifyNep413Signature({
        publicKey: signed.publicKey,
        signature: signed.signature,
        ...payload,
        message: "m2",
      }),
    ).toBe(false);
  });

  it("refuses ml-dsa-65 keys with a pointer to the opt-in package", () => {
    expect(() =>
      verifyNep413Signature({
        publicKey: "ml-dsa-65:1111",
        signature: new Uint8Array(64),
        message: "m",
        nonce: NONCE,
        recipient: "r",
      }),
    ).toThrow(/@fastnear\/ml-dsa-65/);
  });
});
