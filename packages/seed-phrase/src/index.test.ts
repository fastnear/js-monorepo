import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { keyFromString } from "@fastnear/utils";
import {
  NEAR_DERIVATION_PATH,
  generateSeedPhrase,
  parseSeedPhrase,
} from "./index.js";

// Golden vector generated from the reference `near-seed-phrase` (0.2.1) — the
// same library near-api-js and near-cli use. If derivation drifts, recovered
// keys stop matching every other NEAR tool, so this is the acceptance gate.
const VECTOR = {
  seedPhrase:
    "shoot island position soft burden budget tooth cruel issue economy destroy above",
  publicKey: "ed25519:r4yuiZE45mzeZAENDEF2pWeFBJkW8mQYGx3rU46zCqh",
  privateKey:
    "ed25519:3jFpZEcbhcjpqVE27zU3d7WHcS7Wq716v5WryU8Tj4EaNTHTj8iAhtPW7KCdFV2fnjNf9toawUbdqZnhrRtLKe6w",
};

describe("parseSeedPhrase", () => {
  it("matches the near-seed-phrase golden vector byte-for-byte", () => {
    const keys = parseSeedPhrase(VECTOR.seedPhrase);
    expect(keys.publicKey).toBe(VECTOR.publicKey);
    expect(keys.privateKey).toBe(VECTOR.privateKey);
  });

  it("uses the NEAR default derivation path", () => {
    expect(NEAR_DERIVATION_PATH).toBe("m/44'/397'/0'");
    expect(parseSeedPhrase(VECTOR.seedPhrase, NEAR_DERIVATION_PATH)).toEqual(
      parseSeedPhrase(VECTOR.seedPhrase),
    );
  });

  it("normalizes casing and spacing before deriving", () => {
    const messy = `  SHOOT   island Position soft burden budget tooth cruel issue economy destroy ABOVE `;
    expect(parseSeedPhrase(messy).privateKey).toBe(VECTOR.privateKey);
  });

  it("rejects an invalid mnemonic", () => {
    expect(() => parseSeedPhrase("not a real seed phrase at all nope")).toThrow(
      /Invalid BIP-39 seed phrase/,
    );
  });

  it("derives a private key whose embedded public key is self-consistent", () => {
    const keys = parseSeedPhrase(VECTOR.seedPhrase);
    const secret = keyFromString(keys.privateKey); // 64 bytes: seed ‖ pub
    const pub = keyFromString(keys.publicKey);
    expect(ed25519.getPublicKey(secret.slice(0, 32))).toEqual(pub);
    expect(secret.slice(32)).toEqual(pub);
  });
});

describe("generateSeedPhrase", () => {
  it("produces a valid phrase that round-trips back to the same keys", () => {
    const generated = generateSeedPhrase();
    expect(generated.seedPhrase.split(" ")).toHaveLength(12);
    const reparsed = parseSeedPhrase(generated.seedPhrase);
    expect(reparsed.publicKey).toBe(generated.publicKey);
    expect(reparsed.privateKey).toBe(generated.privateKey);
  });

  it("supports 24-word phrases", () => {
    const generated = generateSeedPhrase(256);
    expect(generated.seedPhrase.split(" ")).toHaveLength(24);
  });
});
