import {
  base58_to_binary as fromBase58,
  binary_to_base58 as toBase58,
} from "base58-js";
import { sha3_256 } from "@noble/hashes/sha3.js";

export const ML_DSA_65_PROTOCOL_VERSION = 85;
export const ML_DSA_65_SEED_LENGTH = 32;
export const ML_DSA_65_PUBLIC_KEY_LENGTH = 1952;
export const ML_DSA_65_SECRET_KEY_LENGTH = 4032;
export const ML_DSA_65_SIGNATURE_LENGTH = 3309;
export const ML_DSA_65_PUBLIC_KEY_HANDLE_LENGTH = 32;

export const ML_DSA_65_PUBLIC_KEY_PREFIX = "ml-dsa-65:";
export const ML_DSA_65_SECRET_KEY_PREFIX = "ml-dsa-65:";
export const ML_DSA_65_SIGNATURE_PREFIX = "ml-dsa-65:";
export const ML_DSA_65_PUBLIC_KEY_HANDLE_PREFIX = "ml-dsa-65-hash:";

const ML_DSA_65_HANDLE_DOMAIN = new TextEncoder().encode(
  "near:ml-dsa-65-pubkey-hash:v1",
);

declare const publicKeyBrand: unique symbol;
declare const secretKeyBrand: unique symbol;
declare const signatureBrand: unique symbol;
declare const publicKeyHandleBrand: unique symbol;

/** A NEAR text-format ML-DSA-65 public key containing all 1,952 key bytes. */
export type MlDsa65PublicKey = `ml-dsa-65:${string}` & {
  readonly [publicKeyBrand]: "MlDsa65PublicKey";
};

/** A NEAR text-format ML-DSA-65 expanded secret key containing 4,032 bytes. */
export type MlDsa65SecretKey = `ml-dsa-65:${string}` & {
  readonly [secretKeyBrand]: "MlDsa65SecretKey";
};

/** A NEAR text-format ML-DSA-65 signature containing 3,309 bytes. */
export type MlDsa65Signature = `ml-dsa-65:${string}` & {
  readonly [signatureBrand]: "MlDsa65Signature";
};

/** The SHA3-256 handle returned for an ML-DSA-65 key in access-key lists. */
export type MlDsa65PublicKeyHandle = `ml-dsa-65-hash:${string}` & {
  readonly [publicKeyHandleBrand]: "MlDsa65PublicKeyHandle";
};

function checkedBytes(
  value: Uint8Array,
  expectedLength: number,
  label: string,
): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${label} must be a Uint8Array`);
  }
  if (value.length !== expectedLength) {
    throw new RangeError(
      `${label} must be exactly ${expectedLength} bytes; received ${value.length}`,
    );
  }
  return value;
}

function encode(
  value: Uint8Array,
  expectedLength: number,
  prefix: string,
  label: string,
): string {
  return `${prefix}${toBase58(checkedBytes(value, expectedLength, label))}`;
}

function decode(
  value: string,
  expectedLength: number,
  prefix: string,
  label: string,
): Uint8Array {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  if (!value.startsWith(prefix)) {
    throw new Error(`${label} must start with "${prefix}"`);
  }

  const encoded = value.slice(prefix.length);
  if (encoded.length === 0) {
    throw new Error(`${label} has an empty base58 payload`);
  }

  let bytes: Uint8Array;
  try {
    bytes = fromBase58(encoded);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not valid base58: ${message}`);
  }

  checkedBytes(bytes, expectedLength, label);
  if (toBase58(bytes) !== encoded) {
    throw new Error(`${label} is not in canonical base58 form`);
  }
  return bytes;
}

export function encodePublicKey(publicKey: Uint8Array): MlDsa65PublicKey {
  return encode(
    publicKey,
    ML_DSA_65_PUBLIC_KEY_LENGTH,
    ML_DSA_65_PUBLIC_KEY_PREFIX,
    "ML-DSA-65 public key",
  ) as MlDsa65PublicKey;
}

export function decodePublicKey(publicKey: string): Uint8Array {
  return decode(
    publicKey,
    ML_DSA_65_PUBLIC_KEY_LENGTH,
    ML_DSA_65_PUBLIC_KEY_PREFIX,
    "ML-DSA-65 public key",
  );
}

export function encodeSecretKey(secretKey: Uint8Array): MlDsa65SecretKey {
  return encode(
    secretKey,
    ML_DSA_65_SECRET_KEY_LENGTH,
    ML_DSA_65_SECRET_KEY_PREFIX,
    "ML-DSA-65 secret key",
  ) as MlDsa65SecretKey;
}

export function decodeSecretKey(secretKey: string): Uint8Array {
  return decode(
    secretKey,
    ML_DSA_65_SECRET_KEY_LENGTH,
    ML_DSA_65_SECRET_KEY_PREFIX,
    "ML-DSA-65 secret key",
  );
}

export function encodeSignature(signature: Uint8Array): MlDsa65Signature {
  return encode(
    signature,
    ML_DSA_65_SIGNATURE_LENGTH,
    ML_DSA_65_SIGNATURE_PREFIX,
    "ML-DSA-65 signature",
  ) as MlDsa65Signature;
}

export function decodeSignature(signature: string): Uint8Array {
  return decode(
    signature,
    ML_DSA_65_SIGNATURE_LENGTH,
    ML_DSA_65_SIGNATURE_PREFIX,
    "ML-DSA-65 signature",
  );
}

export function encodePublicKeyHandle(
  handle: Uint8Array,
): MlDsa65PublicKeyHandle {
  return encode(
    handle,
    ML_DSA_65_PUBLIC_KEY_HANDLE_LENGTH,
    ML_DSA_65_PUBLIC_KEY_HANDLE_PREFIX,
    "ML-DSA-65 public key handle",
  ) as MlDsa65PublicKeyHandle;
}

export function decodePublicKeyHandle(handle: string): Uint8Array {
  return decode(
    handle,
    ML_DSA_65_PUBLIC_KEY_HANDLE_LENGTH,
    ML_DSA_65_PUBLIC_KEY_HANDLE_PREFIX,
    "ML-DSA-65 public key handle",
  );
}

/** Convert a full ML-DSA-65 public key to its compact on-trie identifier. */
export function publicKeyToHandle(
  publicKey: MlDsa65PublicKey | string,
): MlDsa65PublicKeyHandle {
  const publicKeyBytes = decodePublicKey(publicKey);
  const digest = sha3_256
    .create()
    .update(ML_DSA_65_HANDLE_DOMAIN)
    .update(publicKeyBytes)
    .digest();
  return encodePublicKeyHandle(digest);
}

export const mlDsa65Codec = Object.freeze({
  encodePublicKey,
  decodePublicKey,
  encodeSecretKey,
  decodeSecretKey,
  encodeSignature,
  decodeSignature,
  encodePublicKeyHandle,
  decodePublicKeyHandle,
  publicKeyToHandle,
});

export { checkedBytes as assertMlDsa65Bytes };
