import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { memoryStore } from "@fastnear/utils";

import {
  actions,
  api,
  config,
  explain,
  fastdata,
  neardata,
  print,
  queryAccessKey,
  queryAccount,
  queryBlock,
  queryTx,
  recipes,
  selected,
  state,
  transfers,
  tx,
  useWallet,
  view,
  withBlockId,
} from "./near.js";
import { NETWORKS } from "./state.js";
import type {
  FastNearApiV1AccountFullResponse,
  FastNearKvGetLatestKeyResponse,
  FastNearNeardataLastBlockFinalResponse,
  FastNearRecipeDiscoveryEntry,
  FastNearRecipeViewAccountResult,
  FastNearRpcQueryAccountResponse,
  FastNearTransfersQueryResponse,
  FastNearTxTransactionsResponse,
} from "./types.js";

const originalFetch = global.fetch;

function createWalletProvider(overrides: Record<string, any> = {}) {
  return {
    connect: vi.fn().mockResolvedValue({ accountId: "root.near" }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendTransaction: vi.fn().mockResolvedValue({ ok: true }),
    signMessage: vi.fn().mockResolvedValue({ signature: "ed25519:signature" }),
    accountId: vi.fn().mockReturnValue("root.near"),
    isConnected: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

function jsonResponse(payload: any, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);

  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    text: async () => text,
    json: async () => (typeof payload === "string" ? JSON.parse(payload) : payload),
  };
}

function resetTestState() {
  memoryStore.clear();
  state.setWalletProvider(null as any);
  state.resetTxHistory();
  state.setConfig({
    ...NETWORKS.mainnet,
    apiKey: null,
  });
  state.update({
    accountId: null,
    privateKey: null,
    lastWalletId: null,
    accessKeyContractId: null,
  });
  global.fetch = vi.fn();
}

function mockFetch(payload: any) {
  (global.fetch as any).mockResolvedValue(jsonResponse(payload));
}

function getFetchCall(index = 0) {
  const call = (global.fetch as any).mock.calls[index];
  if (!call) {
    throw new Error(`Expected fetch call at index ${index}`);
  }

  const [url, request = {}] = call;
  return {
    url: String(url),
    request,
    body: request.body ? JSON.parse(String(request.body)) : undefined,
  };
}

function expectUrl(
  actualUrl: string,
  expectedBaseUrl: string,
  expectedPath = "/",
  expectedQuery: Record<string, string | number | boolean | undefined> = {}
) {
  const actual = new URL(actualUrl);
  const expected = new URL(expectedPath.replace(/^\/+/, ""), expectedBaseUrl.endsWith("/") ? expectedBaseUrl : `${expectedBaseUrl}/`);

  expect(`${actual.origin}${actual.pathname}`).toBe(`${expected.origin}${expected.pathname}`);
  expect(Object.fromEntries(actual.searchParams.entries())).toEqual(
    Object.fromEntries(
      Object.entries(expectedQuery)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)])
    )
  );
}

