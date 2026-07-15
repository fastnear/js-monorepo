import type { x402Client as X402Client } from "@x402/core/client";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { deserialize, serialize } from "@fastnear/borsh";
import { nearChainSchema } from "@fastnear/borsh-schema";
import {
  encodeDelegateAction,
  encodeSignedDelegate,
  type SignedDelegate,
} from "@near-js/transactions";
import { verify as verifySecp256k1 } from "@noble/secp256k1";
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
  const blocks = Math.ceil(maxTimeoutSeconds);
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

interface DecodedFunctionCall {
  methodName: string;
  args: number[];
  gas: bigint;
  deposit: bigint;
}

interface RawKeyOrSignature {
  data: number[];
}

interface DecodedSignedDelegate {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: Array<{ functionCall?: DecodedFunctionCall }>;
    nonce: bigint;
    maxBlockHeight: bigint;
    publicKey: {
      ed25519Key?: RawKeyOrSignature;
      secp256k1Key?: RawKeyOrSignature;
    };
  };
  signature: {
    ed25519Signature?: RawKeyOrSignature;
    secp256k1Signature?: RawKeyOrSignature;
  };
}

interface SignedDelegateExpectation {
  signerId: string;
  asset: string;
  payTo: string;
  amount: string;
}

function decodeSignedDelegate(value: string): DecodedSignedDelegate {
  try {
    const bytes = fromBase64(value);
    if (bytes.length === 0 || toBase64(bytes) !== value) throw new Error("non-canonical base64");
    const decoded = deserialize(
      nearChainSchema.SignedDelegate,
      bytes,
    ) as DecodedSignedDelegate;
    const canonical = serialize(nearChainSchema.SignedDelegate, decoded);
    if (
      canonical.length !== bytes.length ||
      canonical.some((byte, index) => byte !== bytes[index])
    ) {
      throw new Error("non-canonical signed delegate");
    }
    return decoded;
  } catch {
    throw new Error("Wallet returned a malformed signed delegate action");
  }
}

function invalidDelegate(reason: string): never {
  throw new Error(`Wallet returned a signed delegate that does not match the payment request: ${reason}`);
}

async function hasValidSignature(signedDelegate: DecodedSignedDelegate): Promise<boolean> {
  const { delegateAction, signature } = signedDelegate;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return false;
  const digest = new Uint8Array(
    await subtle.digest("SHA-256", encodeDelegateAction(delegateAction as never)),
  );
  const edKey = delegateAction.publicKey.ed25519Key;
  const edSignature = signature.ed25519Signature;
  if (edKey && edSignature) {
    try {
      const publicKey = await subtle.importKey(
        "raw",
        Uint8Array.from(edKey.data),
        "Ed25519",
        false,
        ["verify"],
      );
      return await subtle.verify(
        "Ed25519",
        publicKey,
        Uint8Array.from(edSignature.data),
        digest,
      );
    } catch {
      return false;
    }
  }

  const secpKey = delegateAction.publicKey.secp256k1Key;
  const secpSignature = signature.secp256k1Signature;
  if (secpKey && secpSignature) {
    const publicKey = new Uint8Array(65);
    publicKey[0] = 4;
    publicKey.set(secpKey.data, 1);
    return verifySecp256k1(
      Uint8Array.from(secpSignature.data).subarray(0, 64),
      digest,
      publicKey,
      { prehash: false, lowS: false },
    );
  }
  return false;
}

async function assertDelegateMatches(
  signedDelegate: DecodedSignedDelegate,
  expected: SignedDelegateExpectation,
): Promise<void> {
  const delegate = signedDelegate.delegateAction;
  if (!delegate || delegate.senderId !== expected.signerId) invalidDelegate("signer");
  if (delegate.receiverId !== expected.asset) invalidDelegate("token contract");
  if (!Array.isArray(delegate.actions) || delegate.actions.length !== 1) {
    invalidDelegate("action count");
  }

  const action = delegate.actions[0];
  const functionCall = action?.functionCall;
  if (!functionCall || Object.keys(action).length !== 1) invalidDelegate("action kind");
  if (functionCall.methodName !== "ft_transfer") invalidDelegate("method name");
  if (functionCall.gas !== BigInt(FT_TRANSFER_GAS)) invalidDelegate("gas");
  if (functionCall.deposit !== BigInt(ONE_YOCTO)) invalidDelegate("deposit");

  let args: unknown;
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(functionCall.args),
    );
    args = JSON.parse(json);
  } catch {
    invalidDelegate("ft_transfer arguments");
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    invalidDelegate("ft_transfer arguments");
  }
  const transfer = args as Record<string, unknown>;
  if (
    Object.keys(transfer).length !== 2 ||
    transfer.receiver_id !== expected.payTo ||
    transfer.amount !== expected.amount
  ) {
    invalidDelegate("ft_transfer arguments");
  }
  if (typeof delegate.nonce !== "bigint" || delegate.nonce <= 0n) invalidDelegate("nonce");
  if (typeof delegate.maxBlockHeight !== "bigint" || delegate.maxBlockHeight <= 0n) {
    invalidDelegate("maximum block height");
  }
  if (!await hasValidSignature(signedDelegate)) invalidDelegate("signature");
}

async function normalizeSignedDelegate(
  result: unknown,
  expected: SignedDelegateExpectation,
): Promise<string> {
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
  if (encoded.length === 0) throw new Error("Wallet returned an empty signed delegate action");
  await assertDelegateMatches(decodeSignedDelegate(encoded), expected);
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
      return normalizeSignedDelegate(results[0], {
        signerId,
        asset: paymentRequirements.asset,
        payTo: paymentRequirements.payTo,
        amount: paymentRequirements.amount,
      });
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
export type { x402Client } from "@x402/core/client";
