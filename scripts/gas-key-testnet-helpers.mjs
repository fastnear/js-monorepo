// Pure helpers for scripts/smoke-gas-keys-testnet.mjs, kept separate so they
// can be unit-tested without touching the network.

const ONE_NEAR = 10n ** 24n;
const RESIDUAL_WARN_THRESHOLD = 10n ** 21n; // 0.001 NEAR

/** Message plus any structured RPC payload, so error names in `data` are searchable. */
export function errorText(error) {
  if (error instanceof Error) {
    const data = error.data === undefined || error.data === null ? "" : JSON.stringify(error.data);
    return `${error.message} ${data}`;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}

export function unknownAccessKey(error) {
  return /UnknownAccessKey|UNKNOWN_ACCESS_KEY|does not exist|unknown access key/i.test(errorText(error));
}

/** True when an error names a gas-key failure; pass `name` to match one specifically. */
export function isGasKeyError(error, name) {
  const text = errorText(error);
  if (name) return text.includes(name);
  return /UNKNOWN_GAS_KEY|GasKeyDoesNotExist|InsufficientGasKeyBalance|GasKeyBalanceTooHigh/.test(text);
}

/**
 * Assert exactly one lane moved forward. Lane nonces are u64 and can exceed
 * 2^53, so compare as BigInt.
 */
export function assertLaneAdvanced({ before, after, index }) {
  if (before.length !== after.length) {
    throw new Error(`lane count changed from ${before.length} to ${after.length}`);
  }
  if (index < 0 || index >= after.length) {
    throw new Error(`lane ${index} is outside 0..${after.length - 1}`);
  }
  const unchanged = [];
  for (let lane = 0; lane < after.length; lane += 1) {
    const prev = BigInt(before[lane]);
    const next = BigInt(after[lane]);
    if (lane === index) {
      if (next <= prev) throw new Error(`lane ${lane} did not advance (${prev} -> ${next})`);
    } else {
      if (next !== prev) throw new Error(`lane ${lane} moved unexpectedly (${prev} -> ${next})`);
      unchanged.push(lane);
    }
  }
  return { advanced: index, unchanged };
}

/**
 * DeleteKey burns whatever balance a gas key still holds (and refuses above
 * 1 NEAR). Throw above that cap, warn above a dust threshold, return the value.
 */
export function residualBurn(balanceYocto, { warn = console.warn } = {}) {
  const balance = BigInt(balanceYocto);
  if (balance > ONE_NEAR) {
    throw new Error(`gas key still holds ${balance} yoctoNEAR (> 1 NEAR); DeleteKey would be rejected — withdraw first`);
  }
  if (balance > RESIDUAL_WARN_THRESHOLD) {
    warn(`WARNING: ${balance} yoctoNEAR will be burnt by DeleteKey (a late gas refund most likely landed after the withdraw)`);
  }
  return balance;
}
