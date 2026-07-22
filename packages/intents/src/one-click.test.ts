import { describe, expect, it, vi } from "vitest";
import { IntentsHttpError, createOneClickClient } from "./one-click.js";
import { createSolverRelayClient, SolverRelayError } from "./relay.js";

function mockFetch(
  responses: Array<{ status?: number; body: unknown }>,
): { fetch: typeof globalThis.fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("createOneClickClient", () => {
  it("GETs /v0/tokens from the default base URL", async () => {
    const { fetch, calls } = mockFetch([{ body: [{ assetId: "nep141:wrap.near" }] }]);
    const client = createOneClickClient({ fetch });

    const tokens = await client.tokens();

    expect(tokens[0].assetId).toBe("nep141:wrap.near");
    expect(calls[0].url).toBe("https://1click.chaindefuser.com/v0/tokens");
    expect(calls[0].init.method).toBe("GET");
  });

  it("POSTs quotes with JSON body and auth headers", async () => {
    const { fetch, calls } = mockFetch([{ body: { quote: { amountOut: "1" } } }]);
    const client = createOneClickClient({ fetch, apiKey: "key123", jwt: "jwt456" });

    await client.quote({ dry: true } as never);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("key123");
    expect(headers.Authorization).toBe("Bearer jwt456");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ dry: true });
    expect(calls[0].url).toBe("https://1click.chaindefuser.com/v0/quote");
  });

  it("builds the status query string with optional memo", async () => {
    const { fetch, calls } = mockFetch([{ body: { status: "SUCCESS" } }]);
    const client = createOneClickClient({ fetch });

    await client.status({ depositAddress: "abc", depositMemo: "m1" });

    expect(calls[0].url).toBe(
      "https://1click.chaindefuser.com/v0/status?depositAddress=abc&depositMemo=m1",
    );
  });

  it("wraps generate-intent and submit-intent with type swap_transfer", async () => {
    const { fetch, calls } = mockFetch([{ body: { intent: {}, correlationId: "c" } }]);
    const client = createOneClickClient({ fetch });

    await client.generateIntent({ signerId: "a.near", depositAddress: "dep" });
    await client.submitIntent({
      signedData: { standard: "nep413" } as never,
    });

    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      type: "swap_transfer",
      standard: "nep413",
      signerId: "a.near",
      depositAddress: "dep",
    });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      type: "swap_transfer",
      signedData: { standard: "nep413" },
    });
  });

  it("throws IntentsHttpError with status and parsed body on non-2xx", async () => {
    const { fetch } = mockFetch([
      { status: 400, body: { message: "originAsset is unsupported" } },
    ]);
    const client = createOneClickClient({ fetch });

    const error = await client
      .quote({ dry: true } as never)
      .then(() => null, (e: unknown) => e);

    expect(error).toBeInstanceOf(IntentsHttpError);
    expect((error as IntentsHttpError).status).toBe(400);
    expect((error as IntentsHttpError).message).toMatch(/originAsset/);
  });

  it("strips a trailing slash from custom base URLs", async () => {
    const { fetch, calls } = mockFetch([{ body: [] }]);
    const client = createOneClickClient({ fetch, baseUrl: "https://example.com/" });
    await client.tokens();
    expect(calls[0].url).toBe("https://example.com/v0/tokens");
  });
});

describe("createSolverRelayClient", () => {
  it("wraps params in JSON-RPC envelopes with incrementing ids", async () => {
    const { fetch, calls } = mockFetch([
      { body: { jsonrpc: "2.0", id: 1, result: [] } },
      { body: { jsonrpc: "2.0", id: 2, result: { status: "OK", intent_hash: "h" } } },
    ]);
    const client = createSolverRelayClient({ fetch });

    await client.quote({
      defuse_asset_identifier_in: "nep141:a.near",
      defuse_asset_identifier_out: "nep141:b.near",
      exact_amount_in: "1000",
    });
    await client.publishIntent({
      signedData: { standard: "nep413" } as never,
      quoteHashes: ["qh"],
    });

    const first = JSON.parse(String(calls[0].init.body));
    expect(first).toEqual({
      id: 1,
      jsonrpc: "2.0",
      method: "quote",
      params: [
        {
          defuse_asset_identifier_in: "nep141:a.near",
          defuse_asset_identifier_out: "nep141:b.near",
          exact_amount_in: "1000",
        },
      ],
    });

    const second = JSON.parse(String(calls[1].init.body));
    expect(second.id).toBe(2);
    expect(second.method).toBe("publish_intent");
    expect(second.params).toEqual([
      { signed_data: { standard: "nep413" }, quote_hashes: ["qh"] },
    ]);
  });

  it("maps publish_intents params including requote", async () => {
    const { fetch, calls } = mockFetch([
      { body: { result: { status: "OK", intent_hash: "h" } } },
    ]);
    const client = createSolverRelayClient({ fetch });

    await client.publishIntents({
      signedDatas: [{ standard: "nep413" } as never],
      quoteHashes: ["qh"],
      requote: true,
    });

    expect(JSON.parse(String(calls[0].init.body)).params).toEqual([
      {
        signed_datas: [{ standard: "nep413" }],
        quote_hashes: ["qh"],
        requote: true,
      },
    ]);
  });

  it("maps get_status and returns the result", async () => {
    const { fetch, calls } = mockFetch([
      { body: { result: { intent_hash: "h", status: "SETTLED" } } },
    ]);
    const client = createSolverRelayClient({ fetch });

    const status = await client.getStatus({ intentHash: "h" });

    expect(status.status).toBe("SETTLED");
    expect(JSON.parse(String(calls[0].init.body)).params).toEqual([
      { intent_hash: "h" },
    ]);
  });

  it("sends the API key header when configured", async () => {
    const { fetch, calls } = mockFetch([{ body: { result: [] } }]);
    const client = createSolverRelayClient({ fetch, apiKey: "relay-key" });
    await client.quote({
      defuse_asset_identifier_in: "nep141:a.near",
      defuse_asset_identifier_out: "nep141:b.near",
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("relay-key");
  });

  it("surfaces JSON-RPC errors as SolverRelayError", async () => {
    const { fetch } = mockFetch([
      { body: { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "bad" } } },
    ]);
    const client = createSolverRelayClient({ fetch });

    await expect(
      client.getStatus({ intentHash: "h" }),
    ).rejects.toBeInstanceOf(SolverRelayError);
  });
});
