import { decodeNearPublicKey } from "@fastnear/utils";
import type { NearPublicKey } from "@fastnear/utils";

/** Select a full classical key, ignoring ML-DSA list handles and malformed keys. */
export function firstClassicalPublicKey(
  publicKeys: readonly string[],
): NearPublicKey | null {
  for (const publicKey of publicKeys) {
    try {
      const { keyType } = decodeNearPublicKey(publicKey);
      if (keyType !== "ml-dsa-65") return publicKey as NearPublicKey;
    } catch {
      // Access-key lists expose ML-DSA keys as hash handles, which cannot be
      // inserted into a transaction. Ignore them and continue to a full key.
    }
  }
  return null;
}
