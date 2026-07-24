import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "@fastnear/utils";
import { actions, accountId, authStatus, config, requestSignIn, sendTx, signOut, state } from "./near.js";
import { NETWORKS } from "./state.js";

// The API keeps two cursors for "which network am I on":
//
//   _activeNetwork      — every no-arg READ goes through it
//                         (accountId, publicKey, authStatus)
//   _config.networkId   — every no-arg WRITE and route goes through it
//                         (sendTx, signOut, signMessage, signDelegate,
//                          selected, and RPC URL selection)
//
// `requestSignIn` used to promote only the first. With parallel mainnet +
// testnet sessions — an explicitly supported flow — that meant accountId()
// said "alice.testnet" while a no-arg sendTx was signed by alice.near and
// broadcast on mainnet. Real funds, wrong network, no warning. With only a
// testnet session the same call threw "Must sign in" while authStatus()
// reported SignedIn.
//
// These tests pin the invariant directly: after any sign-in, the read cursor
// and the write cursor must name the same network.

function walletProvider() {
  const calls: any[] = [];
  const connected: Record<string, boolean> = { mainnet: false, testnet: false };
  const idFor = (n: string) => (n === "testnet" ? "alice.testnet" : "alice.near");
  return {
    calls,
    connect: vi.fn(async (o: any = {}) => {
      const n = o.network ?? "mainnet";
      connected[n] = true;
      calls.push(["connect", n]);
      return { accountId: idFor(n), network: n };
    }),
    restore: vi.fn(async () => null),
    disconnect: vi.fn(async (o: any = {}) => {
      const n = o.network ?? "mainnet";
      connected[n] = false;
      calls.push(["disconnect", n]);
    }),
    sendTransaction: vi.fn(async (p: any) => {
      calls.push(["sendTransaction", p.network, p.signerId, p.receiverId]);
      return { outcomes: [] };
    }),
    accountId: vi.fn((o: any = {}) =>
      connected[o.network ?? "mainnet"] ? idFor(o.network ?? "mainnet") : null,
    ),
    isConnected: vi.fn((o: any = {}) => !!connected[o.network ?? "mainnet"]),
  };
}

beforeEach(() => {
  memoryStore.clear();
  state.resetTxHistory();
  state.setWalletProvider(null as any);
  state.setConfig({ ...NETWORKS.mainnet, apiKey: null });
  state.setActiveNetwork("mainnet");
});

describe("requestSignIn promotes both network cursors", () => {
  it("agrees on the network after a cross-network sign-in", async () => {
    state.setWalletProvider(walletProvider() as any);

    await requestSignIn({ network: "testnet" });

    expect(state.getActiveNetwork()).toBe("testnet");
    expect(config().networkId).toBe("testnet");
  });

  it("routes a no-arg sendTx to the network the user just signed in to", async () => {
    const provider = walletProvider();
    state.setWalletProvider(provider as any);

    await requestSignIn({});                     // mainnet session
    await requestSignIn({ network: "testnet" }); // then testnet — parallel sessions

    expect(accountId()).toBe("alice.testnet");

    await sendTx({ receiverId: "bob.near", actions: [actions.transfer("10 NEAR")] });

    const sent = provider.calls.filter((c) => c[0] === "sendTransaction").pop();
    expect(sent).toBeDefined();
    // The whole point: the signer the user can see and the network it goes to
    // must not disagree.
    expect(sent![1]).toBe("testnet");
    expect(sent![2]).toBe("alice.testnet");
  });

  it("does not throw 'Must sign in' for a testnet-only session", async () => {
    const provider = walletProvider();
    state.setWalletProvider(provider as any);

    await requestSignIn({ network: "testnet" });
    expect(authStatus()).toBe("SignedIn");

    await expect(
      sendTx({ receiverId: "bob.testnet", actions: [actions.transfer("1")] }),
    ).resolves.toBeDefined();
  });

  it("persists the promotion, so a reload keeps the session", async () => {
    state.setWalletProvider(walletProvider() as any);
    await requestSignIn({ network: "testnet" });

    // A reload rebuilds _activeNetwork from the persisted config.
    expect(memoryStore.size).toBeGreaterThan(0);
    expect(state.getConfig().networkId).toBe("testnet");
    expect(state.getAccountState("testnet").accountId).toBe("alice.testnet");
  });

  it("signs out the network the user is actually on", async () => {
    const provider = walletProvider();
    state.setWalletProvider(provider as any);

    await requestSignIn({ network: "testnet" });
    await signOut();

    expect(provider.calls.filter((c) => c[0] === "disconnect").pop()?.[1]).toBe("testnet");
    expect(state.getAccountState("testnet").accountId).toBeNull();
  });

  it("leaves a parallel session on the other network alone", async () => {
    state.setWalletProvider(walletProvider() as any);

    await requestSignIn({});
    await requestSignIn({ network: "testnet" });
    await signOut();

    expect(state.getAccountState("testnet").accountId).toBeNull();
    expect(state.getAccountState("mainnet").accountId).toBe("alice.near");
  });
});

describe("signOut does not discard caller-configured service URLs", () => {
  it("keeps a custom rpc and tx base URL when the network never changes", async () => {
    state.setWalletProvider(walletProvider() as any);
    config({
      networkId: "mainnet",
      services: {
        rpc: { baseUrl: "https://private-rpc.internal" },
        tx: { baseUrl: "https://private-tx.internal" },
      },
    });

    await requestSignIn({});
    await signOut();

    expect(state.getConfig().services?.rpc?.baseUrl).toBe("https://private-rpc.internal");
    expect(state.getConfig().services?.tx?.baseUrl).toBe("https://private-tx.internal");
  });

  it("keeps the apiKey across a sign-out", async () => {
    state.setWalletProvider(walletProvider() as any);
    config({ networkId: "mainnet", apiKey: "MY-KEY" });

    await requestSignIn({});
    await signOut();

    expect(state.getConfig().apiKey).toBe("MY-KEY");
  });

  it("still resets the active network to the default on a no-arg sign-out", async () => {
    state.setWalletProvider(walletProvider() as any);

    await requestSignIn({ network: "testnet" });
    await signOut();

    expect(state.getConfig().networkId).toBe("mainnet");
    expect(state.getActiveNetwork()).toBe("mainnet");
  });
});
