import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { randomBytes } from "@noble/hashes/utils.js";
import {
  ML_DSA_65_PUBLIC_KEY_LENGTH,
  ML_DSA_65_SEED_LENGTH,
  ML_DSA_65_SECRET_KEY_LENGTH,
  ML_DSA_65_SIGNATURE_LENGTH,
  type MlDsa65PublicKey,
  type MlDsa65PublicKeyHandle,
  type MlDsa65SecretKey,
  type MlDsa65Signature,
  assertMlDsa65Bytes,
  decodePublicKey,
  decodeSecretKey,
  decodeSignature,
  encodePublicKey,
  encodeSecretKey,
  publicKeyToHandle,
} from "./codecs.js";

export interface MlDsa65Signer {
  readonly publicKey: MlDsa65PublicKey;
  readonly publicKeyHandle: MlDsa65PublicKeyHandle;
  readonly destroyed: boolean;

  /** Sign exactly one SHA-256 transaction hash using pure randomized ML-DSA. */
  signHash(hash: Uint8Array): Uint8Array;

  /** Export a defensive copy of the seed, or null for expanded-key imports. */
  exportSeed(): Uint8Array | null;

  /** Export the nearcore-compatible 4,032-byte expanded secret key. */
  exportSecretKey(): MlDsa65SecretKey;

  /** Best-effort zeroize retained secret material and disable this signer. */
  destroy(): void;
}

export interface VerifyHashInput {
  hash: Uint8Array;
  signature: MlDsa65Signature | Uint8Array;
  publicKey: MlDsa65PublicKey | Uint8Array;
}

class NobleMlDsa65Signer implements MlDsa65Signer {
  declare readonly publicKey: MlDsa65PublicKey;
  declare readonly publicKeyHandle: MlDsa65PublicKeyHandle;

  #seed: Uint8Array | null;
  #secretKey: Uint8Array | null;
  #destroyed = false;

  constructor(
    secretKey: Uint8Array,
    publicKey: Uint8Array,
    seed: Uint8Array | null,
  ) {
    this.#secretKey = assertMlDsa65Bytes(
      secretKey,
      ML_DSA_65_SECRET_KEY_LENGTH,
      "ML-DSA-65 secret key",
    ).slice();
    this.#seed = seed === null
      ? null
      : assertMlDsa65Bytes(
          seed,
          ML_DSA_65_SEED_LENGTH,
          "ML-DSA-65 seed",
        ).slice();

    const encodedPublicKey = encodePublicKey(
      assertMlDsa65Bytes(
        publicKey,
        ML_DSA_65_PUBLIC_KEY_LENGTH,
        "ML-DSA-65 public key",
      ),
    );
    Object.defineProperties(this, {
      publicKey: {
        value: encodedPublicKey,
        enumerable: true,
        writable: false,
        configurable: false,
      },
      publicKeyHandle: {
        value: publicKeyToHandle(encodedPublicKey),
        enumerable: true,
        writable: false,
        configurable: false,
      },
    });
    Object.freeze(this);
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  signHash(hash: Uint8Array): Uint8Array {
    this.#assertUsable();
    assertMlDsa65Bytes(hash, 32, "NEAR transaction hash");

    // No prehash wrapper and no context: NEAR signs SHA-256(Transaction)
    // directly with pure ML-DSA. Noble supplies 32 bytes of fresh entropy by
    // default, giving the randomized signing behavior selected by nearcore.
    return ml_dsa65.sign(hash, this.#secretKey!);
  }

  exportSeed(): Uint8Array | null {
    this.#assertUsable();
    return this.#seed?.slice() ?? null;
  }

  exportSecretKey(): MlDsa65SecretKey {
    this.#assertUsable();
    return encodeSecretKey(this.#secretKey!);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#seed?.fill(0);
    this.#secretKey?.fill(0);
    this.#seed = null;
    this.#secretKey = null;
    this.#destroyed = true;
  }

  #assertUsable(): void {
    if (this.#destroyed || this.#secretKey === null) {
      throw new Error("ML-DSA-65 signer has been destroyed");
    }
  }
}

/** Create a signer from a fresh, CSPRNG-generated 32-byte FIPS 204 seed. */
export function generateSigner(): MlDsa65Signer {
  const seed = randomBytes(ML_DSA_65_SEED_LENGTH);
  try {
    return signerFromSeed(seed);
  } finally {
    seed.fill(0);
  }
}

/** Deterministically create a signer from exactly 32 seed bytes. */
export function signerFromSeed(seed: Uint8Array): MlDsa65Signer {
  assertMlDsa65Bytes(seed, ML_DSA_65_SEED_LENGTH, "ML-DSA-65 seed");
  const seedCopy = seed.slice();
  let generatedSecretKey: Uint8Array | undefined;
  try {
    const { secretKey, publicKey } = ml_dsa65.keygen(seedCopy);
    generatedSecretKey = secretKey;
    return new NobleMlDsa65Signer(secretKey, publicKey, seedCopy);
  } finally {
    seedCopy.fill(0);
    generatedSecretKey?.fill(0);
  }
}

/** Import a nearcore-compatible expanded secret key. */
export function signerFromSecretKey(
  secretKey: MlDsa65SecretKey | string | Uint8Array,
): MlDsa65Signer {
  const decoded = typeof secretKey === "string"
    ? decodeSecretKey(secretKey)
    : assertMlDsa65Bytes(
        secretKey,
        ML_DSA_65_SECRET_KEY_LENGTH,
        "ML-DSA-65 secret key",
      ).slice();
  try {
    const publicKey = ml_dsa65.getPublicKey(decoded);
    return new NobleMlDsa65Signer(decoded, publicKey, null);
  } finally {
    decoded.fill(0);
  }
}

/** Verify a signature over exactly one 32-byte NEAR transaction hash. */
export function verifyHash({
  hash,
  signature,
  publicKey,
}: VerifyHashInput): boolean {
  assertMlDsa65Bytes(hash, 32, "NEAR transaction hash");
  const signatureBytes = typeof signature === "string"
    ? decodeSignature(signature)
    : assertMlDsa65Bytes(
        signature,
        ML_DSA_65_SIGNATURE_LENGTH,
        "ML-DSA-65 signature",
      );
  const publicKeyBytes = typeof publicKey === "string"
    ? decodePublicKey(publicKey)
    : assertMlDsa65Bytes(
        publicKey,
        ML_DSA_65_PUBLIC_KEY_LENGTH,
        "ML-DSA-65 public key",
      );

  // This is FIPS 204's pure ML-DSA path with an empty context. Do not use
  // ml_dsa65.prehash(), which implements the distinct HashML-DSA scheme.
  return ml_dsa65.verify(signatureBytes, hash, publicKeyBytes);
}
