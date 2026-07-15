import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { memoryStore } from "@fastnear/utils";

import { batch, config, view } from "./near.js";
import * as state from "./state.js";
import { NETWORKS, DEFAULT_RETRY } from "./state.js";
import { __resetBatchState, mapWithConcurrency, resolveBatchConfig } from "./batch.js";

const originalFetch = global.fetch;

function jsonResponse(payload: any, init: { status?: number } = {}) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const status = init.status ?? 200;
  return {
    ok: status < 400,
    status,
    statusText: "OK",
    headers: new Headers(),
    text: async () => text,
    json: async () => (typeof payload === "string" ? JSON.parse(payload) : payload),
  };
}

const bytesOf = (value: any): number[] => Array.from(new TextEncoder().encode(JSON.stringify(value)));
const calls = () => (global.fetch as any).mock.calls;
const bodyOf = (i: number) => JSON.parse(calls()[i][1].body);

// A fetch that echoes result keyed off the (single, non-array) request body.
function installFetch(resultFor: (req: any) => any) {
  global.fetch = vi.fn(async (_url: any, init: any) => {
    const sent = JSON.parse(init.body);
    return jsonResponse({ jsonrpc: "2.0", id: sent.id, result: resultFor(sent) });
  }) as any;
}

function reset() {
  memoryStore.clear();
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
});

describe("mapWithConcurrency", () => {
  it("preserves order and caps in-flight count", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency(Array.from({ length: 7 }, (_, i) => i), 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(peak).toBe(3); // saturates but never exceeds the limit
  });

  it("handles empty and single-item inputs", async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([9], 5, async (n) => n + 1)).toEqual([10]);
  });
});

describe("resolveBatchConfig", () => {
  it("defaults maxConcurrency to 30 and clamps to >= 1", () => {
    expect(resolveBatchConfig({}).maxConcurrency).toBe(30);
    expect(resolveBatchConfig({ batch: { maxConcurrency: 5 } }).maxConcurrency).toBe(5);
    expect(resolveBatchConfig({ batch: { maxConcurrency: 0 } }).maxConcurrency).toBe(1);
  });
});

describe("read helpers stay single requests", () => {
  it("sends a lone view as one bare-object request", async () => {
    installFetch(() => ({ result: bytesOf("v") }));
    const v = await view({ contractId: "c.near", methodName: "m" });
    expect(v).toBe("v");
    expect(calls().length).toBe(1);
    expect(Array.isArray(bodyOf(0))).toBe(false);
    expect(bodyOf(0).method).toBe("query");
    expect(typeof bodyOf(0).id).toBe("string");
  });
});

describe("near.batch (concurrency-limited fan-out)", () => {
  it("sends one request per call, settled and ordered", async () => {
    installFetch((r) => ({ echo: r.method }));
    const res = await batch([
      { method: "block", params: { finality: "final" } },
      { method: "status", params: [] },
    ]);
    expect(res.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect((res[0] as any).result.result).toEqual({ echo: "block" });
    expect((res[1] as any).result.result).toEqual({ echo: "status" });
    expect(calls().length).toBe(2);
    calls().forEach((_c: any, i: number) => expect(Array.isArray(bodyOf(i))).toBe(false));
  });

  it("isolates a failing item without rejecting the set", async () => {
    global.fetch = vi.fn(async (_url: any, init: any) => {
      const b = JSON.parse(init.body);
      return b.method === "boom"
        ? jsonResponse({ jsonrpc: "2.0", id: b.id, error: { code: -32601, message: "no method" } })
        : jsonResponse({ jsonrpc: "2.0", id: b.id, result: 1 });
    }) as any;
    const res = await batch([
      { method: "status", params: [] },
      { method: "boom", params: [] },
    ]);
    expect(res[0].status).toBe("ok");
    expect(res[1]).toMatchObject({ status: "error", kind: "rpc" });
  });

  it("settles a malformed request item instead of rejecting the whole set", async () => {
    installFetch(() => ({ ok: 1 }));
    const res = await batch([{ method: "status", params: [] }, null as any]);
    expect(res[0].status).toBe("ok");
    expect(res[1].status).toBe("error");
    expect(calls().length).toBe(1); // only the valid item reached the network
  });

  it("rejects write methods per-item without any fetch", async () => {
    global.fetch = vi.fn() as any;
    const res = await batch([
      { method: "send_tx", params: { signed_tx_base64: "x" } },
      { method: "broadcast_tx_async", params: { signed_tx_base64: "y" } },
    ]);
    expect(res.map((r) => r.status)).toEqual(["error", "error"]);
    expect(res.every((r) => r.status === "error" && (r as any).kind === "unknown")).toBe(true);
    expect(calls().length).toBe(0);
  });

  it("honors maxConcurrency", async () => {
    config({ batch: { maxConcurrency: 2 } });
    let inFlight = 0;
    let peak = 0;
    global.fetch = vi.fn(async (_url: any, init: any) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const b = JSON.parse(init.body);
      return jsonResponse({ jsonrpc: "2.0", id: b.id, result: 1 });
    }) as any;
    await batch(Array.from({ length: 6 }, () => ({ method: "status", params: [] })));
    expect(peak).toBe(2);
    expect(calls().length).toBe(6);
  });

  it("retries a 429 on an individual item", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    let n = 0;
    global.fetch = vi.fn(async (_url: any, init: any) => {
      n++;
      if (n === 1) return jsonResponse({}, { status: 429 });
      const b = JSON.parse(init.body);
      return jsonResponse({ jsonrpc: "2.0", id: b.id, result: "ok" });
    }) as any;
    const res = await batch([{ method: "status", params: [] }]);
    expect(res[0]).toEqual({ status: "ok", result: { jsonrpc: "2.0", id: expect.any(String), result: "ok" } });
    expect(n).toBe(2);
  });
});

describe("near.view.many", () => {
  it("fans out and decodes each result like view()", async () => {
    installFetch((r) => ({ result: bytesOf({ m: r.params.method_name }) }));
    const res = await view.many([
      { contractId: "t.near", methodName: "ft_metadata" },
      { contractId: "t.near", methodName: "ft_total_supply" },
    ]);
    expect(res[0]).toEqual({ status: "ok", result: { m: "ft_metadata" } });
    expect(res[1]).toEqual({ status: "ok", result: { m: "ft_total_supply" } });
    expect(calls().length).toBe(2);
  });

  it("settles a per-item bad response instead of rejecting the whole set", async () => {
    global.fetch = vi.fn(async (_url: any, init: any) => {
      const b = JSON.parse(init.body);
      return b.params.method_name === "bad"
        ? jsonResponse({ jsonrpc: "2.0", id: b.id }) // no `result` → viewImpl decode access throws
        : jsonResponse({ jsonrpc: "2.0", id: b.id, result: { result: bytesOf("ok") } });
    }) as any;
    const res = await view.many([
      { contractId: "c.near", methodName: "good" },
      { contractId: "c.near", methodName: "bad" },
    ]);
    expect(res[0]).toEqual({ status: "ok", result: "ok" });
    expect(res[1].status).toBe("error");
  });

  it("tags a contract execution failure as kind 'contract'", async () => {
    global.fetch = vi.fn(async (_url: any, init: any) => {
      const b = JSON.parse(init.body);
      return jsonResponse({
        jsonrpc: "2.0",
        id: b.id,
        result: { error: "wasm execution failed with error: MethodResolveError(MethodNotFound)", logs: [] },
      });
    }) as any;
    const res = await view.many([{ contractId: "c.near", methodName: "nope" }]);
    expect(res[0]).toMatchObject({ status: "error", kind: "contract" });
  });
});
