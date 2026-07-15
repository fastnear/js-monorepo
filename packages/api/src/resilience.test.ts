import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { memoryStore } from "@fastnear/utils";

import { sendRpc, config } from "./near.js";
import * as state from "./state.js";
import { NETWORKS, DEFAULT_RETRY } from "./state.js";
import { __resetBatchState } from "./batch.js";
import { computeBackoffMs, parseRetryAfter, type HttpOnceOutcome } from "./resilience.js";
import { FastNearRpcError } from "./errors.js";
import type { ResolvedRetryConfig } from "./state.js";

const originalFetch = global.fetch;

function httpResponse(
  payload: any,
  init: { ok?: boolean; status?: number; statusText?: string; headers?: Record<string, string> } = {},
) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? status < 400,
    status,
    statusText: init.statusText ?? "OK",
    headers: new Headers(init.headers ?? {}),
    text: async () => text,
    json: async () => (typeof payload === "string" ? JSON.parse(payload) : payload),
  };
}

const okEnvelope = (value: any = { ok: true }) => httpResponse({ jsonrpc: "2.0", id: "x", result: value });

function reset() {
  memoryStore.clear();
  // Reset retry/batch to defaults explicitly — config()'s partial-update merge
  // otherwise preserves a prior test's retry settings across resets.
  state.setConfig({
    ...NETWORKS.mainnet,
    apiKey: null,
    retry: { ...DEFAULT_RETRY },
    batch: { maxConcurrency: 30 },
  });
  __resetBatchState();
  global.fetch = vi.fn();
}

beforeEach(reset);
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const fetchCalls = () => (global.fetch as any).mock.calls.length;

