import { x402Facilitator } from "@x402/core/facilitator";
import {
  createFacilitatorNearSigner,
  type FacilitatorNearSigner,
  type FacilitatorNearSignerConfig,
  type SettlementCache,
} from "@x402/near";
import { ExactNearScheme } from "@x402/near/exact/facilitator";
import type { NearNetwork } from "./index.js";

export interface NearFacilitatorRegistration {
  network: NearNetwork;
  signer: FacilitatorNearSigner | FacilitatorNearSignerConfig;
  settlementCache?: SettlementCache;
  maxSponsoredGas?: bigint;
}

export interface NearFacilitatorOptions {
  registrations: readonly NearFacilitatorRegistration[];
}

function isFacilitatorNearSigner(value: unknown): value is FacilitatorNearSigner {
  const requiredMethods = [
    "getRelayerIds",
    "getCurrentBlockHeight",
    "viewAccount",
    "viewAccessKey",
    "ftBalanceOf",
    "storageBalanceOf",
    "submitSignedDelegateAction",
  ] as const;
  return Boolean(
    value &&
    typeof value === "object" &&
    requiredMethods.every(
      method => typeof (value as unknown as Record<string, unknown>)[method] === "function",
    ),
  );
}

/** Create a self-hostable core facilitator registered for concrete NEAR networks. */
export function createNearFacilitator({
  registrations,
}: NearFacilitatorOptions): x402Facilitator {
  if (!Array.isArray(registrations) || registrations.length === 0) {
    throw new Error("At least one NEAR facilitator registration is required");
  }

  const facilitator = new x402Facilitator();
  const networks = new Set<NearNetwork>();

  for (const registration of registrations) {
    if (!registration || typeof registration !== "object") {
      throw new Error("Each NEAR facilitator registration must be an object");
    }
    if (registration.network !== "near:mainnet" && registration.network !== "near:testnet") {
      throw new Error(`Unsupported NEAR facilitator network: ${registration.network}`);
    }
    if (networks.has(registration.network)) {
      throw new Error(`Duplicate NEAR facilitator network: ${registration.network}`);
    }
    networks.add(registration.network);

    if (
      registration.maxSponsoredGas !== undefined &&
      (typeof registration.maxSponsoredGas !== "bigint" || registration.maxSponsoredGas <= 0n)
    ) {
      throw new Error("maxSponsoredGas must be a positive bigint");
    }

    let signer: FacilitatorNearSigner;
    if (isFacilitatorNearSigner(registration.signer)) {
      signer = registration.signer;
    } else {
      if (
        !registration.signer ||
        typeof registration.signer !== "object" ||
        !Array.isArray(registration.signer.relayers) ||
        registration.signer.relayers.length === 0
      ) {
        throw new Error(`At least one relayer is required for ${registration.network}`);
      }
      signer = createFacilitatorNearSigner(registration.signer);
    }

    const relayerIds = signer.getRelayerIds();
    if (
      !Array.isArray(relayerIds) ||
      relayerIds.length === 0 ||
      relayerIds.some(relayerId => typeof relayerId !== "string" || relayerId.trim().length === 0)
    ) {
      throw new Error(`At least one valid relayer is required for ${registration.network}`);
    }

    facilitator.register(
      registration.network,
      new ExactNearScheme(signer, registration.settlementCache, {
        maxSponsoredGas: registration.maxSponsoredGas,
      }),
    );
  }

  return facilitator;
}

export type {
  FacilitatorNearSigner,
  FacilitatorNearSignerConfig,
  SettlementCache,
} from "@x402/near";
