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

/**
 * Format a base-unit integer (e.g. yoctoNEAR) into a human-readable decimal
 * string for `unit` — the reverse of {@link convertUnit}. OUT stays a decimal
 * string per the "wide integers are strings" convention; never a bigint/number.
 *
 * Pass `amount` as a decimal string or bigint (a JS `number` large enough to be
 * a real yocto balance can't be represented exactly). `fracDigits` caps the
 * fractional places shown (defaults to the unit's full precision); `trimZeros`
 * strips trailing zeros (default) or pads out to `fracDigits`.
 */
export function formatUnit(
  amount: string | number | bigint,
  unit: string = "near",
  opts: { fracDigits?: number; trimZeros?: boolean } = {},
): string {
  const decimals = UNIT_DECIMALS[unit.toLowerCase()];
  if (decimals === undefined) throw new Error(`Unknown unit: ${unit}`);
  const { fracDigits = decimals, trimZeros = true } = opts;
  const raw = typeof amount === "bigint" ? amount.toString() : `${amount}`;
  // Negative shift divides by 10^decimals and trims trailing zeros already.
  const full = scaleDecimal(raw, -decimals);
  const [whole, existingFrac = ""] = full.split(".");
  let frac = existingFrac.slice(0, fracDigits);
  frac = trimZeros ? frac.replace(/0+$/, "") : frac.padEnd(fracDigits, "0");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Human-readable yoctoNEAR → NEAR string, the reverse of `convertUnit("… NEAR")`.
 * `formatNearAmount("1500000000000000000000000") === "1.5"`.
 */
export function formatNearAmount(
  amount: string | number | bigint,
  opts: { fracDigits?: number; trimZeros?: boolean } = {},
): string {
  return formatUnit(amount, "near", opts);
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
