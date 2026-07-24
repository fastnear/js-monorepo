import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "@fastnear/utils";
import { recipes, requestSignIn, state } from "./near.js";
import { DEFAULT_RETRY, NETWORKS } from "./state.js";
import { runWithRetry } from "./resilience.js";

// Four places where the shipped surface did something other than what it
// advertised — the failure mode being that nothing errors, so a caller
// following the docs just gets a quietly wrong client.

const originalFetch = global.fetch;

beforeEach(() => {
  memoryStore.clear();
  state.setWalletProvider(null as any);
  state.setConfig({ ...NETWORKS.mainnet, apiKey: null });
  state.setActiveNetwork("mainnet");
});

afterEach(() => {
  global.fetch = originalFetch;
  state.setWalletProvider(null as any);
});

describe("per-call { network } override on the read recipes", () => {
  function captureUrls() {
    const urls: string[] = [];
    global.fetch = vi.fn(async (url: any) => {
      urls.push(String(url));
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ transactions: [], result: {} }),
      };
    }) as any;
    return urls;
  }

  it("routes inspectTransaction to the requested network", async () => {
    const urls = captureUrls();

    await recipes.inspectTransaction({ txHash: "abc", network: "testnet" });

    // Was dropped on the floor, so this silently queried mainnet and returned
    // null — a miss indistinguishable from "no such transaction".
    expect(urls.some((u) => u.includes("tx.test.fastnear.com"))).toBe(true);
    expect(urls.some((u) => u.includes("tx.main.fastnear.com"))).toBe(false);
  });

  it("routes viewContract to the requested network", async () => {
    const urls = captureUrls();

    await recipes.viewContract({
      contractId: "guest-book.testnet",
      methodName: "getMessages",
      network: "testnet",
    });

    expect(urls.some((u) => u.includes("rpc.testnet"))).toBe(true);
  });

  it("routes viewAccount to the requested network", async () => {
    const urls = captureUrls();

    await recipes.viewAccount({ accountId: "alice.testnet", network: "testnet" });

    expect(urls.some((u) => u.includes("rpc.testnet"))).toBe(true);
  });

  it("still defaults to the active network when no override is given", async () => {
    const urls = captureUrls();

    await recipes.inspectTransaction({ txHash: "abc" });

    expect(urls.some((u) => u.includes("tx.main.fastnear.com"))).toBe(true);
  });
});

describe("config({ apiKey }) treats undefined as absent, not as a clear", () => {
  it("keeps the key when handed an unset env var", () => {
    state.setConfig({ apiKey: "MY-KEY" });

    // Exactly what `config({ apiKey: process.env.FASTNEAR_API_KEY })`
    // evaluates to when the variable is not set.
    state.setConfig({ apiKey: undefined });

    expect(state.getConfig().apiKey).toBe("MY-KEY");
  });

  it("still clears the key on an explicit null", () => {
    state.setConfig({ apiKey: "MY-KEY" });
    state.setConfig({ apiKey: null });

    expect(state.getConfig().apiKey).toBeNull();
  });

  it("still clears the key on an explicit empty string", () => {
    state.setConfig({ apiKey: "MY-KEY" });
    state.setConfig({ apiKey: "   " });

    expect(state.getConfig().apiKey).toBeNull();
  });

  it("still sets a key normally", () => {
    state.setConfig({ apiKey: "FIRST" });
    state.setConfig({ apiKey: "SECOND" });

    expect(state.getConfig().apiKey).toBe("SECOND");
  });
});

describe("retry.enabled: false disables retries, not the request deadline", () => {
  it("still arms the per-attempt abort signal", async () => {
    const seen: (AbortSignal | undefined)[] = [];

    await runWithRetry(
      { ...DEFAULT_RETRY, enabled: false, timeoutMs: 5_000 },
      false,
      async (signal) => {
        seen.push(signal);
        return { kind: "ok", value: null } as any;
      },
    );

    // Used to be gated on `enabled`, so turning off retries left a hung RPC
    // with nothing to abort it — while getConfig().retry.timeoutMs still
    // reported the timeout armed.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it("makes exactly one attempt when retries are off", async () => {
    let attempts = 0;

    await runWithRetry(
      { ...DEFAULT_RETRY, enabled: false, timeoutMs: 5_000 },
      false,
      async () => {
        attempts++;
        return { kind: "retryable", error: new Error("boom") } as any;
      },
    );

    expect(attempts).toBe(1);
  });

  it("passes no signal when the deadline is explicitly zero", async () => {
    const seen: (AbortSignal | undefined)[] = [];

    await runWithRetry(
      { ...DEFAULT_RETRY, enabled: false, timeoutMs: 0 },
      false,
      async (signal) => {
        seen.push(signal);
        return { kind: "ok", value: null } as any;
      },
    );

    expect(seen[0]).toBeUndefined();
  });
});

describe("requestSignIn keeps the public key the wallet returned", () => {
  const PUBLIC_KEY = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";

  function provider(result: Record<string, unknown>) {
    return {
      connect: vi.fn(async () => result),
      restore: vi.fn(async () => null),
      disconnect: vi.fn(async () => {}),
      sendTransaction: vi.fn(async () => ({})),
      accountId: vi.fn(() => "alice.near"),
      isConnected: vi.fn(() => true),
    };
  }

  it("stores it, so publicKey() is not null for a wallet session", async () => {
    state.setWalletProvider(
      provider({ accountId: "alice.near", network: "mainnet", publicKey: PUBLIC_KEY }) as any,
    );

    await requestSignIn({});

    expect(state.getAccountState("mainnet").publicKey).toBe(PUBLIC_KEY);
  });

  it("does not clobber an existing key when the provider omits one", async () => {
    state.updateAccountState({ publicKey: PUBLIC_KEY }, "mainnet");
    state.setWalletProvider(provider({ accountId: "alice.near", network: "mainnet" }) as any);

    await requestSignIn({});

    expect(state.getAccountState("mainnet").publicKey).toBe(PUBLIC_KEY);
  });
});
