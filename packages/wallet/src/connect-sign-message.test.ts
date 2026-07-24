import { afterEach, describe, expect, it, vi } from "vitest";

// near-connect emits `wallet:signInAndSignMessage` *synchronously* from inside
// connect(), before it resolves — so this mock reproduces that ordering
// exactly. A listener attached after connect() resolves would never fire, and
// the emit is unguarded upstream, so a throwing listener would escape through
// connect() and look like a user cancellation.
const listeners = new Map<string, Array<(payload: any) => void>>();
const connectCalls: any[] = [];
let signedMessageToEmit: any = null;
let signInAccountToEmit: any = { accountId: "mike.testnet", publicKey: "ed25519:signin" };
let connectShouldThrow = false;

function emit(event: string, payload: any) {
  for (const cb of listeners.get(event) ?? []) cb(payload);
}

vi.mock("@fastnear/near-connect", () => {
  class NearConnector {
    availableWallets: any[] = [];
    whenManifestLoaded = Promise.resolve();

    async connect(input: { walletId?: string; signMessageParams?: any } = {}) {
      connectCalls.push(input);
      if (connectShouldThrow) throw new Error("User closed the modal");

      if (input.signMessageParams) {
        emit("wallet:signInAndSignMessage", {
          wallet: { manifest: { id: "meteor-wallet", name: "Meteor Wallet" } },
          accounts: [{ accountId: "mike.testnet", signedMessage: signedMessageToEmit }],
          success: true,
        });
      }
      emit("wallet:signIn", {
        wallet: { manifest: { id: "meteor-wallet", name: "Meteor Wallet" } },
        accounts: [signInAccountToEmit],
        success: true,
      });

      return { manifest: { id: "meteor-wallet", name: "Meteor Wallet" }, signOut: vi.fn() };
    }

    async getConnectedWallet() {
      return { accounts: [signInAccountToEmit], wallet: {} };
    }

    async disconnect() {
      emit("wallet:signOut", {});
    }

    on(event: string, cb: (payload: any) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(cb);
    }

    off(event: string, cb: (payload: any) => void) {
      const arr = listeners.get(event);
      if (!arr) return;
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    }
  }

  return { NearConnector };
});

function signedMessageListenerCount() {
  return (listeners.get("wallet:signInAndSignMessage") ?? []).length;
}

const SIGNED = {
  accountId: "mike.testnet",
  publicKey: "ed25519:frommessage",
  signature: "c2lnbmF0dXJl",
};

const PARAMS = {
  message: "Sign in to FastNear Berry Club",
  recipient: "example.com",
  nonce: new Uint8Array(32),
};

describe("connect({ signMessageParams })", () => {
  afterEach(async () => {
    listeners.clear();
    connectCalls.length = 0;
    signedMessageToEmit = null;
    signInAccountToEmit = { accountId: "mike.testnet", publicKey: "ed25519:signin" };
    connectShouldThrow = false;
    const connector = await import("./connector.js");
    connector.reset();
  });

  it("forwards signMessageParams to the connector and returns the signed message", async () => {
    signedMessageToEmit = SIGNED;
    const connector = await import("./connector.js");

    const result = await connector.connect({ network: "testnet", signMessageParams: PARAMS });

    expect(connectCalls[0].signMessageParams).toEqual(PARAMS);
    expect(result?.signedMessage).toEqual(SIGNED);
    expect(result?.accountId).toBe("mike.testnet");
  });

  it("does not register a capture listener when no message is requested", async () => {
    const connector = await import("./connector.js");

    const result = await connector.connect({ network: "testnet" });

    expect(connectCalls[0].signMessageParams).toBeUndefined();
    expect(result?.signedMessage).toBeUndefined();
    expect(signedMessageListenerCount()).toBe(0);
  });

  it("removes the capture listener after a successful connect", async () => {
    signedMessageToEmit = SIGNED;
    const connector = await import("./connector.js");

    await connector.connect({ network: "testnet", signMessageParams: PARAMS });

    expect(signedMessageListenerCount()).toBe(0);
  });

  it("removes the capture listener when the user cancels", async () => {
    connectShouldThrow = true;
    const connector = await import("./connector.js");

    const result = await connector.connect({ network: "testnet", signMessageParams: PARAMS });

    expect(result).toBeNull();
    expect(signedMessageListenerCount()).toBe(0);
  });

  it("survives a malformed event payload instead of failing the sign-in", async () => {
    signedMessageToEmit = undefined;
    const connector = await import("./connector.js");

    const result = await connector.connect({ network: "testnet", signMessageParams: PARAMS });

    expect(result?.accountId).toBe("mike.testnet");
    expect(result?.signedMessage).toBeUndefined();
  });
});

describe("connect() publicKey", () => {
  afterEach(async () => {
    listeners.clear();
    connectCalls.length = 0;
    signedMessageToEmit = null;
    signInAccountToEmit = { accountId: "mike.testnet", publicKey: "ed25519:signin" };
    connectShouldThrow = false;
    const connector = await import("./connector.js");
    connector.reset();
  });

  it("returns the public key from the sign-in event rather than undefined", async () => {
    const connector = await import("./connector.js");

    const result = await connector.connect({ network: "testnet" });

    expect(result?.publicKey).toBe("ed25519:signin");
  });

  it("falls back to the signature's public key when the account omits one", async () => {
    // Several wallets (intear, meteor) return only { accountId, signedMessage }
    // from signInAndSignMessage — no publicKey on the account itself.
    signInAccountToEmit = { accountId: "mike.testnet" };
    signedMessageToEmit = SIGNED;
    const connector = await import("./connector.js");

    const result = await connector.connect({ network: "testnet", signMessageParams: PARAMS });

    expect(result?.publicKey).toBe("ed25519:frommessage");
  });

  it("clears the cached public key on disconnect", async () => {
    const connector = await import("./connector.js");
    await connector.connect({ network: "testnet" });
    expect(connector.accountId({ network: "testnet" })).toBe("mike.testnet");

    await connector.disconnect({ network: "testnet" });

    const again = await connector.connect({ network: "testnet" });
    expect(again?.publicKey).toBe("ed25519:signin");
  });
});
