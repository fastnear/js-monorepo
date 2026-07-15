import {
  SettlementCache,
  type FacilitatorNearSigner,
} from "@x402/near";
import { describe, expect, it } from "vitest";
import { createNearFacilitator } from "./facilitator.js";

const signer = {
  getRelayerIds: () => ["relayer.testnet"],
  getCurrentBlockHeight: async () => 1n,
  viewAccount: async () => null,
  viewAccessKey: async () => null,
  ftBalanceOf: async () => 0n,
  storageBalanceOf: async () => ({ supported: false as const }),
  submitSignedDelegateAction: async () => ({
    transaction: "test",
    innerReceipt: { kind: "success" as const, value: "" },
  }),
} as unknown as FacilitatorNearSigner;

function registeredScheme(facilitator: unknown): any {
  return (facilitator as any).registeredFacilitatorSchemes.get(2)[0].facilitator;
}

describe("createNearFacilitator", () => {
  it("registers multiple concrete NEAR networks", () => {
    const facilitator = createNearFacilitator({
      registrations: [
        { network: "near:mainnet", signer },
        { network: "near:testnet", signer, maxSponsoredGas: 30_000_000_000_000n },
      ],
    });
    expect(facilitator.getSupported().kinds).toEqual(expect.arrayContaining([
      expect.objectContaining({ network: "near:mainnet", scheme: "exact", x402Version: 2 }),
      expect.objectContaining({ network: "near:testnet", scheme: "exact", x402Version: 2 }),
    ]));
  });

  it("forwards settlement cache and gas options to a custom signer", () => {
    const settlementCache = new SettlementCache();
    const facilitator = createNearFacilitator({
      registrations: [{
        network: "near:testnet",
        signer,
        settlementCache,
        maxSponsoredGas: 12_345n,
      }],
    });
    const scheme = registeredScheme(facilitator);
    expect(scheme.signer).toBe(signer);
    expect(scheme.settlementCache).toBe(settlementCache);
    expect(scheme.maxSponsoredGas).toBe(12_345n);
  });

  it("creates the upstream reference signer from relayer configuration", () => {
    const facilitator = createNearFacilitator({
      registrations: [{
        network: "near:testnet",
        signer: {
          relayers: [{
            accountId: "relayer.testnet",
            secretKey: "ed25519:9TQiNdoKW9ecwDFx7HF5fovv3aLz7HdMJQ32iCXSraJ2eKx2mcLuDNqrproewz8hBHR3wBkZLDQ9hesRAoDuYkm",
          }],
          rpcUrls: {
            "near:testnet": "https://rpc.testnet.example",
          },
        },
      }],
    });
    expect(registeredScheme(facilitator).signer.getRelayerIds()).toEqual([
      "relayer.testnet",
    ]);
  });

  it("rejects empty, duplicate, and invalid registrations", () => {
    expect(() => createNearFacilitator({ registrations: [] })).toThrow("At least one");
    expect(() => createNearFacilitator({ registrations: [
      { network: "near:testnet", signer },
      { network: "near:testnet", signer },
    ] })).toThrow("Duplicate");
    expect(() => createNearFacilitator({ registrations: [
      { network: "near:testnet", signer, maxSponsoredGas: 0n },
    ] })).toThrow("positive bigint");
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, "30000000000000"]) {
      expect(() => createNearFacilitator({ registrations: [{
        network: "near:testnet",
        signer,
        maxSponsoredGas: invalid as never,
      }] })).toThrow("positive bigint");
    }
  });

  it("rejects reference signer configuration without relayers", () => {
    expect(() => createNearFacilitator({ registrations: [{
      network: "near:testnet",
      signer: { relayers: [] },
    }] })).toThrow("At least one relayer");
  });
});
