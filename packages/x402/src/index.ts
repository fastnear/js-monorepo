import type { x402Client as X402Client } from "@x402/core/client";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import {
  encodeSignedDelegate,
  type SignedDelegate,
} from "@near-js/transactions";
import type { ClientNearSigner } from "@x402/near";
import { ExactNearScheme } from "@x402/near/exact/client";

export type NearNetwork = "near:mainnet" | "near:testnet";
export type NearNetworkPattern = NearNetwork | "near:*";

export interface FastNearWalletModule {
  accountId(options?: { network?: "mainnet" | "testnet" }): string | null;
  signDelegateActions(params: {
    network?: "mainnet" | "testnet";
    signerId?: string;
    delegateActions: Array<{
      receiverId: string;
      blockHeightTtl?: number;
      actions: Array<{
        type: "FunctionCall";
        params: {
          methodName: string;
          args: Record<string, string>;
          gas: string;
          deposit: string;
        };
      }>;
    }>;
  }): Promise<{ signedDelegateActions: unknown[] }>;
}

export interface FastNearWalletSignerOptions {
  wallet: FastNearWalletModule;
}

export interface NearX402ClientOptions {
  signer: ClientNearSigner;
  network?: NearNetworkPattern;
}

export interface NearPaymentFetchOptions extends NearX402ClientOptions {
  fetch?: typeof globalThis.fetch;
}

const NEAR_NETWORKS = new Set<NearNetwork>(["near:mainnet", "near:testnet"]);
const FT_TRANSFER_GAS = "30000000000000";
const ONE_YOCTO = "1";
// The official NEAR exact v2 scheme estimates one block per second.
const ESTIMATED_BLOCK_SECONDS = 1;

function toWalletNetwork(network: string): "mainnet" | "testnet" {
  if (!NEAR_NETWORKS.has(network as NearNetwork)) {
    throw new Error(`Unsupported x402 NEAR network: ${network}`);
  }
  return network === "near:mainnet" ? "mainnet" : "testnet";
}

function timeoutBlocks(maxTimeoutSeconds: number): number {
  if (!Number.isFinite(maxTimeoutSeconds) || maxTimeoutSeconds <= 0) {
    throw new Error("x402 maxTimeoutSeconds must be a positive finite number");
  }
  const blocks = Math.ceil(maxTimeoutSeconds / ESTIMATED_BLOCK_SECONDS);
  if (!Number.isSafeInteger(blocks)) {
    throw new Error("x402 timeout exceeds the wallet delegate-action limit");
  }
  return blocks;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Wallet returned a malformed signed delegate action");
  }
  try {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    throw new Error("Wallet returned a malformed signed delegate action");
  }
}

function assertCanonicalBase64(value: string): void {
  try {
    const bytes = fromBase64(value);
    if (bytes.length === 0 || toBase64(bytes) !== value) throw new Error("non-canonical base64");
  } catch {
    throw new Error("Wallet returned a malformed signed delegate action");
  }
}

// Compliant wallet transports validate the delegate they sign, and @x402/near's
// facilitator is the authoritative payload/signature verifier. This adapter
// intentionally validates only the response envelope, not the protocol again.
function normalizeSignedDelegate(result: unknown): string {
  let encoded: string;
  if (typeof result === "string") {
    encoded = result;
  } else if (result && typeof result === "object" && "borshSerializedBase64" in result) {
    const value = (result as { borshSerializedBase64?: unknown }).borshSerializedBase64;
    if (typeof value !== "string") {
      throw new Error("Wallet returned an invalid borshSerializedBase64 value");
    }
    encoded = value;
  } else if (result && typeof result === "object" && "signedDelegate" in result) {
    const signedDelegate = (result as { signedDelegate?: SignedDelegate }).signedDelegate;
    if (!signedDelegate || typeof signedDelegate !== "object") {
      throw new Error("Wallet returned an invalid signedDelegate value");
    }
    try {
      encoded = toBase64(encodeSignedDelegate(signedDelegate));
    } catch {
      throw new Error("Wallet returned an invalid signedDelegate value");
    }
  } else {
    throw new Error("Wallet returned an unsupported signed delegate result");
  }
  assertCanonicalBase64(encoded);
  return encoded;
}

/** Adapt @fastnear/wallet to the signer interface expected by x402 NEAR exact. */
export function createFastNearWalletSigner({
  wallet,
}: FastNearWalletSignerOptions): ClientNearSigner {
  if (!wallet || typeof wallet.accountId !== "function" || typeof wallet.signDelegateActions !== "function") {
    throw new Error("A FastNEAR wallet module with accountId and signDelegateActions is required");
  }

  return {
    async createSignedDelegateAction({ x402Version, paymentRequirements }) {
      if (x402Version !== 2) {
        throw new Error(`Unsupported x402 version for NEAR payments: ${x402Version}`);
      }
      if (paymentRequirements.scheme !== "exact") {
        throw new Error(`Unsupported x402 NEAR scheme: ${paymentRequirements.scheme}`);
      }
      const network = toWalletNetwork(paymentRequirements.network);
      const signerId = wallet.accountId({ network });
      if (!signerId) throw new Error(`No FastNEAR wallet is connected on ${network}`);

      const response = await wallet.signDelegateActions({
        network,
        signerId,
        delegateActions: [{
          receiverId: paymentRequirements.asset,
          blockHeightTtl: timeoutBlocks(paymentRequirements.maxTimeoutSeconds),
          actions: [{
            type: "FunctionCall",
            params: {
              methodName: "ft_transfer",
              args: {
                receiver_id: paymentRequirements.payTo,
                amount: paymentRequirements.amount,
              },
              gas: FT_TRANSFER_GAS,
              deposit: ONE_YOCTO,
            },
          }],
        }],
      });

      const results = response?.signedDelegateActions;
      if (!Array.isArray(results) || results.length !== 1) {
        throw new Error(`Wallet must return exactly one signed delegate action; received ${results?.length ?? 0}`);
      }
      return normalizeSignedDelegate(results[0]);
    },
  };
}

/** Create an x402 client registered only for the official NEAR exact scheme. */
export function createNearX402Client({
  signer,
  network = "near:*",
}: NearX402ClientOptions): X402Client {
  if (!signer || typeof signer.createSignedDelegateAction !== "function") {
    throw new Error("A NEAR x402 client signer is required");
  }
  if (network !== "near:*" && !NEAR_NETWORKS.has(network)) {
    throw new Error(`Unsupported x402 NEAR network pattern: ${network}`);
  }
  return new x402Client().register(network, new ExactNearScheme(signer));
}

/** Create a fetch-compatible function that handles x402 payment challenges. */
export function createNearPaymentFetch({
  signer,
  fetch: fetchImplementation = globalThis.fetch,
  network = "near:*",
}: NearPaymentFetchOptions): typeof globalThis.fetch {
  if (typeof fetchImplementation !== "function") {
    throw new Error("A fetch implementation is required");
  }
  return wrapFetchWithPayment(
    fetchImplementation,
    createNearX402Client({ signer, network }),
  );
}

export type { ClientNearSigner } from "@x402/near";
// Value re-export, not `export type`: the dts bundler drops the `type`
// keyword, so the published d.ts advertises a runtime export either way —
// make it real (the class is a runtime dependency already imported above).
export { x402Client } from "@x402/core/client";
