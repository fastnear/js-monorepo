import { describe, expect, it, vi } from "vitest";
import { assertLaneAdvanced, errorText, isGasKeyError, residualBurn, unknownAccessKey } from "./gas-key-testnet-helpers.mjs";

describe("gas-key smoke helpers", () => {
  it("assertLaneAdvanced accepts exactly one advanced lane and reports the rest", () => {
    expect(assertLaneAdvanced({ before: ["10", "20"], after: ["11", "20"], index: 0 })).toEqual({ advanced: 0, unchanged: [1] });
    expect(assertLaneAdvanced({ before: [10, 20], after: [10, 25], index: 1 })).toEqual({ advanced: 1, unchanged: [0] });
    // u64 lane nonces beyond Number precision are compared exactly.
    const big = (2n ** 60n).toString();
    expect(assertLaneAdvanced({ before: [big], after: [(2n ** 60n + 1n).toString()], index: 0 })).toEqual({ advanced: 0, unchanged: [] });
  });

  it("assertLaneAdvanced rejects a stalled lane, a moved neighbour, and bad shapes", () => {
    expect(() => assertLaneAdvanced({ before: [10, 20], after: [10, 20], index: 0 })).toThrow("lane 0 did not advance");
    expect(() => assertLaneAdvanced({ before: [10, 20], after: [11, 21], index: 0 })).toThrow("lane 1 moved unexpectedly");
    expect(() => assertLaneAdvanced({ before: [10, 20], after: [11], index: 0 })).toThrow("lane count changed");
    expect(() => assertLaneAdvanced({ before: [10], after: [11], index: 1 })).toThrow("outside 0..0");
  });

  it("residualBurn throws above 1 NEAR, warns above dust, and returns the balance", () => {
    const warn = vi.fn();
    expect(residualBurn("0", { warn })).toBe(0n);
    expect(residualBurn((10n ** 21n).toString(), { warn })).toBe(10n ** 21n);
    expect(warn).not.toHaveBeenCalled();
    expect(residualBurn((5n * 10n ** 21n).toString(), { warn })).toBe(5n * 10n ** 21n);
    expect(warn).toHaveBeenCalledOnce();
    expect(() => residualBurn((10n ** 24n + 1n).toString(), { warn })).toThrow("> 1 NEAR");
  });

  it("recognises access-key and gas-key errors in messages and structured data", () => {
    expect(unknownAccessKey(new Error("access key ed25519:x does not exist while viewing"))).toBe(true);
    expect(unknownAccessKey("UnknownAccessKey")).toBe(true);
    expect(unknownAccessKey(new Error("timeout"))).toBe(false);

    const rpc = Object.assign(new Error('{"code":-32000,"name":"HANDLER_ERROR"}'), {
      data: { cause: { name: "UNKNOWN_GAS_KEY" } },
    });
    expect(isGasKeyError(rpc)).toBe(true);
    expect(isGasKeyError(rpc, "UNKNOWN_GAS_KEY")).toBe(true);
    expect(isGasKeyError(rpc, "InsufficientGasKeyBalance")).toBe(false);
    expect(isGasKeyError(new Error("InsufficientGasKeyBalance"))).toBe(true);
    expect(errorText({ nested: true })).toBe('{"nested":true}');
  });
});
