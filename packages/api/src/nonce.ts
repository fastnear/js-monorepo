import { lsGet, lsSet } from "@fastnear/utils";

// Per-network in-process lock chain serializing nonce reservation.
//
// NEAR rejects two transactions that reuse a (public key, nonce) pair, so
// concurrent local-signing `sendTx` calls must each reserve a *distinct* nonce.
// The reservation is a read-modify-write of the `nonce.<network>` cache that, in
// the original inline form, straddled two `await`s (the cold access-key fetch
// and the block fetch). On a cold cache — the first burst of transactions right
// after connect, before `nonce.<network>` is populated — several calls could
// interleave across those awaits, all read the same value, and all sign the same
// nonce: one lands, the rest fail with InvalidNonce.
//
// This guards a single JS runtime (one browser tab / one Node process). It is
// not a cross-tab or on-chain guarantee — the chain remains the source of truth,
// and a genuinely stale local nonce still surfaces as InvalidNonce for the app
// to handle. It simply removes the self-inflicted collision between calls that
// share this module's cache.
const _nonceChains = new Map<string, Promise<unknown>>();

function withNonceLock<T>(network: string, task: () => Promise<T>): Promise<T> {
  const prev = _nonceChains.get(network) ?? Promise.resolve();
  // Run our task once the previous holder settles, regardless of how it settled
  // (a prior caller's failed cold-fetch must not wedge the queue). `prev` is
  // always a non-rejecting link (see below), so `task` always runs.
  const result = prev.then(() => task(), () => task());
  // The next waiter chains off a swallowed copy so this task's outcome — success
  // or failure — never rejects their turn.
  _nonceChains.set(network, result.then(() => undefined, () => undefined));
  return result;
}

/**
 * Reserve the next nonce for `network`, atomically with respect to other
 * in-process callers. On a cold cache `fetchChainNonce` is invoked exactly once
 * (inside the lock); callers that arrive while it is in flight wait, then reuse
 * the warmed cache without re-fetching. Returns the reserved nonce (chain nonce
 * + 1 on the first call, then incrementing) and leaves the cache at that value.
 */
export async function reserveNonce(
  network: string,
  fetchChainNonce: () => Promise<number>,
): Promise<number> {
  const nonceKey = `nonce.${network}`;
  return withNonceLock(network, async () => {
    let current = lsGet(nonceKey) as number | null;
    if (current == null) {
      current = await fetchChainNonce();
    }
    const reserved = current + 1;
    lsSet(nonceKey, reserved);
    return reserved;
  });
}

/** Test-only: clear the in-process lock chains between test cases. */
export function __resetNonceLocks(): void {
  _nonceChains.clear();
}
