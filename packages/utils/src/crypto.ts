import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromBase58, toBase58 } from "./misc.js";

export { sha256 };

export const keyFromString = (key) =>
  fromBase58(
    key.includes(":")
      ? (() => {
          const [curve, keyPart] = key.split(":");
          if (curve !== "ed25519") {
            throw new Error(`Unsupported curve: ${curve}`);
          }
          return keyPart;
        })()
      : key,
  );

export const keyToString = (key: Uint8Array) => `ed25519:${toBase58(key)}`;

export function publicKeyFromPrivate(privateKey: string) {
  const secret = keyFromString(privateKey).slice(0, 32);
  const publicKey = ed25519.getPublicKey(secret);
  return keyToString(publicKey);
}

export function privateKeyFromRandom() {
  const privateKey = crypto.getRandomValues(new Uint8Array(64));
  return keyToString(privateKey);
}

export function signHash(hashBytes: Uint8Array, privateKey: string, opts?: any): Uint8Array | string {
  const secret = keyFromString(privateKey).slice(0, 32);
  const signature = ed25519.sign(hashBytes, secret);

  if (opts?.returnBase58) {
    return toBase58(signature);
  }

  return signature;
}

export function signBytes(bytes: Uint8Array, privateKey: string) {
  const hash = sha256(bytes);
  return signHash(hash, privateKey);
}