beforeEach(() => {
  resetTestState();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("near.config", () => {
  it("returns normalized family defaults and a mirrored rpc base URL", () => {
    const resolved = config();

    expect(resolved.networkId).toBe("mainnet");
    expect(resolved.nodeUrl).toBe("https://rpc.mainnet.fastnear.com/");
    expect(resolved.services?.rpc?.baseUrl).toBe("https://rpc.mainnet.fastnear.com/");
    expect(resolved.services?.api?.baseUrl).toBe("https://api.fastnear.com");
    expect(resolved.services?.tx?.baseUrl).toBe("https://tx.main.fastnear.com");
    expect(resolved.services?.transfers?.baseUrl).toBe("https://transfers.main.fastnear.com");
    expect(resolved.services?.neardata?.baseUrl).toBe("https://mainnet.neardata.xyz");
    expect(resolved.services?.fastdata?.kvBaseUrl).toBe("https://kv.main.fastnear.com");
  });

  it("supports apiKey as a first-class config field and clears blank keys", () => {
    expect(config({ apiKey: "demo-key" }).apiKey).toBe("demo-key");
    expect(config({ apiKey: "" }).apiKey).toBeNull();
    expect(config({ apiKey: null }).apiKey).toBeNull();
  });

  it("keeps nodeUrl overrides backward compatible and mirrors them into rpc services", () => {
    const resolved = config({ nodeUrl: "https://custom.rpc.fastnear.test/" });

    expect(resolved.nodeUrl).toBe("https://custom.rpc.fastnear.test/");
    expect(resolved.services?.rpc?.baseUrl).toBe("https://custom.rpc.fastnear.test/");
    expect(selected().nodeUrl).toBe("https://custom.rpc.fastnear.test/");
  });

  it("switches network defaults when networkId changes", () => {
    const resolved = config({ networkId: "testnet" });

    expect(resolved.networkId).toBe("testnet");
    expect(resolved.nodeUrl).toBe("https://rpc.testnet.fastnear.com/");
    expect(resolved.services?.api?.baseUrl).toBe("https://test.api.fastnear.com");
    expect(resolved.services?.tx?.baseUrl).toBe("https://tx.test.fastnear.com");
    expect(resolved.services?.transfers?.baseUrl).toBeNull();
    expect(resolved.services?.fastdata?.kvBaseUrl).toBe("https://kv.test.fastnear.com");
  });
});

describe("RPC helpers", () => {
  it("encodes finality and historical block_id through withBlockId", () => {
    expect(withBlockId({ request_type: "view_account" }, undefined)).toEqual({
      request_type: "view_account",
      finality: "optimistic",
    });
    expect(withBlockId({ request_type: "view_account" }, "final")).toEqual({
      request_type: "view_account",
      finality: "final",
    });
    expect(withBlockId({ request_type: "view_account" }, "optimistic")).toEqual({
      request_type: "view_account",
      finality: "optimistic",
    });
    expect(withBlockId({ request_type: "view_account" }, "9rbKPCYX12JpqjEPuLJb6ych736vzRnzPFPjg4UCCps9")).toEqual({
      request_type: "view_account",
      block_id: "9rbKPCYX12JpqjEPuLJb6ych736vzRnzPFPjg4UCCps9",
    });
    expect(withBlockId({ request_type: "view_account" }, "75590392")).toEqual({
      request_type: "view_account",
      block_id: "75590392",
    });
  });

  it("uses optimistic finality by default for queryAccount", async () => {
    mockFetch({
      result: {
        amount: "1",
      },
    });

    await queryAccount({ accountId: "root.near" });

    const { url, request, body } = getFetchCall();
    expectUrl(url, "https://rpc.mainnet.fastnear.com/", "/", {});
    expect(request.method).toBe("POST");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(body.method).toBe("query");
    expect(body.params).toEqual({
      request_type: "view_account",
      account_id: "root.near",
      finality: "optimistic",
    });
  });

  it("applies apiKey to RPC requests as a query parameter", async () => {
    config({ apiKey: "rpc-key" });
    mockFetch({
      result: {
        amount: "1",
      },
    });

    await queryAccount({ accountId: "root.near" });

    const { url, request, body } = getFetchCall();
    expectUrl(url, "https://rpc.mainnet.fastnear.com/", "/", { apiKey: "rpc-key" });
    expect(request.headers.Authorization).toBeUndefined();
    expect(body.params.account_id).toBe("root.near");
  });

  it("routes historical queryAccount reads to block_id on the active RPC host", async () => {
    config({ nodeUrl: "https://archival-rpc.mainnet.fastnear.com/" });
    mockFetch({
      result: {
        amount: "1",
      },
    });

    await queryAccount({
      accountId: "root.near",
      blockId: "9rbKPCYX12JpqjEPuLJb6ych736vzRnzPFPjg4UCCps9",
    });

    const { url, body } = getFetchCall();
    expectUrl(url, "https://archival-rpc.mainnet.fastnear.com/", "/", {});
    expect(body.params).toEqual({
      request_type: "view_account",
      account_id: "root.near",
      block_id: "9rbKPCYX12JpqjEPuLJb6ych736vzRnzPFPjg4UCCps9",
    });
  });

  it("builds block requests against archival RPC overrides", async () => {
    config({ nodeUrl: "https://archival-rpc.mainnet.fastnear.com/" });
    mockFetch({
      result: {
        header: {
          height: 75590392,
        },
      },
    });

    await queryBlock({ blockId: "9rbKPCYX12JpqjEPuLJb6ych736vzRnzPFPjg4UCCps9" });

    const { url, body } = getFetchCall();
    expectUrl(url, "https://archival-rpc.mainnet.fastnear.com/", "/", {});
    expect(body).toMatchObject({
      method: "block",
      params: {
        block_id: "9rbKPCYX12JpqjEPuLJb6ych736vzRnzPFPjg4UCCps9",
      },
    });
  });

  it("encodes function-call args and historical block_id for view", async () => {
    mockFetch({
      result: {
        result: Array.from(new TextEncoder().encode(JSON.stringify({
          account_id: "root.near",
          num_pixels: 123,
        }))),
      },
    });

    const result = await view({
      contractId: "berryclub.ek.near",
      methodName: "get_account",
      args: { account_id: "root.near" },
      blockId: "9rbKPCYX12JpqjEPuLJb6ych736vzRnzPFPjg4UCCps9",
    });

    const { body } = getFetchCall();
    expect(body.method).toBe("query");
    expect(body.params.request_type).toBe("call_function");
    expect(body.params.account_id).toBe("berryclub.ek.near");
    expect(body.params.method_name).toBe("get_account");
    expect(body.params.block_id).toBe("9rbKPCYX12JpqjEPuLJb6ych736vzRnzPFPjg4UCCps9");
    expect(body.params.args_base64).toBe("eyJhY2NvdW50X2lkIjoicm9vdC5uZWFyIn0=");
    expect(result).toMatchObject({
      account_id: "root.near",
      num_pixels: 123,
    });
  });

  it("shapes access-key lookups with the current RPC request contract", async () => {
    mockFetch({
      result: {
        nonce: 1,
      },
    });

    await queryAccessKey({
      accountId: "root.near",
      publicKey: "ed25519:example",
      blockId: "75590392",
    });

    const { body } = getFetchCall();
    expect(body).toMatchObject({
      method: "query",
      params: {
        request_type: "view_access_key",
        account_id: "root.near",
        public_key: "ed25519:example",
        block_id: "75590392",
      },
    });
  });

  it("uses the tx RPC method with a tx hash and signer tuple", async () => {
    mockFetch({
      result: {
        final_execution_status: "FINAL",
      },
    });

    await queryTx({
      txHash: "7HtFWv51k5Bispmh1WYPbAVkxr2X4AL6n98DhcQwVw7w",
      accountId: "root.near",
    });

    const { body } = getFetchCall();
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: expect.any(String),
      method: "tx",
      params: [
        "7HtFWv51k5Bispmh1WYPbAVkxr2X4AL6n98DhcQwVw7w",
        "root.near",
      ],
    });
  });
});

