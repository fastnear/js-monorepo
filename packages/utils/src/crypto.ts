import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromBase58, toBase58 } from "./misc.js";

export { sha256 };

export type KeyCurve = "ed25519" | "secp256k1";
export type NearKeyType = KeyCurve | "ml-dsa-65";
export type NearKeyString = `${NearKeyType}:${string}`;
export type NearPublicKey = NearKeyString;
export type NearPublicKeyHandle = NearPublicKey | `ml-dsa-65-hash:${string}`;
export type NearPrivateKey = `${KeyCurve}:${string}`;

export interface TransactionSigner {
  readonly publicKey: NearPublicKey;
  signHash(hash: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

export interface NearKeyDescriptor {
  readonly borshTag: 0 | 1 | 2;
  readonly publicKeyVariant: string;
  readonly signatureVariant: string;
  readonly publicKeyLength: number;
  readonly signatureLength: number;
  readonly privateKeyLengths: readonly number[];
}

/** Protocol-level key sizes. This contains no post-quantum implementation. */
export const NEAR_KEY_DESCRIPTORS = {
  ed25519: {
    borshTag: 0,
    publicKeyVariant: "ed25519Key",
    signatureVariant: "ed25519Signature",
    publicKeyLength: 32,
    signatureLength: 64,
    privateKeyLengths: [32, 64],
  },
  secp256k1: {
    borshTag: 1,
    publicKeyVariant: "secp256k1Key",
    signatureVariant: "secp256k1Signature",
    publicKeyLength: 64,
    signatureLength: 65,
    privateKeyLengths: [32],
  },
  "ml-dsa-65": {
    borshTag: 2,
    publicKeyVariant: "mlDsa65Key",
    signatureVariant: "mlDsa65Signature",
    publicKeyLength: 1952,
    signatureLength: 3309,
    privateKeyLengths: [4032],
  },
} as const satisfies Record<NearKeyType, NearKeyDescriptor>;

export function keyTypeFromString(key: string): NearKeyType {
  const separator = key.indexOf(":");
  if (separator === -1) return "ed25519";

  const keyType = key.slice(0, separator);
  if (
    keyType === "ed25519" ||
    keyType === "secp256k1" ||
    keyType === "ml-dsa-65"
  ) {
    return keyType;
  }
  if (keyType === "ml-dsa-65-hash") {
    throw new Error(
      "ML-DSA-65 public-key handles cannot be used where a full public key is required",
    );
  }
  throw new Error(`Unsupported key type: ${keyType}`);
}

/** @deprecated Key types are not all elliptic curves. Use keyTypeFromString. */
export function curveFromKey(key: string): KeyCurve {
  if (!key.includes(":")) return "ed25519";
  const curve = key.slice(0, key.indexOf(":"));
  if (curve === "ed25519" || curve === "secp256k1") return curve;
  throw new Error(`Unsupported curve: ${curve}`);
}

export const keyFromString = (key: string) => {
  keyTypeFromString(key);
  const separator = key.indexOf(":");
  const keyPart = separator === -1 ? key : key.slice(separator + 1);
  const data = fromBase58(keyPart);
  if (!keyPart || toBase58(data) !== keyPart) {
    throw new Error("Invalid base58 encoding");
  }
  return data;
};

export function keyToString(key: Uint8Array): `ed25519:${string}`;
export function keyToString<K extends NearKeyType>(
  key: Uint8Array,
  keyType: K,
): `${K}:${string}`;
export function keyToString(
  key: Uint8Array,
  keyType: NearKeyType = "ed25519",
): NearKeyString {
  return `${keyType}:${toBase58(key)}`;
}

/** Decode and validate a full public key, rejecting hashed ML-DSA handles. */
export function decodeNearPublicKey(publicKey: string): {
  keyType: NearKeyType;
  data: Uint8Array;
} {
  const keyType = keyTypeFromString(publicKey);
  const data = keyFromString(publicKey);
  const expected = NEAR_KEY_DESCRIPTORS[keyType].publicKeyLength;
  if (data.length !== expected) {
    throw new Error(
      `Invalid ${keyType} public key length: expected ${expected} bytes, got ${data.length}`,
    );
  }
  return { keyType, data };
}

export function assertNearValidatorPublicKey(publicKey: string): void {
  if (decodeNearPublicKey(publicKey).keyType === "ml-dsa-65") {
    throw new Error(
      "ML-DSA-65 is an account access-key type; validator staking keys must be Ed25519",
    );
  }
}

/** Decode and validate a classical NEAR private key. */
export function decodeNearPrivateKey(privateKey: string): {
  keyType: KeyCurve;
  data: Uint8Array;
} {
  const keyType = curveFromKey(privateKey);
  const data = keyFromString(privateKey);
  const allowedLengths = NEAR_KEY_DESCRIPTORS[keyType].privateKeyLengths;
  if (!(allowedLengths as readonly number[]).includes(data.length)) {
    throw new Error(
      `Invalid ${keyType} private key length: expected ${allowedLengths.join(" or ")} bytes, got ${data.length}`,
    );
  }

  return { keyType, data };
}

export function publicKeyFromPrivate(privateKey: string): NearPublicKey {
  const { keyType, data } = decodeNearPrivateKey(privateKey);
  if (keyType === "secp256k1") {
    const secret = data;
    const fullPk = secp256k1.getPublicKey(secret, false);
    // Strip the 0x04 prefix byte — NEAR stores 64 bytes (x‖y)
    const publicKey = fullPk.slice(1);
    return keyToString(publicKey, "secp256k1");
  }
  const secret = data.subarray(0, 32);
  const publicKey = ed25519.getPublicKey(secret);
  return keyToString(publicKey);
}

export function privateKeyFromRandom(
  curve: KeyCurve = "ed25519",
): NearPrivateKey {
  if (curve === "secp256k1") {
    return keyToString(crypto.getRandomValues(new Uint8Array(32)), curve);
  }

  // NEAR's 64-byte Ed25519 secret-key representation is seed || public key.
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const privateKey = new Uint8Array(64);
  privateKey.set(seed);
  privateKey.set(ed25519.getPublicKey(seed), 32);
  return keyToString(privateKey, curve);
}

export function signHash(
  hashBytes: Uint8Array,
  privateKey: string,
  opts: { returnBase58: true },
): string;
export function signHash(
  hashBytes: Uint8Array,
  privateKey: string,
  opts?: { returnBase58?: false },
): Uint8Array;
export function signHash(
  hashBytes: Uint8Array,
  privateKey: string,
  opts?: { returnBase58?: boolean },
): Uint8Array | string {
  const { keyType, data } = decodeNearPrivateKey(privateKey);

  let signature: Uint8Array;
  if (keyType === "secp256k1") {
    const secret = data;
    // 'recovered' format returns 65 bytes: [v(1), r(32), s(32)]
    const raw = secp256k1.sign(hashBytes, secret, {
      prehash: false,
      format: "recovered",
    });
    // NEAR expects [r(32), s(32), v(1)]
    signature = new Uint8Array(65);
    signature.set(raw.slice(1, 33), 0); // r
    signature.set(raw.slice(33, 65), 32); // s
    signature[64] = raw[0]; // v
  } else {
    const secret = data.subarray(0, 32);
    signature = ed25519.sign(hashBytes, secret);
  }

  if (opts?.returnBase58) {
    return toBase58(signature);
  }

  return signature;
}

/** Create a structural signer for an existing classical NEAR private key. */
export function signerFromPrivateKey(privateKey: string): TransactionSigner {
  const publicKey = publicKeyFromPrivate(privateKey);
  return {
    publicKey,
    signHash: (hash) => signHash(hash, privateKey),
  };
}

export function signBytes(bytes: Uint8Array, privateKey: string) {
  const hash = sha256(bytes);
  return signHash(hash, privateKey);
}