describe("parseRetryAfter", () => {
  it("parses a seconds count", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("parses an HTTP-date", () => {
    const when = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfter(when);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(3000);
    expect(ms!).toBeLessThanOrEqual(6000);
  });

  it("returns null for garbage or missing", () => {
    expect(parseRetryAfter("not-a-date")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
  });
});

describe("computeBackoffMs", () => {
  const cfg: ResolvedRetryConfig = {
    enabled: true,
    maxAttempts: 5,
    baseBackoffMs: 250,
    maxBackoffMs: 30_000,
    timeoutMs: 15_000,
    respectRetryAfter: true,
    writePolicy: "transport-only",
  };
  const rl = (retryAfterMs: number | null): Extract<HttpOnceOutcome, { kind: "retry" }> => ({
    kind: "retry",
    reason: "rate_limited",
    status: 429,
    retryAfterMs,
    giveUp: () => new Error(),
  });
  const transient = (): Extract<HttpOnceOutcome, { kind: "retry" }> => ({
    kind: "retry",
    reason: "transient",
    status: 500,
    retryAfterMs: null,
    giveUp: () => new Error(),
  });

  it("honors Retry-After exactly, capped at maxBackoffMs", () => {
    expect(computeBackoffMs(cfg, 1, rl(2000))).toBe(2000);
    expect(computeBackoffMs(cfg, 1, rl(99_999_999))).toBe(30_000);
  });

  it("uses full-jitter exponential for transient failures", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(computeBackoffMs(cfg, 1, transient())).toBe(250); // 250 * 2^0
    expect(computeBackoffMs(cfg, 3, transient())).toBe(1000); // 250 * 2^2
  });
});

describe("sendRpc retry behavior", () => {
  it("retries a 429 then resolves", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    (global.fetch as any)
      .mockResolvedValueOnce(httpResponse({}, { status: 429 }))
      .mockResolvedValueOnce(httpResponse({}, { status: 429 }))
      .mockResolvedValue(okEnvelope({ hi: 1 }));
    const res = await sendRpc("status", []);
    expect(res.result).toEqual({ hi: 1 });
    expect(fetchCalls()).toBe(3);
  });

  it("gives up after maxAttempts with a typed, legacy-shaped error", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    (global.fetch as any).mockResolvedValue(httpResponse({ msg: "slow down" }, { status: 429 }));
    config({ retry: { maxAttempts: 3 } });
    const err = await sendRpc("status", []).catch((e) => e);
    expect(err).toBeInstanceOf(FastNearRpcError);
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(JSON.parse(err.message).code).toBe(429);
    expect(fetchCalls()).toBe(3);
  });

  it("does not retry terminal HTTP errors (402/401/403)", async () => {
    for (const status of [402, 401, 403]) {
      reset();
      (global.fetch as any).mockResolvedValue(httpResponse({ error: "nope" }, { status }));
      const err = await sendRpc("status", []).catch((e) => e);
      expect(err).toBeInstanceOf(FastNearRpcError);
      expect(err.status).toBe(status);
      expect(fetchCalls()).toBe(1);
    }
  });

  it("retries a -32000 rpc error then resolves", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    (global.fetch as any)
      .mockResolvedValueOnce(httpResponse({ jsonrpc: "2.0", id: "x", error: { code: -32000, message: "server error" } }))
      .mockResolvedValue(okEnvelope({ ok: 1 }));
    const res = await sendRpc("status", []);
    expect(res.result).toEqual({ ok: 1 });
    expect(fetchCalls()).toBe(2);
  });

  it("retries a JSON-RPC -429 body then resolves", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    (global.fetch as any)
      .mockResolvedValueOnce(httpResponse({ jsonrpc: "2.0", id: "x", error: { code: -429, message: "rate limited" } }))
      .mockResolvedValue(okEnvelope(1));
    const res = await sendRpc("status", []);
    expect(res.result).toBe(1);
    expect(fetchCalls()).toBe(2);
  });

  it("does not retry a non-retryable rpc error code", async () => {
    (global.fetch as any).mockResolvedValue(
      httpResponse({ jsonrpc: "2.0", id: "x", error: { code: -32601, message: "method not found" } }),
    );
    const err = await sendRpc("nope", []).catch((e) => e);
    expect(err).toBeInstanceOf(FastNearRpcError);
    expect(err.kind).toBe("rpc");
    expect(JSON.parse(err.message).code).toBe(-32601);
    expect(fetchCalls()).toBe(1);
  });

  it("does not retry a deterministic -32000 HANDLER_ERROR (e.g. unknown account)", async () => {
    (global.fetch as any).mockResolvedValue(
      httpResponse({
        jsonrpc: "2.0",
        id: "x",
        error: { code: -32000, name: "HANDLER_ERROR", message: "Server error", data: "account x.near does not exist while viewing" },
      }),
    );
    const err = await sendRpc("query", {}).catch((e) => e);
    expect(err).toBeInstanceOf(FastNearRpcError);
    expect(err.kind).toBe("rpc");
    expect(fetchCalls()).toBe(1); // deterministic → not retried
  });

  it("surfaces a contract execution failure as kind 'contract' and does not retry", async () => {
    (global.fetch as any).mockResolvedValue(
      httpResponse({
        jsonrpc: "2.0",
        id: "x",
        result: { error: "wasm execution failed with error: MethodResolveError(MethodNotFound)", block_height: 1, logs: [] },
      }),
    );
    const err = await sendRpc("query", {}).catch((e) => e);
    expect(err).toBeInstanceOf(FastNearRpcError);
    expect(err.kind).toBe("contract");
    expect(err.retryable).toBe(false);
    expect(fetchCalls()).toBe(1);
  });

  it("classifies a transport failure as kind 'transport' (and retries it)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    (global.fetch as any).mockRejectedValue(new Error("ECONNRESET"));
    config({ retry: { maxAttempts: 2 } });
    const err = await sendRpc("status", []).catch((e) => e);
    expect(err).toBeInstanceOf(FastNearRpcError);
    expect(err.kind).toBe("transport");
    expect(err.retryable).toBe(true);
    expect(fetchCalls()).toBe(2);
  });

  it("does not retry when disabled (matches legacy single-fetch behavior)", async () => {
    config({ retry: { enabled: false } });
    (global.fetch as any).mockResolvedValue(httpResponse({}, { status: 429 }));
    await expect(sendRpc("status", [])).rejects.toThrow();
    expect(fetchCalls()).toBe(1);
  });

  it("waits the backoff before retrying (fake timers)", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1); // jitter → full exp (250ms at attempt 1)
    (global.fetch as any)
      .mockResolvedValueOnce(httpResponse({}, { status: 503 }))
      .mockResolvedValue(okEnvelope(1));
    let resolved = false;
    const p = sendRpc("status", []).then((r) => {
      resolved = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(0); // first attempt returns transient
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(249);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1); // 250ms elapsed → second attempt
    await p;
    expect(resolved).toBe(true);
    expect(fetchCalls()).toBe(2);
  });
});

describe("write safety (writePolicy)", () => {
  it("retries a write on a pre-response transport error, resending identical bytes", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    (global.fetch as any)
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue(okEnvelope({ ok: 1 }));
    const res = await sendRpc("send_tx", { signed_tx_base64: "abc", wait_until: "INCLUDED" });
    expect(res.result).toEqual({ ok: 1 });
    const calls = (global.fetch as any).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][1].body).toBe(calls[1][1].body); // byte-identical resend
  });

  it("does NOT retry a write on a 429 by default (transport-only)", async () => {
    (global.fetch as any).mockResolvedValue(httpResponse({}, { status: 429 }));
    await expect(sendRpc("send_tx", { x: 1 })).rejects.toThrow();
    expect(fetchCalls()).toBe(1);
  });

  it("retries a write on 429 when writePolicy is 'all'", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    config({ retry: { writePolicy: "all", maxAttempts: 3 } });
    (global.fetch as any)
      .mockResolvedValueOnce(httpResponse({}, { status: 429 }))
      .mockResolvedValue(okEnvelope(1));
    const res = await sendRpc("send_tx", { x: 1 });
    expect(res.result).toBe(1);
    expect(fetchCalls()).toBe(2);
  });
});
