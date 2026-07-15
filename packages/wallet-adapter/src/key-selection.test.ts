import { describe, expect, it } from "vitest";
import { keyToString } from "@fastnear/utils";
import { firstClassicalPublicKey } from "./key-selection.js";

describe("firstClassicalPublicKey", () => {
  it("skips an ML-DSA hash handle and selects the next classical key", () => {
    const classical = keyToString(new Uint8Array(32), "ed25519");
    expect(firstClassicalPublicKey([
      "ml-dsa-65-hash:11111111111111111111111111111111",
      classical,
    ])).toBe(classical);
  });

  it("returns null when no full classical key is available", () => {
    expect(firstClassicalPublicKey([
      "ml-dsa-65-hash:11111111111111111111111111111111",
      "not a key",
    ])).toBeNull();
  });
});
