import { base64ToBytes, bytesToBase64, toBase58 } from "@fastnear/utils";
import {
  INTENTS_CONTRACT_ID,
  type Intent,
  type IntentMessage,
  type IntentSigner,
  type SignIntentsParams,
  type SignedIntentNep413,
  type UnsignedNep413Payload,
} from "./types.js";

/** Crypto-random 32-byte NEP-413 nonce (the verifier's replay nonce). */
export function randomNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

const DEFAULT_DEADLINE_MS = 5 * 60 * 1000;

/** ISO-8601 deadline `minutes` from now (default 5). */
export function defaultDeadline(ms: number = DEFAULT_DEADLINE_MS): string {
  return new Date(Date.now() + ms).toISOString();
}

/** Build the inner intent message that gets signed. */
export function buildIntentMessage({
  signerId,
  intents,
  deadline,
}: {
  signerId: string;
  intents: Intent[];
  deadline?: string;
}): IntentMessage {
  if (!signerId) throw new Error("signerId is required");
  if (!Array.isArray(intents) || intents.length === 0) {
    throw new Error("At least one intent is required");
  }
  return {
    signer_id: signerId,
    deadline: deadline ?? defaultDeadline(),
    intents,
  };
}

/**
 * Encode a NEP-413 signature the way intents.near expects it:
 * `ed25519:<base58>` (or `secp256k1:<base58>` for 65-byte signatures).
 *
 * NEAR wallets return the signature as plain base64 per NEP-413 — passing
 * that through unconverted is the most common integration bug.
 */
export function encodeIntentSignature(
  signature: string | Uint8Array,
): string {
  if (typeof signature === "string") {
    if (
      signature.startsWith("ed25519:") ||
      signature.startsWith("secp256k1:")
    ) {
      return signature;
    }
    return encodeIntentSignature(base64ToBytes(signature));
  }
  if (signature.length === 64) return `ed25519:${toBase58(signature)}`;
  if (signature.length === 65) return `secp256k1:${toBase58(signature)}`;
  throw new Error(
    `Unsupported NEP-413 signature length: ${signature.length} (expected 64 or 65 bytes)`,
  );
}

/** Ensure a public key string carries its curve prefix. */
export function normalizeIntentPublicKey(publicKey: string): string {
  if (!publicKey) throw new Error("A public key is required");
  return publicKey.includes(":") ? publicKey : `ed25519:${publicKey}`;
}

/**
 * Assemble the signed MultiPayload from NEP-413 parts. Accepts the
 * signature as wallet base64, raw bytes, or an already-prefixed string.
 */
export function toSignedIntent({
  message,
  nonce,
  recipient = INTENTS_CONTRACT_ID,
  publicKey,
  signature,
  callbackUrl,
}: {
  message: IntentMessage | string;
  nonce: Uint8Array;
  recipient?: string;
  publicKey: string;
  signature: string | Uint8Array;
  callbackUrl?: string;
}): SignedIntentNep413 {
  if (nonce.length !== 32) {
    throw new Error(`NEP-413 nonce must be exactly 32 bytes, got ${nonce.length}`);
  }
  return {
    standard: "nep413",
    payload: {
      message: typeof message === "string" ? message : JSON.stringify(message),
      nonce: bytesToBase64(nonce),
      recipient,
      ...(callbackUrl ? { callbackUrl } : {}),
    },
    public_key: normalizeIntentPublicKey(publicKey),
    signature: encodeIntentSignature(signature),
  };
}

/**
 * Normalize an unsigned payload as 1Click's generate-intent returns it.
 * Accepts either the bare payload or the `{ standard, payload }` wrapper,
 * and decodes a base64 nonce string to bytes.
 */
