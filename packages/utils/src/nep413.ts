import { serialize as borshSerialize, type Schema } from "@fastnear/borsh";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  keyFromString,
  keyTypeFromString,
  publicKeyFromPrivate,
  sha256,
  signHash,
  type NearPublicKey,
} from "./crypto.js";
import { base64ToBytes, fromBase58 } from "./misc.js";

/**
 * NEP-413 off-chain message signing.
 *
 * Per the NEP-461 discriminant scheme, off-chain signable messages are
 * prefixed with borsh(u32 2^31 + NEP number) so their digests can never
 * collide with an on-chain transaction (untagged) or a delegate action
 * (2^30 + 366). The signed digest is
 * sha256(borsh(tag) || borsh({ message, nonce[32], recipient, callbackUrl? }))
 * and NEP-413 requires signing with a full-access key.
 */
export const NEP413_OFFCHAIN_TAG = 2147484061; // 2^31 + 413

const nep413PayloadSchema: Schema = {
  struct: {
    tag: "u32",
    message: "string",
    nonce: { array: { type: "u8", len: 32 } },
    recipient: "string",
    callbackUrl: { option: "string" },
  },
};

function toNonceBytes(nonce: Uint8Array | ReadonlyArray<number>): Uint8Array {
  const bytes = nonce instanceof Uint8Array ? nonce : Uint8Array.from(nonce);
  if (bytes.length !== 32) {
    throw new Error(
      `NEP-413 nonce must be exactly 32 bytes, got ${bytes.length}`,
    );
  }
  return bytes;
}

function toSignatureBytes(signature: string | Uint8Array): Uint8Array {
  if (signature instanceof Uint8Array) return signature;
  // The NEP-413 MultiPayload format (e.g. intents.near) carries signatures
  // as "<curve>:<base58>"; wallets return plain base64. Accept both.
  const separator = signature.indexOf(":");
  if (separator !== -1) return fromBase58(signature.slice(separator + 1));
  return base64ToBytes(signature);
}

/** A NEP-413 payload as this module accepts it (nonce may be a plain array). */
export interface Nep413PayloadInput {
  message: string;
  nonce: Uint8Array | ReadonlyArray<number>;
  recipient: string;
  callbackUrl?: string | null;
}

/** Serialize a NEP-413 payload (prefix tag included) without hashing. */
export function serializeNep413Payload(message: Nep413PayloadInput): Uint8Array {
  return borshSerialize(nep413PayloadSchema, {
    tag: NEP413_OFFCHAIN_TAG,
    message: message.message,
    nonce: toNonceBytes(message.nonce),
    recipient: message.recipient,
    callbackUrl: message.callbackUrl ?? null,
  });
}

/** The 32-byte digest a NEP-413 signer actually signs. */
export function nep413Hash(message: Nep413PayloadInput): Uint8Array {
  return sha256(new Uint8Array(serializeNep413Payload(message)));
}

export interface SignedNep413Message {
  publicKey: NearPublicKey;
  /** Raw signature bytes (64 for ed25519, 65 r‖s‖v for secp256k1). */
  signature: Uint8Array;
}

/**
 * Sign a NEP-413 message locally with a raw NEAR private key.
 *
 * NEP-413 requires a full-access key: the caller is responsible for not
 * passing a FunctionCall-access key, since key permissions are an on-chain
 * property this helper cannot see.
 */
export function signNep413Message(
  message: Nep413PayloadInput,
  privateKey: string,
): SignedNep413Message {
  const hash = nep413Hash(message);
  return {
    publicKey: publicKeyFromPrivate(privateKey),
    signature: signHash(hash, privateKey),
  };
}

/**
 * Verify a NEP-413 signature (ed25519 or secp256k1) against its payload.
 * Accepts the base64 signature string wallets return, the curve-prefixed
 * base58 form MultiPayloads carry ("ed25519:<base58>"), or raw bytes.
 */
export function verifyNep413Signature({
  publicKey,
  signature,
  message,
  nonce,
  recipient,
  callbackUrl,
}: Nep413PayloadInput & {
  publicKey: string;
  signature: string | Uint8Array;
}): boolean {
  const hash = nep413Hash({ message, nonce, recipient, callbackUrl });
  const keyType = keyTypeFromString(publicKey);
  if (keyType === "ml-dsa-65") {
    // The post-quantum backend is opt-in; verify those with @fastnear/ml-dsa-65.
    throw new Error(
      "NEP-413 verification for ml-dsa-65 keys requires @fastnear/ml-dsa-65",
    );
  }
  const pk = keyFromString(publicKey);
  const sig = toSignatureBytes(signature);

  if (keyType === "secp256k1") {
    // Strip recovery byte (last byte) — compact sig is first 64 bytes
    const compactSig = sig.slice(0, 64);
    // Prepend 0x04 uncompressed prefix — NEAR stores 64 bytes, noble expects 65
    const fullPk = new Uint8Array(65);
    fullPk[0] = 0x04;
    fullPk.set(pk, 1);
    return secp256k1.verify(compactSig, hash, fullPk, { prehash: false });
  }

  return ed25519.verify(sig, hash, pk);
}
