import { lsGet, lsSet } from "@fastnear/utils";

// Per-access-key, in-process ordering for nonce reservation and consumption.
// The chain remains authoritative across tabs, processes, and external signers.
const _nonceChains = new Map<string, Promise<unknown>>();

/**
 * Reserve one nonce atomically for an access-key scope.
 */
export function reserveNonce(
  scope: string,
  fetchChainNonce: () => Promise<number | string | bigint>,
): Promise<bigint>;
export function reserveNonce<T>(
  scope: string,
  fetchChainNonce: () => Promise<number | string | bigint>,
  task: (nonce: bigint) => T | Promise<T>,
): Promise<T>;
export function reserveNonce<T>(
  scope: string,
  fetchChainNonce: () => Promise<number | string | bigint>,
  task?: (nonce: bigint) => T | Promise<T>,
): Promise<T | bigint> {
  const nonceKey = `nonce.${scope}`;
  // Stored links never reject, so every reservation runs after its predecessor.
  const result = (_nonceChains.get(scope) ?? Promise.resolve()).then(async () => {
    const cached = BigInt((lsGet(nonceKey) as number | string | null) ?? 0);
    const chain = BigInt(await fetchChainNonce());
    const reserved = (chain > cached ? chain : cached) + 1n;
    // JSON cannot represent bigint; decimal strings remain lossless.
    lsSet(nonceKey, reserved.toString());
    return task ? task(reserved) : reserved;
  });
  _nonceChains.set(scope, result.catch(() => undefined));
  return result;
}

/** Test-only: clear the in-process lock chains between test cases. */
export function __resetNonceLocks(): void {
  _nonceChains.clear();
}
