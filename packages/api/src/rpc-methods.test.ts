import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "@fastnear/utils";
import { gasPrice, status, validators, state } from "./near.js";
import { NETWORKS } from "./state.js";

const originalFetch = global.fetch;
let calls: { method: string; params: any }[] = [];

function jsonResponse(payload: any) {
  return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify(payload) };
}

beforeEach(() => {
  calls = [];
  memoryStore.clear();
  state.setConfig({ ...NETWORKS.mainnet, apiKey: null });
  global.fetch = vi.fn(async (_url: any, request: any) => {
    const body = JSON.parse(String(request?.body));
    calls.push({ method: body.method, params: body.params });
    return jsonResponse({ result: { ok: true } });
  }) as any;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("core RPC wrappers", () => {
  it("gasPrice defaults to latest, accepts a blockId, returns the envelope", async () => {
    const res = await gasPrice();
    expect(calls.at(-1)).toEqual({ method: "gas_price", params: [null] });
    expect(res).toEqual({ result: { ok: true } });

    await gasPrice({ blockId: 12345 });
    expect(calls.at(-1)).toEqual({ method: "gas_price", params: [12345] });
  });

  it("status sends no params", async () => {
    await status();
    expect(calls.at(-1)).toEqual({ method: "status", params: [] });
  });

  it("validators defaults to the current epoch, accepts a blockId", async () => {
    await validators();
    expect(calls.at(-1)).toEqual({ method: "validators", params: [null] });

    await validators({ blockId: "somehash" });
    expect(calls.at(-1)).toEqual({ method: "validators", params: ["somehash"] });
  });
});
