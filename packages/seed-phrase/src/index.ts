import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { toBase58 } from "@fastnear/utils";

/**
 * NEAR's default account derivation path. Matches `near-seed-phrase`
 * (`m/44'/397'/0'`) so keys recovered here line up with near-cli and wallets.
 */
export const NEAR_DERIVATION_PATH = "m/44'/397'/0'";

export interface SeedPhraseKeys {
  /** The normalized BIP-39 mnemonic. */
  seedPhrase: string;
  /** `ed25519:` full-access public key. */
  publicKey: `ed25519:${string}`;
  /** `ed25519:` 64-byte private key (seed ‖ public key). */
  privateKey: `ed25519:${string}`;
}

const HARDENED_OFFSET = 0x80000000;
const ED25519_CURVE = new TextEncoder().encode("ed25519 seed");

interface Slip10Node {
  key: Uint8Array;
  chainCode: Uint8Array;
}

// Whitespace-normalize and lowercase, matching near-seed-phrase so a phrase
// typed with odd spacing or casing still derives the same key.
function normalizeSeedPhrase(seedPhrase: string): string {
  return seedPhrase
    .trim()
    .split(/\s+/)
    .map((word) => word.toLowerCase())
    .join(" ");
}

function slip10Master(seed: Uint8Array): Slip10Node {
  const I = hmac(sha512, ED25519_CURVE, seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32, 64) };
}

// SLIP-0010 hardened child derivation for ed25519 (only hardened is defined).
function slip10DeriveChild(node: Slip10Node, index: number): Slip10Node {
  const data = new Uint8Array(37);
  data[0] = 0x00;
  data.set(node.key, 1);
  new DataView(data.buffer).setUint32(33, index >>> 0, false); // big-endian
  const I = hmac(sha512, node.chainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32, 64) };
}

function deriveEd25519Seed(path: string, seed: Uint8Array): Uint8Array {
  let node = slip10Master(seed);
  for (const segment of path.split("/").slice(1)) {
    const index = Number.parseInt(segment.replace(/'$/, ""), 10);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid derivation path segment: "${segment}"`);
    }
    node = slip10DeriveChild(node, (index + HARDENED_OFFSET) >>> 0);
  }
  return node.key;
}

/**
 * Recover the NEAR ed25519 key pair for a BIP-39 seed phrase. The output is
 * byte-identical to near-seed-phrase / near-cli for the default path.
 */
export function parseSeedPhrase(
  seedPhrase: string,
  derivationPath: string = NEAR_DERIVATION_PATH,
): SeedPhraseKeys {
  const normalized = normalizeSeedPhrase(seedPhrase);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error("Invalid BIP-39 seed phrase");
  }
  const seed = mnemonicToSeedSync(normalized);
  const secretSeed = deriveEd25519Seed(derivationPath, seed);
  const publicKey = ed25519.getPublicKey(secretSeed);
  // NEAR stores the ed25519 secret key as seed(32) ‖ publicKey(32).
  const secretKey = new Uint8Array(64);
  secretKey.set(secretSeed);
  secretKey.set(publicKey, 32);
  return {
    seedPhrase: normalized,
    publicKey: `ed25519:${toBase58(publicKey)}`,
    privateKey: `ed25519:${toBase58(secretKey)}`,
  };
}

/**
 * Generate a fresh BIP-39 seed phrase and its NEAR key pair. `strength` is the
 * entropy in bits (128 → 12 words, 256 → 24 words).
 */
export function generateSeedPhrase(strength: 128 | 160 | 192 | 224 | 256 = 128): SeedPhraseKeys {
  const seedPhrase = generateMnemonic(wordlist, strength);
  return parseSeedPhrase(seedPhrase);
}
