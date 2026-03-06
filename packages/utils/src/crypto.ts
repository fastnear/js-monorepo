import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromBase58, toBase58 } from "./misc.js";

export { sha256 };

export type KeyCurve = "ed25519" | "secp256k1";

export function curveFromKey(key: string): KeyCurve {
  if (!key.includes(":")) return "ed25519";
  const curve = key.split(":")[0];
  if (curve === "ed25519" || curve === "secp256k1") return curve;
  throw new Error(`Unsupported curve: ${curve}`);
}

export const keyFromString = (key) =>
  fromBase58(
    key.includes(":")
      ? (() => {
          const [curve, keyPart] = key.split(":");
          if (curve !== "ed25519" && curve !== "secp256k1") {
            throw new Error(`Unsupported curve: ${curve}`);
          }
          return keyPart;
        })()
      : key,
  );

export const keyToString = (key: Uint8Array, curve: KeyCurve = "ed25519") =>
  `${curve}:${toBase58(key)}`;

export function publicKeyFromPrivate(privateKey: string) {
  const curve = curveFromKey(privateKey);
  if (curve === "secp256k1") {
    const secret = keyFromString(privateKey);
    const fullPk = secp256k1.getPublicKey(secret, false);
    // Strip the 0x04 prefix byte — NEAR stores 64 bytes (x‖y)
    const publicKey = fullPk.slice(1);
    return keyToString(publicKey, "secp256k1");
  }
  const secret = keyFromString(privateKey).slice(0, 32);
  const publicKey = ed25519.getPublicKey(secret);
  return keyToString(publicKey);
}

export function privateKeyFromRandom(curve: KeyCurve = "ed25519") {
  const size = curve === "secp256k1" ? 32 : 64;
  const privateKey = crypto.getRandomValues(new Uint8Array(size));
  return keyToString(privateKey, curve);
}

export function signHash(hashBytes: Uint8Array, privateKey: string, opts?: any): Uint8Array | string {
  const curve = curveFromKey(privateKey);

  let signature: Uint8Array;
  if (curve === "secp256k1") {
    const secret = keyFromString(privateKey);
    // 'recovered' format returns 65 bytes: [v(1), r(32), s(32)]
    const raw = secp256k1.sign(hashBytes, secret, { prehash: false, format: 'recovered' });
    // NEAR expects [r(32), s(32), v(1)]
    signature = new Uint8Array(65);
    signature.set(raw.slice(1, 33), 0);   // r
    signature.set(raw.slice(33, 65), 32);  // s
    signature[64] = raw[0];               // v
  } else {
    const secret = keyFromString(privateKey).slice(0, 32);
    signature = ed25519.sign(hashBytes, secret);
  }

  if (opts?.returnBase58) {
    return toBase58(signature);
  }

  return signature;
}

export function signBytes(bytes: Uint8Array, privateKey: string) {
  const hash = sha256(bytes);
  return signHash(hash, privateKey);
}