export function unsignedPayloadParts(
  input: UnsignedNep413Payload | { standard?: string; payload: UnsignedNep413Payload },
): { message: string; nonce: Uint8Array; recipient: string; callbackUrl?: string } {
  const payload =
    "payload" in input && typeof input.payload === "object"
      ? input.payload
      : (input as UnsignedNep413Payload);
  if (
    "standard" in input &&
    typeof input.standard === "string" &&
    input.standard !== "nep413"
  ) {
    throw new Error(
      `This signer only signs nep413 payloads; got standard "${input.standard}"`,
    );
  }
  if (typeof payload?.message !== "string" || typeof payload?.recipient !== "string") {
    throw new Error("Unsigned payload must carry message and recipient strings");
  }
  const nonce =
    typeof payload.nonce === "string"
      ? base64ToBytes(payload.nonce)
      : payload.nonce;
  if (!(nonce instanceof Uint8Array) || nonce.length !== 32) {
    throw new Error("Unsigned payload nonce must decode to exactly 32 bytes");
  }
  return {
    message: payload.message,
    nonce,
    recipient: payload.recipient,
    ...(payload.callbackUrl ? { callbackUrl: payload.callbackUrl } : {}),
  };
}

/**
 * The @fastnear/wallet surface this package needs — structural, so any
 * object with a NEP-413 `signMessage` (and optionally `accountId`) works.
 */
export interface FastNearWalletLike {
  accountId?(options?: { network?: "mainnet" | "testnet" }): string | null;
  signMessage(params: {
    message: string;
    recipient: string;
    nonce: Uint8Array;
    network?: "mainnet" | "testnet";
  }): Promise<{ accountId: string; publicKey: string; signature: string }>;
}

export interface WalletIntentSignerOptions {
  wallet: FastNearWalletLike;
  /** NEAR Intents is mainnet-oriented; override only for test deployments. */
  network?: "mainnet" | "testnet";
}

/**
 * Sign intent messages with a connected FastNEAR wallet via NEP-413.
 *
 * NEP-413 requires a full-access key, so wallets sign with the account's
 * own key — FunctionCall-access session keys cannot authorize intents.
 * The wallet's base64 signature is re-encoded to `ed25519:<base58>`.
 */
export function createWalletIntentSigner({
  wallet,
  network = "mainnet",
}: WalletIntentSignerOptions): IntentSigner {
  if (!wallet || typeof wallet.signMessage !== "function") {
    throw new Error(
      "A FastNEAR wallet module with signMessage is required (connect @fastnear/wallet first)",
    );
  }

  async function signParts({
    message,
    nonce,
    recipient,
    callbackUrl,
    expectedSigner,
  }: {
    message: string;
    nonce: Uint8Array;
    recipient: string;
    callbackUrl?: string;
    expectedSigner?: string;
  }): Promise<SignedIntentNep413> {
    const signed = await wallet.signMessage({
      message,
      recipient,
      nonce,
      network,
    });

    if (expectedSigner && signed.accountId && signed.accountId !== expectedSigner) {
      throw new Error(
        `Wallet signed as ${signed.accountId} but the intent names ${expectedSigner}; reconnect the intended account`,
      );
    }

    return toSignedIntent({
      message,
      nonce,
      recipient,
      publicKey: signed.publicKey,
      signature: signed.signature,
      callbackUrl,
    });
  }

  return {
    async signIntents(params: SignIntentsParams): Promise<SignedIntentNep413> {
      const signerId =
        params.signerId ??
        (typeof wallet.accountId === "function"
          ? wallet.accountId({ network })
          : null);
      if (!signerId) {
        throw new Error(`No wallet account connected on ${network}`);
      }

      const message = buildIntentMessage({
        signerId,
        intents: params.intents,
        deadline: params.deadline,
      });
      return signParts({
        message: JSON.stringify(message),
        nonce: params.nonce ?? randomNonce(),
        recipient: params.verifyingContract ?? INTENTS_CONTRACT_ID,
        expectedSigner: signerId,
      });
    },

    async signPayload(payload): Promise<SignedIntentNep413> {
      return signParts(unsignedPayloadParts(payload));
    },
  };
}
