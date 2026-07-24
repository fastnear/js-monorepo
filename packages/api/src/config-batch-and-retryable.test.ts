import { beforeEach, describe, expect, it } from "vitest";
import { memoryStore } from "@fastnear/utils";
import { explain, state } from "./near.js";
import { NETWORKS } from "./state.js";

// Two introspection defects where the client's answer disagreed with what it
// actually does — #47 (config().batch) and #48 (explain.error().retryable).

beforeEach(() => {
  memoryStore.clear();
  state.setConfig({ ...NETWORKS.mainnet, apiKey: null });
  state.setActiveNetwork("mainnet");
});

describe("config().batch reads back fully resolved (#47)", () => {
  it("surfaces the effective maxConcurrency default instead of {}", () => {
    // Used to read back {} even though the bulk path applies 30.
    expect(state.getConfig().batch).toEqual({ maxConcurrency: 30 });
  });

  it("reflects an explicit value", () => {
    state.setConfig({ batch: { maxConcurrency: 5 } });
    expect(state.getConfig().batch).toEqual({ maxConcurrency: 5 });
  });

  it("clamps and floors like the resolver", () => {
    state.setConfig({ batch: { maxConcurrency: 0 } });
    expect(state.getConfig().batch).toEqual({ maxConcurrency: 1 });
  });

  it("carries across a network switch and stays resolved", () => {
    state.setConfig({ batch: { maxConcurrency: 7 } });
    state.setConfig({ networkId: "testnet" });
    expect(state.getConfig().batch).toEqual({ maxConcurrency: 7 });
  });

  it("matches retry's already-resolved read-back shape", () => {
    const c = state.getConfig();
    expect(typeof c.retry?.maxAttempts).toBe("number");
    expect(typeof c.batch?.maxConcurrency).toBe("number");
  });
});

describe("explain.error().retryable matches what the transport retries (#48)", () => {
  const explained = (code: number) => explain.error({ code, message: `origin returned HTTP ${code}` });

  it("reports the Cloudflare edge codes the transport retries", () => {
    // isRetryableStatus retries any >=500, so these ARE retried; the old closed
    // display set [408,429,500,502,503,504] wrongly reported them non-retryable.
    for (const code of [520, 522, 524]) {
      expect(explained(code).retryable, `HTTP ${code}`).toBe(true);
    }
  });

  it("still reports the classic 5xx / 408 / 429 as retryable", () => {
    for (const code of [408, 429, 500, 502, 503, 504]) {
      expect(explained(code).retryable, `HTTP ${code}`).toBe(true);
    }
  });

  it("still treats JSON-RPC -429 / -32000 as retryable", () => {
    expect(explained(-429).retryable).toBe(true);
    expect(explained(-32000).retryable).toBe(true);
  });

  it("does not over-retry deterministic client errors", () => {
    for (const code of [400, 401, 403, 404, -32601, -32602]) {
      expect(explained(code).retryable, `code ${code}`).toBe(false);
    }
  });
});
