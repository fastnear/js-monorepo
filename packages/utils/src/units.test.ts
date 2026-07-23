import { describe, it, expect } from "vitest";
import { convertUnit, formatNearAmount, formatUnit } from "./units.js";

describe("formatNearAmount (reverse of convertUnit)", () => {
  it("renders whole and fractional NEAR", () => {
    expect(formatNearAmount("1500000000000000000000000")).toBe("1.5");
    expect(formatNearAmount("2000000000000000000000000")).toBe("2");
    expect(formatNearAmount("10000000000000000000000")).toBe("0.01");
    expect(formatNearAmount("1")).toBe("0.000000000000000000000001");
    expect(formatNearAmount("0")).toBe("0");
  });

  it("accepts string and bigint input, always returns a decimal string", () => {
    const out = formatNearAmount(1500000000000000000000000n);
    expect(out).toBe("1.5");
    expect(typeof out).toBe("string");
  });

  it("round-trips with convertUnit for representative amounts", () => {
    // Each input is already in canonical trimmed form, so the round-trip is exact.
    for (const human of ["0", "1", "2.5", "0.01", "123.456789", "1000000"]) {
      const yocto = convertUnit(`${human} NEAR`);
      expect(formatNearAmount(yocto)).toBe(human);
    }
  });

  it("caps fractional digits and can pad instead of trim", () => {
    // 1.23456789 NEAR
    const yocto = convertUnit("1.23456789 NEAR");
    expect(formatNearAmount(yocto, { fracDigits: 4 })).toBe("1.2345");
    expect(formatNearAmount("1500000000000000000000000", { fracDigits: 4, trimZeros: false })).toBe("1.5000");
    expect(formatNearAmount("2000000000000000000000000", { fracDigits: 2, trimZeros: false })).toBe("2.00");
  });
});

describe("formatUnit (other units)", () => {
  it("formats Tgas", () => {
    expect(formatUnit("30000000000000", "tgas")).toBe("30");
    expect(formatUnit("100000000000000", "tgas")).toBe("100");
  });

  it("rejects unknown units", () => {
    expect(() => formatUnit("1", "parsecs")).toThrow(/Unknown unit/);
  });
});
