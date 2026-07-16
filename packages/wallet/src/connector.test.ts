import { afterEach, describe, expect, it, vi } from "vitest";

const wallets = new Map<string, any>();

vi.mock("@fastnear/near-connect", () => {
  class NearConnector {
    availableWallets = Array.from(wallets.values()).map((wallet) => ({
      manifest: wallet.manifest,
    }));
    whenManifestLoaded = Promise.resolve();

    async connect({ walletId }: { walletId?: string } = {}) {
      const selectedWallet =
        wallets.get(walletId ?? "") ?? Array.from(wallets.values())[0];
      if (!selectedWallet) throw new Error("No mocked wallet");
      return selectedWallet;
    }

    async getConnectedWallet() {
      return {
        accounts: [{ accountId: "mike.testnet", publicKey: "ed25519:test" }],
        wallet: Array.from(wallets.values())[0],
      };
    }

    on() {
      // The wallet wrapper falls back to getConnectedWallet() in these tests.
    }
  }

  return { NearConnector };
});

describe("walletName", () => {
  afterEach(async () => {
    wallets.clear();
    const connector = await import("./connector.js");
    connector.reset();
  });

  it("falls back to near-connect manifest names for sandbox wallets", async () => {
    wallets.set("meteor-wallet", {
      manifest: { id: "meteor-wallet", name: "Meteor Wallet" },
      signOut: vi.fn(),
    });

    const connector = await import("./connector.js");
    await connector.connect({ network: "testnet", walletId: "meteor-wallet" });

    expect(connector.walletName({ network: "testnet" })).toBe("Meteor Wallet");
  });

  it("prefers metadata names when wallets expose both shapes", async () => {
    wallets.set("meteor-wallet", {
      manifest: { id: "meteor-wallet", name: "Meteor Wallet" },
      metadata: { name: "Meteor Metadata" },
      signOut: vi.fn(),
    });

    const connector = await import("./connector.js");
    await connector.connect({ network: "testnet", walletId: "meteor-wallet" });

    expect(connector.walletName({ network: "testnet" })).toBe("Meteor Metadata");
  });
});
