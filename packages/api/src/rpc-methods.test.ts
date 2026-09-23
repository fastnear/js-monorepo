import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "@fastnear/utils";
import { gasPrice, queryAccessKeyList, queryGasKeyNonces, status, validators, state } from "./near.js";
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

describe("queryGasKeyNonces", () => {
  const base = { accountId: "alice.near", publicKey: "ed25519:1thX6LZfHDZZKUs92febYZhYRcXddmzfzF2NvTkPNE" };

  it("sends query/view_gas_key_nonces with optimistic finality by default", async () => {
    const res = await queryGasKeyNonces(base);
    expect(calls.at(-1)).toEqual({
      method: "query",
      params: {
        request_type: "view_gas_key_nonces",
        account_id: "alice.near",
        public_key: base.publicKey,
        finality: "optimistic",
      },
    });
    expect(res).toEqual({ result: { ok: true } });
  });

  it("honours blockId as finality or block_id", async () => {
    await queryGasKeyNonces({ ...base, blockId: "final" });
    expect(calls.at(-1)!.params.finality).toBe("final");
    await queryGasKeyNonces({ ...base, blockId: "somehash" });
    expect(calls.at(-1)!.params.block_id).toBe("somehash");
  });
});

describe("queryAccessKeyList pagination", () => {
  it("omits after_key/limit by default and forwards them when given", async () => {
    await queryAccessKeyList({ accountId: "alice.near" });
    expect(calls.at(-1)!.params).toEqual({
      request_type: "view_access_key_list",
      account_id: "alice.near",
      finality: "optimistic",
    });
    await queryAccessKeyList({ accountId: "alice.near", afterKey: "ed25519:abc", limit: 100, blockId: "final" });
    expect(calls.at(-1)!.params).toEqual({
      request_type: "view_access_key_list",
      account_id: "alice.near",
      after_key: "ed25519:abc",
      limit: 100,
      finality: "final",
    });
  });
});
