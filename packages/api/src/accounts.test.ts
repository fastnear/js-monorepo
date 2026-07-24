import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyToString } from "@fastnear/utils";
import { implicitAccountId, createFundedTestnetAccount } from "./near.js";

const originalFetch = global.fetch;

describe("implicitAccountId", () => {
  it("returns the 64-char hex of the ed25519 public key bytes", () => {
    const publicKey = keyToString(new Uint8Array(32).fill(1), "ed25519");
    expect(implicitAccountId(publicKey)).toBe("01".repeat(32));
  });

  it("rejects non-ed25519 keys", () => {
    const secp = keyToString(new Uint8Array(64).fill(2), "secp256k1");
    expect(() => implicitAccountId(secp)).toThrow(/Only ed25519/);
  });
});

describe("createFundedTestnetAccount", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  // The field name is `newAccountPublicKey`, not near-api-js's older `newKey`.
  // This assertion previously locked in the wrong spelling, so the mock passed
  // while every real call returned 400. Verified against the live helper:
  // `newKey` -> 400 with an internal TypeError, `newAccountPublicKey` -> 200.
  it("POSTs { newAccountId, newAccountPublicKey } to the testnet helper and returns its JSON", async () => {
    let captured: { url: any; init: any } | undefined;
    global.fetch = vi.fn(async (url: any, init: any) => {
      captured = { url, init };
      return { ok: true, status: 200, json: async () => ({ account_id: "alice.testnet" }) };
    }) as any;

    const publicKey = keyToString(new Uint8Array(32).fill(3), "ed25519");
    const result = await createFundedTestnetAccount({ newAccountId: "alice.testnet", publicKey });

    expect(result).toEqual({ account_id: "alice.testnet" });
    expect(captured?.url).toBe("https://helper.testnet.near.org/account");
    expect(captured?.init.method).toBe("POST");
    expect(JSON.parse(captured?.init.body)).toEqual({
      newAccountId: "alice.testnet",
      newAccountPublicKey: publicKey,
    });
  });

  it("throws with the faucet status and body on failure", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 422,
      text: async () => "account exists",
    })) as any;

    await expect(
      createFundedTestnetAccount({
        newAccountId: "taken.testnet",
        publicKey: keyToString(new Uint8Array(32).fill(4), "ed25519"),
      }),
    ).rejects.toThrow(/422.*account exists/);
  });
});
