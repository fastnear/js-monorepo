export {
  ML_DSA_65_PROTOCOL_VERSION,
  ML_DSA_65_SEED_LENGTH,
  ML_DSA_65_PUBLIC_KEY_LENGTH,
  ML_DSA_65_SECRET_KEY_LENGTH,
  ML_DSA_65_SIGNATURE_LENGTH,
  ML_DSA_65_PUBLIC_KEY_HANDLE_LENGTH,
  ML_DSA_65_PUBLIC_KEY_PREFIX,
  ML_DSA_65_SECRET_KEY_PREFIX,
  ML_DSA_65_SIGNATURE_PREFIX,
  ML_DSA_65_PUBLIC_KEY_HANDLE_PREFIX,
  encodePublicKey,
  decodePublicKey,
  encodeSecretKey,
  decodeSecretKey,
  encodeSignature,
  decodeSignature,
  encodePublicKeyHandle,
  decodePublicKeyHandle,
  publicKeyToHandle,
} from "./codecs.js";
export type {
  MlDsa65PublicKey,
  MlDsa65SecretKey,
  MlDsa65Signature,
  MlDsa65PublicKeyHandle,
} from "./codecs.js";
export * from "./signer.js";

import * as codec from "./codecs.js";
import {
  generateSigner,
  signerFromSecretKey,
  signerFromSeed,
  verifyHash,
} from "./signer.js";

/** Convenient namespace-style export for script-tag and exploratory use. */
export const mlDsa65 = Object.freeze({
  ...codec.mlDsa65Codec,
  generateSigner,
  signerFromSeed,
  signerFromSecretKey,
  verifyHash,
});
