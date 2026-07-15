import type { FacilitatorClient } from "@x402/core/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNearResourceServer } from "./server.js";

function facilitatorClient(): FacilitatorClient {
  return {
    verify: vi.fn(),
    settle: vi.fn(),
    getSupported: vi.fn(async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: "near:testnet" }],
      extensions: [],
      signers: {},
    })),
  } as unknown as FacilitatorClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createNearResourceServer", () => {
  it("registers the official exact scheme for NEAR", () => {
    const server = createNearResourceServer({ facilitators: facilitatorClient() });
    expect(server.hasRegisteredScheme("near:mainnet", "exact")).toBe(true);
    expect(server.hasRegisteredScheme("near:testnet", "exact")).toBe(true);
  });

  it("accepts explicit HTTP endpoints and registers money parsers", async () => {
    const createAuthHeaders = vi.fn(async () => ({
      verify: { authorization: "test" },
      settle: { authorization: "test" },
      supported: { authorization: "test" },
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/verify")
        ? { isValid: true, payer: "payer.testnet" }
        : url.endsWith("/settle")
          ? {
              success: true,
              transaction: "remote-settlement",
              network: "near:testnet",
              payer: "payer.testnet",
            }
          : {
              kinds: [{ x402Version: 2, scheme: "exact", network: "near:testnet" }],
              extensions: [],
              signers: {},
            };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const httpServer = createNearResourceServer({
      facilitators: [{
        url: "https://facilitator.example.test",
        createAuthHeaders,
      }],
    });
    await httpServer.initialize();
    expect(createAuthHeaders).toHaveBeenCalledWith();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://facilitator.example.test/supported",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "test" }),
      }),
    );

    const [remoteRequirements] = await httpServer.buildPaymentRequirementsFromOptions([{
      scheme: "exact",
      network: "near:testnet",
      payTo: "merchant.testnet",
      price: { asset: "usdc.fakes.testnet", amount: "42" },
    }], {});
    const remotePayload = {
      x402Version: 2,
      accepted: remoteRequirements,
      payload: { signedDelegateAction: "test-fixture" },
    };
    await expect(
      httpServer.verifyPayment(remotePayload, remoteRequirements),
    ).resolves.toMatchObject({ isValid: true, payer: "payer.testnet" });
    await expect(
      httpServer.settlePayment(remotePayload, remoteRequirements),
    ).resolves.toMatchObject({ success: true, transaction: "remote-settlement" });
    for (const path of ["verify", "settle"]) {
      expect(fetchMock).toHaveBeenCalledWith(
        `https://facilitator.example.test/${path}`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ authorization: "test" }),
        }),
      );
    }

    const parser = vi.fn(async () => ({ asset: "custom-token.testnet", amount: "42" }));
    const server = createNearResourceServer({
      facilitators: facilitatorClient(),
      moneyParsers: [parser],
    });
    await server.initialize();

    const built = await server.buildPaymentRequirementsFromOptions([{
      scheme: "exact",
      network: "near:testnet",
      payTo: "merchant.testnet",
      price: "$1.00",
    }], {});
    expect(parser).toHaveBeenCalledWith(1, "near:testnet");
    expect(built[0]).toMatchObject({ asset: "custom-token.testnet", amount: "42" });
  });

  it("never allows an implicit facilitator", () => {
    expect(() => createNearResourceServer({ facilitators: [] })).toThrow("At least one");
    expect(() => createNearResourceServer({ facilitators: { url: "" } })).toThrow("non-empty URL");
  });
});
