import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  type FacilitatorClient,
  type FacilitatorConfig,
} from "@x402/core/server";
import type { x402Facilitator } from "@x402/core/facilitator";
import type { MoneyParser } from "@x402/core/types";
import { ExactNearScheme } from "@x402/near/exact/server";

export type NearMoneyParser = MoneyParser;

export type FacilitatorEndpointConfig = Omit<FacilitatorConfig, "url"> & {
  url: string;
};

/** Core facilitator shape accepted for same-process verification/settlement. */
export type InProcessFacilitator = Pick<
  x402Facilitator,
  "verify" | "settle" | "getSupported"
>;

export type NearFacilitatorClient = FacilitatorClient | InProcessFacilitator;

export interface NearResourceServerOptions {
  facilitators:
    | NearFacilitatorClient
    | FacilitatorEndpointConfig
    | readonly (NearFacilitatorClient | FacilitatorEndpointConfig)[];
  moneyParsers?: readonly NearMoneyParser[];
}

function isInProcessFacilitator(value: unknown): value is NearFacilitatorClient {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as FacilitatorClient).verify === "function" &&
    typeof (value as FacilitatorClient).settle === "function" &&
    typeof (value as FacilitatorClient).getSupported === "function",
  );
}

function endpointToClient(
  endpoint: NearFacilitatorClient | FacilitatorEndpointConfig,
): FacilitatorClient {
  if (isInProcessFacilitator(endpoint)) {
    return {
      verify: (payload, requirements) => endpoint.verify(payload, requirements),
      settle: (payload, requirements) => endpoint.settle(payload, requirements),
      getSupported: async () => (
        await endpoint.getSupported()
      ) as Awaited<ReturnType<FacilitatorClient["getSupported"]>>,
    };
  }
  if (!endpoint || typeof endpoint.url !== "string" || endpoint.url.trim().length === 0) {
    throw new Error("Each x402 facilitator endpoint requires a non-empty URL");
  }
  return new HTTPFacilitatorClient(endpoint);
}

/**
 * Create a resource server with the official NEAR server scheme and an
 * explicitly configured facilitator. No default facilitator is used.
 */
export function createNearResourceServer({
  facilitators,
  moneyParsers = [],
}: NearResourceServerOptions): x402ResourceServer {
  const configured = Array.isArray(facilitators) ? [...facilitators] : [facilitators];
  if (configured.length === 0) {
    throw new Error("At least one NEAR-capable x402 facilitator is required");
  }

  const clients = configured.map(endpointToClient);
  const scheme = new ExactNearScheme();
  for (const parser of moneyParsers) {
    scheme.registerMoneyParser(parser);
  }

  return new x402ResourceServer(clients).register("near:*", scheme);
}

export type { FacilitatorClient } from "@x402/core/server";