describe("low-level service namespaces", () => {
  it.each([
    {
      label: "accountFull",
      call: () => api.v1.accountFull({ accountId: "root.near" }),
      path: "/v1/account/root.near/full",
      query: {},
    },
    {
      label: "accountFt",
      call: () => api.v1.accountFt({ accountId: "root.near", page_token: "next-page" }),
      path: "/v1/account/root.near/ft",
      query: { page_token: "next-page" },
    },
    {
      label: "accountNft",
      call: () => api.v1.accountNft({ accountId: "root.near", limit: 5 }),
      path: "/v1/account/root.near/nft",
      query: { limit: 5 },
    },
    {
      label: "accountStaking",
      call: () => api.v1.accountStaking({ accountId: "root.near", validator_id: "binance.poolv1.near" }),
      path: "/v1/account/root.near/staking",
      query: { validator_id: "binance.poolv1.near" },
    },
    {
      label: "publicKey",
      call: () => api.v1.publicKey({ publicKey: "ed25519:abc/def" }),
      path: "/v1/public_key/ed25519%3Aabc%2Fdef",
      query: {},
    },
    {
      label: "publicKeyAll",
      call: () => api.v1.publicKeyAll({ publicKey: "ed25519:abc/def", page_token: "next-page" }),
      path: "/v1/public_key/ed25519%3Aabc%2Fdef/all",
      query: { page_token: "next-page" },
    },
    {
      label: "ftTop",
      call: () => api.v1.ftTop({ tokenId: "usdt.tether-token.near", limit: 10 }),
      path: "/v1/ft/usdt.tether-token.near/top",
      query: { limit: 10 },
    },
  ])("routes api.v1.$label to the expected GET endpoint", async ({ call, path, query }) => {
    config({ apiKey: "api-key" });
    mockFetch({ ok: true });

    await call();

    const { url, request } = getFetchCall();
    expectUrl(url, "https://api.fastnear.com", path, query);
    expect(request.method).toBe("GET");
    expect(request.headers.Authorization).toBe("Bearer api-key");
  });

  it.each([
    {
      label: "transactions",
      call: () => tx.transactions({ txHashes: ["abc123"], include_receipts: true }),
      path: "/v0/transactions",
      body: { tx_hashes: ["abc123"], include_receipts: true },
    },
    {
      label: "receipt",
      call: () => tx.receipt({ receiptId: "GYvnvBxWA46UGa3aGEkqUBeT7hxhVXk2iZScJFZWU8Se", include_tx: true }),
      path: "/v0/receipt",
      body: { receipt_id: "GYvnvBxWA46UGa3aGEkqUBeT7hxhVXk2iZScJFZWU8Se", include_tx: true },
    },
    {
      label: "account",
      call: () => tx.account({ accountId: "root.near", limit: 1, order: "desc" }),
      path: "/v0/account",
      body: { account_id: "root.near", limit: 1, order: "desc" },
    },
    {
      label: "block",
      call: () => tx.block({ block_id: 75590392, with_transactions: false, with_receipts: true }),
      path: "/v0/block",
      body: { block_id: 75590392, with_transactions: false, with_receipts: true },
    },
    {
      label: "blocks",
      call: () => tx.blocks({ start_block_height: 75590390, limit: 2 }),
      path: "/v0/blocks",
      body: { start_block_height: 75590390, limit: 2 },
    },
  ])("routes tx.$label to the expected POST endpoint", async ({ call, path, body: expectedBody }) => {
    config({ apiKey: "tx-key" });
    mockFetch({ ok: true });

    await call();

    const { url, request, body } = getFetchCall();
    expectUrl(url, "https://tx.main.fastnear.com", path, {});
    expect(request.method).toBe("POST");
    expect(request.headers.Authorization).toBe("Bearer tx-key");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(body).toEqual(expectedBody);
  });

  it("aliases transfer query params into the POST body contract", async () => {
    config({ apiKey: "transfers-key" });
    mockFetch({ transfers: [] });

    await transfers.query({
      accountId: "root.near",
      resumeToken: "resume-here",
      limit: 1,
    });

    const { url, request, body } = getFetchCall();
    expectUrl(url, "https://transfers.main.fastnear.com", "/v0/transfers", {});
    expect(request.method).toBe("POST");
    expect(request.headers.Authorization).toBe("Bearer transfers-key");
    expect(body).toEqual({
      account_id: "root.near",
      resume_token: "resume-here",
      limit: 1,
    });
  });

  it.each([
    {
      label: "lastBlockFinal",
      call: () => neardata.lastBlockFinal({ with_chunks: false }),
      path: "/v0/last_block/final",
      query: { with_chunks: false, apiKey: "neardata-key" },
    },
    {
      label: "lastBlockOptimistic",
      call: () => neardata.lastBlockOptimistic(),
      path: "/v0/last_block/optimistic",
      query: { apiKey: "neardata-key" },
    },
    {
      label: "block",
      call: () => neardata.block({ blockHeight: 75590392 }),
      path: "/v0/block/75590392",
      query: { apiKey: "neardata-key" },
    },
    {
      label: "blockHeaders",
      call: () => neardata.blockHeaders({ blockHeight: 75590392 }),
      path: "/v0/block/75590392/headers",
      query: { apiKey: "neardata-key" },
    },
    {
      label: "blockShard",
      call: () => neardata.blockShard({ blockHeight: 75590392, shardId: 0 }),
      path: "/v0/block/75590392/shard/0",
      query: { apiKey: "neardata-key" },
    },
    {
      label: "blockChunk",
      call: () => neardata.blockChunk({ blockHeight: 75590392, shardId: 0 }),
      path: "/v0/block/75590392/chunk/0",
      query: { apiKey: "neardata-key" },
    },
    {
      label: "blockOptimistic",
      call: () => neardata.blockOptimistic({ blockHeight: 75590392 }),
      path: "/v0/block_opt/75590392",
      query: { apiKey: "neardata-key" },
    },
    {
      label: "firstBlock",
      call: () => neardata.firstBlock(),
      path: "/v0/first_block",
      query: { apiKey: "neardata-key" },
    },
    {
      label: "health",
      call: () => neardata.health(),
      path: "/health",
      query: { apiKey: "neardata-key" },
    },
  ])("routes neardata.$label to the expected GET endpoint", async ({ call, path, query }) => {
    config({ apiKey: "neardata-key" });
    mockFetch({ ok: true });

    await call();

    const { url, request } = getFetchCall();
    expectUrl(url, "https://mainnet.neardata.xyz", path, query);
    expect(request.method).toBe("GET");
    expect(request.headers.Authorization).toBeUndefined();
  });

  it.each([
    {
      label: "getLatestKey",
      call: () =>
        fastdata.kv.getLatestKey({
          currentAccountId: "social.near",
          predecessorId: "james.near",
          key: "graph/follow/sleet.near",
        }),
      path: "/v0/latest/social.near/james.near/graph%2Ffollow%2Fsleet.near",
      body: undefined,
    },
    {
      label: "getHistoryKey",
      call: () =>
        fastdata.kv.getHistoryKey({
          currentAccountId: "social.near",
          predecessorId: "james.near",
          key: "graph/follow/sleet.near",
        }),
      path: "/v0/history/social.near/james.near/graph%2Ffollow%2Fsleet.near",
      body: undefined,
    },
    {
      label: "latestByAccount",
      call: () => fastdata.kv.latestByAccount({ accountId: "social.near", limit: 10 }),
      path: "/v0/latest/social.near",
      body: { limit: 10 },
    },
    {
      label: "historyByAccount",
      call: () => fastdata.kv.historyByAccount({ accountId: "social.near", limit: 10 }),
      path: "/v0/history/social.near",
      body: { limit: 10 },
    },
    {
      label: "latestByPredecessor",
      call: () =>
        fastdata.kv.latestByPredecessor({
          currentAccountId: "social.near",
          predecessorId: "james.near",
          limit: 10,
        }),
      path: "/v0/latest/social.near/james.near",
      body: { limit: 10 },
    },
    {
      label: "historyByPredecessor",
      call: () =>
        fastdata.kv.historyByPredecessor({
          currentAccountId: "social.near",
          predecessorId: "james.near",
          limit: 10,
        }),
      path: "/v0/history/social.near/james.near",
      body: { limit: 10 },
    },
    {
      label: "allByPredecessor",
      call: () => fastdata.kv.allByPredecessor({ predecessorId: "james.near", limit: 10 }),
      path: "/v0/all/james.near",
      body: { limit: 10 },
    },
    {
      label: "multi",
      call: () =>
        fastdata.kv.multi({
          entries: [
            {
              current_account_id: "social.near",
              predecessor_id: "james.near",
              key: "graph/follow/sleet.near",
            },
          ],
        }),
      path: "/v0/multi",
      body: {
        entries: [
          {
            current_account_id: "social.near",
            predecessor_id: "james.near",
            key: "graph/follow/sleet.near",
          },
        ],
      },
    },
  ])("routes fastdata.kv.$label to the expected endpoint", async ({ call, path, body: expectedBody }) => {
    config({ apiKey: "kv-key" });
    mockFetch({ entries: [] });

    await call();

    const { url, request, body } = getFetchCall();
    expectUrl(url, "https://kv.main.fastnear.com", path, {});
    expect(request.headers.Authorization).toBe("Bearer kv-key");
    expect(request.method).toBe(expectedBody ? "POST" : "GET");
    if (expectedBody) {
      expect(request.headers["Content-Type"]).toBe("application/json");
      expect(body).toEqual(expectedBody);
    } else {
      expect(body).toBeUndefined();
    }
  });

  it("throws a clear error for transfers on testnet without an override", async () => {
    config({ networkId: "testnet" });

    await expect(transfers.query({ accountId: "root.testnet" })).rejects.toThrow(
      /transfers service is not configured for testnet/i
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns raw parsed JSON bodies from low-level namespaces", async () => {
    mockFetch({
      transfers: [{ account_id: "root.near", asset_id: "native:near" }],
    });

    const result = await transfers.query({ accountId: "root.near", limit: 1 });

    expect(result).toEqual({
      transfers: [{ account_id: "root.near", asset_id: "native:near" }],
    });
  });
});

describe("named endpoint response types", () => {
  it("exports stable response types for the low-level namespaces", () => {
    expectTypeOf<Awaited<ReturnType<typeof tx.transactions>>>().toEqualTypeOf<FastNearTxTransactionsResponse>();
    expectTypeOf<Awaited<ReturnType<typeof api.v1.accountFull>>>().toEqualTypeOf<FastNearApiV1AccountFullResponse>();
    expectTypeOf<Awaited<ReturnType<typeof neardata.lastBlockFinal>>>().toEqualTypeOf<FastNearNeardataLastBlockFinalResponse>();
    expectTypeOf<Awaited<ReturnType<typeof fastdata.kv.getLatestKey>>>().toEqualTypeOf<FastNearKvGetLatestKeyResponse>();
    expectTypeOf<Awaited<ReturnType<typeof transfers.query>>>().toEqualTypeOf<FastNearTransfersQueryResponse>();
    expectTypeOf<Awaited<ReturnType<typeof queryAccount>>>().toEqualTypeOf<FastNearRpcQueryAccountResponse>();
    expectTypeOf<Awaited<ReturnType<typeof recipes.viewAccount>>>().toEqualTypeOf<FastNearRecipeViewAccountResult>();

    expectTypeOf<FastNearTxTransactionsResponse["transactions"][number]["transaction"]["hash"]>().toEqualTypeOf<string>();
    expectTypeOf<FastNearApiV1AccountFullResponse["state"]["balance"]>().toEqualTypeOf<string>();
    expectTypeOf<FastNearNeardataLastBlockFinalResponse["shards"][number]["chunk"]["transactions"][number]["hash"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FastNearKvGetLatestKeyResponse["entries"][number]["key"]>().toEqualTypeOf<string>();
    expectTypeOf<FastNearTransfersQueryResponse["transfers"][number]["asset_id"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FastNearRpcQueryAccountResponse["result"]["amount"]>().toEqualTypeOf<string>();
    expectTypeOf<FastNearRecipeViewAccountResult["amount"]>().toEqualTypeOf<string>();
  });
});

describe("near.recipes", () => {
  it("delegates viewContract to the query RPC path", async () => {
    mockFetch({
      result: {
        result: Array.from(new TextEncoder().encode(JSON.stringify({
          account_id: "root.near",
          num_pixels: 123,
        }))),
      },
    });

    const result = await recipes.viewContract({
      contractId: "berryclub.ek.near",
      methodName: "get_account",
      args: { account_id: "root.near" },
    });

    const { body } = getFetchCall();
    expect(body.method).toBe("query");
    expect(body.params.request_type).toBe("call_function");
    expect(body.params.account_id).toBe("berryclub.ek.near");
    expect(body.params.method_name).toBe("get_account");
    expect(result).toMatchObject({
      account_id: "root.near",
      num_pixels: 123,
    });
  });

  it("delegates viewAccount to the account query RPC path", async () => {
    mockFetch({
      result: {
        amount: "1",
        code_hash: "11111111111111111111111111111111",
      },
    });

    const result = await recipes.viewAccount({ accountId: "root.near" });
    const { body } = getFetchCall();

    expect(body.method).toBe("query");
    expect(body.params.request_type).toBe("view_account");
    expect(body.params.account_id).toBe("root.near");
    expect(result.amount).toBe("1");
  });

  it("accepts a string shorthand for viewAccount and preserves blockId support in object form", async () => {
    mockFetch({
      result: {
        amount: "1",
        block_height: 75590392,
      },
    });

    const shorthand = await recipes.viewAccount("root.near");
    const shorthandCall = getFetchCall();

    expect(shorthand.amount).toBe("1");
    expect(shorthandCall.body.params).toEqual({
      request_type: "view_account",
      account_id: "root.near",
      finality: "optimistic",
    });

    (global.fetch as any).mockClear();
    mockFetch({
      result: {
        amount: "2",
        block_height: 75590392,
      },
    });

    const historical = await recipes.viewAccount({
      accountId: "root.near",
      blockId: "75590392",
    });
    const historicalCall = getFetchCall();

    expect(historical.amount).toBe("2");
    expect(historicalCall.body.params).toEqual({
      request_type: "view_account",
      account_id: "root.near",
      block_id: "75590392",
    });
  });

  it("delegates inspectTransaction to near.tx.transactions and returns the first record", async () => {
    mockFetch({
      transactions: [
        {
          transaction: {
            hash: "abc123",
            signer_id: "root.near",
            receiver_id: "escrow.ai.near",
          },
          receipts: [{}, {}],
        },
      ],
    });

    const result = await recipes.inspectTransaction({
      txHash: "abc123",
      accountId: "root.near",
    });

    const { url, body } = getFetchCall();
    expectUrl(url, "https://tx.main.fastnear.com", "/v0/transactions", {});
    expect(body).toEqual({ tx_hashes: ["abc123"] });
    expect(result).toMatchObject({
      transaction: {
        hash: "abc123",
        signer_id: "root.near",
        receiver_id: "escrow.ai.near",
      },
    });
  });

  it("accepts a string shorthand for inspectTransaction", async () => {
    mockFetch({
      transactions: [
        {
          transaction: {
            hash: "abc123",
            signer_id: "root.near",
            receiver_id: "escrow.ai.near",
          },
          receipts: [],
        },
      ],
    });

    const result = await recipes.inspectTransaction("abc123");
    const { body } = getFetchCall();

    expect(body).toEqual({ tx_hashes: ["abc123"] });
    expect(result?.transaction.hash).toBe("abc123");
  });

  it("delegates functionCall to sendTx with one flat FunctionCall action", async () => {
    const provider = createWalletProvider();
    useWallet(provider as any);
    state.update({
      accountId: "root.near",
      privateKey: null,
      accessKeyContractId: null,
    });

    await recipes.functionCall({
      receiverId: "berryclub.ek.near",
      methodName: "draw",
      args: { pixels: [{ x: 10, y: 20, color: 65280 }] },
      gas: "100000000000000",
      deposit: "0",
    });

    expect(provider.sendTransaction).toHaveBeenCalledWith({
      signerId: "root.near",
      receiverId: "berryclub.ek.near",
      actions: [
        {
          type: "FunctionCall",
          methodName: "draw",
          args: { pixels: [{ x: 10, y: 20, color: 65280 }] },
          argsBase64: undefined,
          gas: "100000000000000",
          deposit: "0",
        },
      ],
    });
  });

  it("delegates transfer to sendTx with one Transfer action", async () => {
    const provider = createWalletProvider();
    useWallet(provider as any);
    state.update({
      accountId: "root.near",
      privateKey: null,
      accessKeyContractId: null,
    });

    await recipes.transfer({
      receiverId: "escrow.ai.near",
      amount: "100000000000000000000000",
    });

    expect(provider.sendTransaction).toHaveBeenCalledWith({
      signerId: "root.near",
      receiverId: "escrow.ai.near",
      actions: [
        {
          type: "Transfer",
          deposit: "100000000000000000000000",
        },
      ],
    });
  });

  it("delegates connect to requestSignIn and updates selected account", async () => {
    const provider = createWalletProvider({
      isConnected: vi.fn().mockReturnValue(false),
      connect: vi.fn().mockResolvedValue({ accountId: "root.near" }),
    });
    useWallet(provider as any);
    config({ networkId: "mainnet" });

    await recipes.connect({
      contractId: "berryclub.ek.near",
      features: { signMessage: true },
    });

    expect(provider.connect).toHaveBeenCalledWith({
      contractId: "berryclub.ek.near",
      network: "mainnet",
      excludedWallets: undefined,
      features: { signMessage: true },
    });
    expect(selected().account).toBe("root.near");
  });

  it("delegates signMessage to the connected wallet provider", async () => {
    const provider = createWalletProvider();
    useWallet(provider as any);
    state.update({
      accountId: "root.near",
      privateKey: null,
      accessKeyContractId: null,
    });

    const message = {
      message: "Sign in to FastNear Berry Club",
      recipient: "js.fastnear.com",
      nonce: new Uint8Array(32),
    };
    const result = await recipes.signMessage(message);

    expect(provider.signMessage).toHaveBeenCalledWith(message);
    expect(result).toEqual({ signature: "ed25519:signature" });
  });
});

describe("near.print", () => {
  it("pretty-prints serializable values without a separator when stdout is not a TTY", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });

    try {
      print({ account_id: "root.near", num_pixels: 12 });

      expect(logSpy).toHaveBeenCalledWith(
        JSON.stringify({ account_id: "root.near", num_pixels: 12 }, null, 2)
      );
      expect(logSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (isTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", isTtyDescriptor);
      }
    }

    logSpy.mockRestore();
  });

  it("adds a blank line before output in interactive terminal mode", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      print({ account_id: "root.near", num_pixels: 12 });

      expect(logSpy).toHaveBeenNthCalledWith(1, "");
      expect(logSpy).toHaveBeenNthCalledWith(
        2,
        JSON.stringify({ account_id: "root.near", num_pixels: 12 }, null, 2)
      );
      expect(logSpy).toHaveBeenCalledTimes(2);
    } finally {
      if (isTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", isTtyDescriptor);
      }
    }

    logSpy.mockRestore();
  });

  it("falls back to console.log for non-serializable values", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const cyclic: Record<string, any> = {};
    cyclic.self = cyclic;

    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });

    try {
      print(cyclic);

      expect(logSpy).toHaveBeenCalledWith(cyclic);
      expect(logSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (isTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", isTtyDescriptor);
      }
    }

    logSpy.mockRestore();
  });
});

