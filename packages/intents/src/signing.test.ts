import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  fromBase58,
  privateKeyFromRandom,
  verifyNep413Signature,
} from "@fastnear/utils";
import {
  buildIntentMessage,
  createWalletIntentSigner,
  defaultDeadline,
  encodeIntentSignature,
  normalizeIntentPublicKey,
  randomNonce,
  toSignedIntent,
} from "./signing.js";
import { createLocalIntentSigner } from "./node.js";
import { INTENTS_CONTRACT_ID, type TokenDiffIntent } from "./types.js";

const USDC_TO_USDT: TokenDiffIntent = {
  intent: "token_diff",
  diff: {
    "nep141:usdc.near": "-1000000",
    "nep141:usdt.near": "1000000",
  },
};

describe("randomNonce / defaultDeadline / buildIntentMessage", () => {
  it("generates unique 32-byte nonces", () => {
    const a = randomNonce();
    const b = randomNonce();
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
    expect(a).not.toEqual(b);
  });

  it("builds an ISO-8601 deadline in the future", () => {
    const deadline = defaultDeadline();
    expect(new Date(deadline).getTime()).toBeGreaterThan(Date.now());
    expect(deadline).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("builds the inner message with signer_id/deadline/intents", () => {
    const message = buildIntentMessage({
      signerId: "alice.near",
      intents: [USDC_TO_USDT],
      deadline: "2026-08-01T00:00:00.000Z",
    });
    expect(message).toEqual({
      signer_id: "alice.near",
      deadline: "2026-08-01T00:00:00.000Z",
      intents: [USDC_TO_USDT],
    });
  });

  it("rejects empty intent lists and missing signer", () => {
    expect(() =>
      buildIntentMessage({ signerId: "", intents: [USDC_TO_USDT] }),
    ).toThrow(/signerId/);
    expect(() =>
      buildIntentMessage({ signerId: "alice.near", intents: [] }),
    ).toThrow(/At least one intent/);
  });
});

describe("encodeIntentSignature", () => {
  it("re-encodes wallet base64 to ed25519:<base58>", () => {
    const raw = Uint8Array.from({ length: 64 }, (_, i) => i);
    const encoded = encodeIntentSignature(bytesToBase64(raw));
    expect(encoded).toMatch(/^ed25519:/);
    expect(fromBase58(encoded.slice("ed25519:".length))).toEqual(raw);
  });

  it("prefixes 65-byte signatures as secp256k1", () => {
    const raw = new Uint8Array(65);
    expect(encodeIntentSignature(raw)).toMatch(/^secp256k1:/);
  });

  it("passes through already-prefixed signatures", () => {
    expect(encodeIntentSignature("ed25519:abc")).toBe("ed25519:abc");
  });

  it("rejects unsupported lengths", () => {
    expect(() => encodeIntentSignature(new Uint8Array(63))).toThrow(/length/);
  });
});

describe("toSignedIntent", () => {
  it("assembles the MultiPayload with base64 nonce and prefixed encodings", () => {
    const nonce = randomNonce();
    const signed = toSignedIntent({
      message: { signer_id: "a.near", deadline: "d", intents: [USDC_TO_USDT] },
      nonce,
      publicKey: "ed25519:C3jXhkGhEx88Gj7XKtUziJKXEBMRaJ67bWFkxJikVxZ2",
      signature: new Uint8Array(64),
    });
    expect(signed.standard).toBe("nep413");
    expect(signed.payload.recipient).toBe(INTENTS_CONTRACT_ID);
    expect(base64ToBytes(signed.payload.nonce)).toEqual(nonce);
    expect(JSON.parse(signed.payload.message).signer_id).toBe("a.near");
    expect(signed.signature).toMatch(/^ed25519:/);
    expect(signed.payload.callbackUrl).toBeUndefined();
  });

  it("rejects wrong-size nonces", () => {
    expect(() =>
      toSignedIntent({
        message: "m",
        nonce: new Uint8Array(31),
        publicKey: "ed25519:abc",
        signature: new Uint8Array(64),
      }),
    ).toThrow(/32 bytes/);
  });
});

describe("normalizeIntentPublicKey", () => {
  it("adds the ed25519 prefix when missing and preserves existing prefixes", () => {
    expect(normalizeIntentPublicKey("abc")).toBe("ed25519:abc");
    expect(normalizeIntentPublicKey("secp256k1:abc")).toBe("secp256k1:abc");
  });
});

describe("createLocalIntentSigner", () => {
  it("produces a MultiPayload whose NEP-413 signature verifies", async () => {
    const privateKey = privateKeyFromRandom();
    const signer = createLocalIntentSigner({
      accountId: "agent.near",
      privateKey,
    });

    const signed = await signer.signIntents({ intents: [USDC_TO_USDT] });

    expect(signed.standard).toBe("nep413");
    expect(signed.payload.recipient).toBe("intents.near");
    const message = JSON.parse(signed.payload.message);
    expect(message.signer_id).toBe("agent.near");
    expect(message.intents).toEqual([USDC_TO_USDT]);
    expect(new Date(message.deadline).getTime()).toBeGreaterThan(Date.now());

    // The exact bytes intents.near verifies: NEP-413 over the message JSON
    // with the envelope nonce and recipient.
    expect(
      verifyNep413Signature({
        publicKey: signed.public_key,
        signature: fromBase58(signed.signature.slice("ed25519:".length)),
        message: signed.payload.message,
        nonce: base64ToBytes(signed.payload.nonce),
        recipient: signed.payload.recipient,
      }),
    ).toBe(true);
  });

  it("honors explicit nonce, deadline, and verifyingContract", async () => {
    const privateKey = privateKeyFromRandom();
    const signer = createLocalIntentSigner({
      accountId: "agent.near",
      privateKey,
    });
    const nonce = Uint8Array.from({ length: 32 }, () => 7);

    const signed = await signer.signIntents({
      intents: [USDC_TO_USDT],
      deadline: "2026-08-01T00:00:00.000Z",
      nonce,
      verifyingContract: "staging-intents.near",
    });

    expect(base64ToBytes(signed.payload.nonce)).toEqual(nonce);
    expect(signed.payload.recipient).toBe("staging-intents.near");
    expect(JSON.parse(signed.payload.message).deadline).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  it("rejects malformed private keys up front", () => {
    expect(() =>
      createLocalIntentSigner({ accountId: "a.near", privateKey: "ed25519:!" }),
    ).toThrow();
  });
});

describe("createWalletIntentSigner", () => {
  function mockWallet(overrides: Partial<Record<string, unknown>> = {}) {
    const calls: Array<Record<string, unknown>> = [];
    // A stand-in for @fastnear/wallet: signs NEP-413 for real with a local
    // key, and returns the base64 signature exactly as wallets do.
    const privateKey = privateKeyFromRandom();
    const wallet = {
      accountId: () => "alice.near",
      async signMessage(params: {
        message: string;
        recipient: string;
        nonce: Uint8Array;
      }) {
        calls.push({ ...params });
        const { signNep413Message, publicKeyFromPrivate } = await import(
          "@fastnear/utils"
        );
        const { signature } = signNep413Message(
          {
            message: params.message,
            nonce: params.nonce,
            recipient: params.recipient,
          },
          privateKey,
        );
        return {
          accountId: "alice.near",
          publicKey: publicKeyFromPrivate(privateKey),
          signature: bytesToBase64(signature),
        };
      },
      ...overrides,
    };
    return { wallet, calls };
  }

  it("signs via the wallet and re-encodes the base64 signature", async () => {
    const { wallet, calls } = mockWallet();
    const signer = createWalletIntentSigner({ wallet });

    const signed = await signer.signIntents({ intents: [USDC_TO_USDT] });

    expect(calls).toHaveLength(1);
    expect(calls[0].recipient).toBe("intents.near");
    expect((calls[0].nonce as Uint8Array).length).toBe(32);
    expect(signed.signature).toMatch(/^ed25519:/);
    expect(
      verifyNep413Signature({
        publicKey: signed.public_key,
        signature: fromBase58(signed.signature.slice("ed25519:".length)),
        message: signed.payload.message,
        nonce: base64ToBytes(signed.payload.nonce),
        recipient: signed.payload.recipient,
      }),
    ).toBe(true);
  });

  it("refuses a wallet that signed as a different account", async () => {
    const { wallet } = mockWallet();
    const signer = createWalletIntentSigner({ wallet });
    await expect(
      signer.signIntents({ intents: [USDC_TO_USDT], signerId: "bob.near" }),
    ).rejects.toThrow(/signed as alice.near/);
  });

  it("requires a connected account", async () => {
    const { wallet } = mockWallet({ accountId: () => null });
    const signer = createWalletIntentSigner({ wallet });
    await expect(
      signer.signIntents({ intents: [USDC_TO_USDT] }),
    ).rejects.toThrow(/No wallet account connected/);
  });

  it("requires a signMessage-capable wallet", () => {
    expect(() =>
      createWalletIntentSigner({ wallet: {} as never }),
    ).toThrow(/signMessage/);
  });

  it("signs a server-generated payload verbatim via signPayload", async () => {
    const { wallet, calls } = mockWallet();
    const signer = createWalletIntentSigner({ wallet });
    const nonce = Uint8Array.from({ length: 32 }, () => 9);

    const signed = await signer.signPayload({
      standard: "nep413",
      payload: {
        message: '{"signer_id":"alice.near","deadline":"d","intents":[]}',
        nonce: bytesToBase64(nonce),
        recipient: "intents.near",
      },
    } as never);

    expect(calls[0].message).toBe(
      '{"signer_id":"alice.near","deadline":"d","intents":[]}',
    );
    expect(calls[0].nonce).toEqual(nonce);
    expect(signed.payload.nonce).toBe(bytesToBase64(nonce));
    expect(
      verifyNep413Signature({
        publicKey: signed.public_key,
        signature: fromBase58(signed.signature.slice("ed25519:".length)),
        message: signed.payload.message,
        nonce,
        recipient: signed.payload.recipient,
      }),
    ).toBe(true);
  });

  it("refuses non-nep413 generated payloads", async () => {
    const { wallet } = mockWallet();
    const signer = createWalletIntentSigner({ wallet });
    await expect(
      signer.signPayload({
        standard: "erc191",
        payload: { message: "m", nonce: "x", recipient: "r" },
      } as never),
    ).rejects.toThrow(/only signs nep413/);
  });

  it("pins the signPayload recipient to intents.near by default", async () => {
    const { wallet } = mockWallet();
    const signer = createWalletIntentSigner({ wallet });
    await expect(
      signer.signPayload({
        message: "m",
        nonce: bytesToBase64(new Uint8Array(32)),
        recipient: "evil.near",
      }),
    ).rejects.toThrow(/Refusing to sign a payload for recipient "evil.near"/);
  });

  it("cross-checks the generated payload's signer_id against the wallet account", async () => {
    const { wallet } = mockWallet();
    const signer = createWalletIntentSigner({ wallet });
    await expect(
      signer.signPayload({
        message: '{"signer_id":"bob.near","deadline":"d","intents":[]}',
        nonce: bytesToBase64(new Uint8Array(32)),
        recipient: "intents.near",
      }),
    ).rejects.toThrow(/signed as alice.near but the intent names bob.near/);
  });

  it("refuses callbackUrl payloads the wallet transport cannot bind", async () => {
    const { wallet } = mockWallet();
    const signer = createWalletIntentSigner({ wallet });
    await expect(
      signer.signPayload({
        message: "m",
        nonce: bytesToBase64(new Uint8Array(32)),
        recipient: "intents.near",
        callbackUrl: "https://example.com/cb",
      }),
    ).rejects.toThrow(/cannot bind callbackUrl/);
  });
});

describe("createLocalIntentSigner signPayload", () => {
  it("signs a bare unsigned payload with a base64 nonce", async () => {
    const privateKey = privateKeyFromRandom();
    const signer = createLocalIntentSigner({ accountId: "a.near", privateKey });
    const nonce = Uint8Array.from({ length: 32 }, (_, i) => 31 - i);

    const signed = await signer.signPayload({
      message: "server-chosen message",
      nonce: bytesToBase64(nonce),
      recipient: "intents.near",
    });

    expect(
      verifyNep413Signature({
        publicKey: signed.public_key,
        signature: fromBase58(signed.signature.slice("ed25519:".length)),
        message: "server-chosen message",
        nonce,
        recipient: "intents.near",
      }),
    ).toBe(true);
  });

  it("rejects malformed nonces in generated payloads", async () => {
    const privateKey = privateKeyFromRandom();
    const signer = createLocalIntentSigner({ accountId: "a.near", privateKey });
    await expect(
      signer.signPayload({
        message: "m",
        nonce: bytesToBase64(new Uint8Array(16)),
        recipient: "intents.near",
      }),
    ).rejects.toThrow(/32 bytes/);
  });

  it("pins the recipient to intents.near by default", async () => {
    const privateKey = privateKeyFromRandom();
    const signer = createLocalIntentSigner({ accountId: "a.near", privateKey });
    const nonce = bytesToBase64(new Uint8Array(32));

    await expect(
      signer.signPayload({ message: "m", nonce, recipient: "evil.near" }),
    ).rejects.toThrow(/Refusing to sign a payload for recipient "evil.near"/);

    // Explicit override allows a different verifier deployment.
    const signed = await signer.signPayload(
      { message: "m", nonce, recipient: "staging-intents.near" },
      { expectedRecipient: "staging-intents.near" },
    );
    expect(signed.payload.recipient).toBe("staging-intents.near");
  });
});
