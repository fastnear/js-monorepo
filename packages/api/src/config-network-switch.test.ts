import { beforeEach, describe, expect, it } from "vitest";
import { lsGet, memoryStore } from "@fastnear/utils";
import { state } from "./near.js";
import { DEFAULT_RETRY, NETWORKS, resolveConfig } from "./state.js";

// `setConfig` has to answer two questions at once when the networkId changes:
// which fields describe *the chain* (reset them) and which describe *this
// client* (keep them).
//
// It used to answer only the first, by handing `resolveConfig` a base of
// `NETWORKS[nextNetworkId]` — a pristine default carrying no apiKey, no retry
// and no batch. So the documented two-liner
//
//     near.config({ apiKey });
//     near.config({ networkId: "testnet" });
//
// silently reset the key to null, retry to DEFAULT_RETRY, and batch to {}. An
// unauthenticated client is indistinguishable from a rate-limited one, so it
// surfaced as mysterious 429s rather than as an error.
//
// Both halves of the truth table are pinned here: the carried-over rows are
// the behaviour that changed, the reset rows must keep behaving as they did.

/** Put the client on mainnet with a known set of caller-supplied settings. */
function seedMainnet() {
  state.setConfig({
    ...NETWORKS.mainnet,
    apiKey: "SECRET-KEY",
    retry: { maxAttempts: 9, baseBackoffMs: 1234 },
    batch: { maxConcurrency: 3 },
  });
}

beforeEach(() => {
  memoryStore.clear();
  state.setConfig({ ...NETWORKS.mainnet, apiKey: null });
});

describe("setConfig across a network switch — settings that must carry over", () => {
  it("keeps the apiKey", () => {
    seedMainnet();
    expect(state.getConfig().apiKey).toBe("SECRET-KEY");

    state.setConfig({ networkId: "testnet" });

    expect(state.getConfig().networkId).toBe("testnet");
    expect(state.getConfig().apiKey).toBe("SECRET-KEY");
  });

  it("keeps retry settings", () => {
    seedMainnet();
    state.setConfig({ networkId: "testnet" });

    expect(state.getConfig().retry?.maxAttempts).toBe(9);
    expect(state.getConfig().retry?.baseBackoffMs).toBe(1234);
    // Untouched retry fields still fall back to the defaults.
    expect(state.getConfig().retry?.timeoutMs).toBe(DEFAULT_RETRY.timeoutMs);
  });

  it("keeps batch settings", () => {
    seedMainnet();
    state.setConfig({ networkId: "testnet" });

    expect(state.getConfig().batch?.maxConcurrency).toBe(3);
  });

  it("keeps caller-added keys allowed by the index signature", () => {
    state.setConfig({ ...NETWORKS.mainnet, apiKey: "K", tenantId: "acme" });
    state.setConfig({ networkId: "testnet" });

    expect(state.getConfig().tenantId).toBe("acme");
  });

  it("carries settings through the string form too", () => {
    seedMainnet();
    state.setConfig("testnet");

    expect(state.getConfig().networkId).toBe("testnet");
    expect(state.getConfig().apiKey).toBe("SECRET-KEY");
    expect(state.getConfig().retry?.maxAttempts).toBe(9);
  });

  it("survives a round trip back to the original network", () => {
    seedMainnet();
    state.setConfig({ networkId: "testnet" });
    state.setConfig({ networkId: "mainnet" });

    expect(state.getConfig().apiKey).toBe("SECRET-KEY");
    expect(state.getConfig().retry?.maxAttempts).toBe(9);
    expect(state.getConfig().batch?.maxConcurrency).toBe(3);
  });

  it("persists the carried settings, so a reload sees them", () => {
    seedMainnet();
    state.setConfig({ networkId: "testnet" });

    // Exactly what module load does: `resolveConfig(lsGet("config"))`.
    const restored = resolveConfig(lsGet("config"));

    expect(restored.networkId).toBe("testnet");
    expect(restored.apiKey).toBe("SECRET-KEY");
    expect(restored.retry?.maxAttempts).toBe(9);
  });
});

describe("setConfig across a network switch — chain-scoped fields that must reset", () => {
  it("moves nodeUrl and the rpc base URL to the new network", () => {
    seedMainnet();
    expect(state.getConfig().nodeUrl).toBe(NETWORKS.mainnet.nodeUrl);

    state.setConfig({ networkId: "testnet" });

    expect(state.getConfig().nodeUrl).toBe(NETWORKS.testnet.nodeUrl);
    expect(state.getConfig().services?.rpc?.baseUrl).toBe(
      NETWORKS.testnet.services?.rpc?.baseUrl,
    );
  });

  it("moves every service base URL, including ones that differ per network", () => {
    seedMainnet();
    state.setConfig({ networkId: "testnet" });

    const services = state.getConfig().services;
    expect(services?.api?.baseUrl).toBe(NETWORKS.testnet.services?.api?.baseUrl);
    expect(services?.tx?.baseUrl).toBe(NETWORKS.testnet.services?.tx?.baseUrl);
    expect(services?.neardata?.baseUrl).toBe(NETWORKS.testnet.services?.neardata?.baseUrl);
    expect(services?.fastdata?.kvBaseUrl).toBe(NETWORKS.testnet.services?.fastdata?.kvBaseUrl);
    // testnet has no transfers service; mainnet's must not leak across.
    expect(services?.transfers?.baseUrl).toBeNull();
  });

  it("does not carry a custom rpc base URL onto the other network", () => {
    state.setConfig({
      ...NETWORKS.mainnet,
      services: { rpc: { baseUrl: "https://my-private-mainnet-rpc.example" } },
    });
    expect(state.getConfig().services?.rpc?.baseUrl).toBe(
      "https://my-private-mainnet-rpc.example",
    );

    state.setConfig({ networkId: "testnet" });

    expect(state.getConfig().services?.rpc?.baseUrl).toBe(
      NETWORKS.testnet.services?.rpc?.baseUrl,
    );
  });
});

describe("setConfig without a network change — unchanged behaviour", () => {
  it("still merges partial updates instead of clobbering siblings", () => {
    seedMainnet();
    state.setConfig({ retry: { maxAttempts: 2 } });

    expect(state.getConfig().apiKey).toBe("SECRET-KEY");
    expect(state.getConfig().retry?.maxAttempts).toBe(2);
    expect(state.getConfig().retry?.baseBackoffMs).toBe(1234);
    expect(state.getConfig().batch?.maxConcurrency).toBe(3);
  });

  it("still lets an explicit value in the same call win over the carried one", () => {
    seedMainnet();
    state.setConfig({ networkId: "testnet", apiKey: "OTHER-KEY" });

    expect(state.getConfig().apiKey).toBe("OTHER-KEY");
  });

  it("still lets a switch explicitly clear the key", () => {
    seedMainnet();
    state.setConfig({ networkId: "testnet", apiKey: null });

    expect(state.getConfig().apiKey).toBeNull();
  });
});