describe("near.recipes discovery", () => {
  it("returns a compact discovery list from near.recipes.list()", () => {
    const entries = recipes.list();

    expectTypeOf(entries).toEqualTypeOf<FastNearRecipeDiscoveryEntry[]>();
    expect(entries[0]).toMatchObject({
      id: "view-contract",
      api: "near.recipes.viewContract",
      title: "What does this contract method return?",
    });
    expect(entries.map((entry) => entry.id)).toContain("sign-message");
  });

  it("serializes near.recipes into the same discovery list", () => {
    const serialized = JSON.parse(JSON.stringify(recipes));

    expect(serialized).toEqual(recipes.list());
  });

  it("lets near.print serialize nested recipe discovery data", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });

    try {
      print({ recipes });

      const payload = JSON.stringify({ recipes: recipes.list() }, null, 2);
      expect(logSpy).toHaveBeenCalledWith(payload);
      expect(logSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (isTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", isTtyDescriptor);
      }
    }

    logSpy.mockRestore();
  });
});

describe("near.explain", () => {
  it("normalizes flat and connector-style actions", () => {
    const flat = explain.action(actions.functionCall({
      methodName: "draw",
      args: { pixels: [{ x: 10, y: 20, color: 65280 }] },
      gas: "100000000000000",
      deposit: "0",
    }));
    const connector = explain.action({
      type: "Transfer",
      params: { deposit: "1" },
    });

    expect(flat).toMatchObject({
      kind: "action",
      type: "FunctionCall",
      methodName: "draw",
      gas: "100000000000000",
      deposit: "0",
    });
    expect(connector).toMatchObject({
      kind: "action",
      type: "Transfer",
      deposit: "1",
    });
  });

  it("summarizes a transaction with stable keys", () => {
    const result = explain.tx({
      signerId: "root.near",
      receiverId: "berryclub.ek.near",
      actions: [
        actions.functionCall({
          methodName: "draw",
          args: { pixels: [{ x: 10, y: 20, color: 65280 }] },
          gas: "100000000000000",
          deposit: "0",
        }),
      ],
    });

    expect(result).toMatchObject({
      kind: "transaction",
      signerId: "root.near",
      receiverId: "berryclub.ek.near",
      actionCount: 1,
    });
    expect(result.actions[0].type).toBe("FunctionCall");
  });

  it("normalizes JSON RPC errors", () => {
    const result = explain.error(new Error(JSON.stringify({
      code: -32000,
      message: "Server error",
      data: { name: "HANDLER_ERROR" },
    })));

    expect(result).toEqual({
      kind: "rpc_error",
      code: -32000,
      name: "Error",
      message: "Server error",
      data: { name: "HANDLER_ERROR" },
      retryable: true,
    });
  });

  it("marks transport errors as retryable", () => {
    const result = explain.error(new Error("network timeout while fetching bundle"));

    expect(result.kind).toBe("transport_error");
    expect(result.retryable).toBe(true);
    expect(result.message).toContain("network timeout");
  });
});
