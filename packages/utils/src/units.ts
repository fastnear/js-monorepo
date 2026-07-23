// Pure NEAR unit math — no imports, so amount-parsing can be pulled into
// size-sensitive bundles (transaction mapping, the sandboxed wallet
// executors) without dragging in storage or codec dependencies.

const UNIT_DECIMALS: Record<string, number> = {
  near: 24,
  tgas: 12,
  ggas: 9,
  gas: 0,
  yoctonear: 0,
};

/**
 * Scale a decimal string by `shift` decimal places using BigInt.
 * Positive shift multiplies (e.g. NEAR → yoctoNEAR), zero shift truncates decimals.
 */
export function scaleDecimal(amount: string, shift: number): string {
  const [whole, frac = ""] = amount.split(".");
  if (shift >= 0) {
    // Pad fractional part to `shift` digits, then concatenate — this multiplies by 10^shift
    const padded = frac.padEnd(shift, "0").slice(0, shift);
    const extra = frac.length > shift ? frac.slice(shift) : "";
    if (extra && BigInt(extra) !== 0n) {
      throw new Error(`Precision loss: "${amount}" has more than ${shift} decimal places`);
    }
    return BigInt(whole + padded).toString();
  }
  // Negative shift: divide by 10^|shift| (shouldn't happen with current units)
  const divisor = 10n ** BigInt(-shift);
  const bigVal = BigInt(whole);
  const intPart = bigVal / divisor;
  const remainder = bigVal % divisor;
  if (remainder === 0n) return intPart.toString();
  const fracStr = remainder.toString().padStart(-shift, "0").replace(/0+$/, "");
  return `${intPart}.${fracStr}`;
}

export function convertUnit(s: string | TemplateStringsArray, ...args: any[]): string {
  // Reconstruct raw string from template literal
  if (Array.isArray(s)) {
    s = s.reduce((acc, part, i) => {
      return acc + (args[i - 1] ?? "") + part;
    });
  }
  // Convert from `100 NEAR` into yoctoNear
  if (typeof s == "string") {
    const match = s.match(/([0-9.,_]+)\s*([a-zA-Z]+)?/);
    if (match) {
      const amount = match[1].replace(/[_,]/g, "");
      const unitPart = match[2];
      if (unitPart) {
        const decimals = UNIT_DECIMALS[unitPart.toLowerCase()];
        if (decimals === undefined) throw new Error(`Unknown unit: ${unitPart}`);
        return scaleDecimal(amount, decimals);
      } else {
        // No unit — truncate any decimals
        return scaleDecimal(amount, 0);
      }
    }
  }
  return scaleDecimal(`${s}`, 0);
}
