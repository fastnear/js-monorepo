// Bulk request helpers.
//
// NEAR's JSON-RPC server does NOT accept JSON-RPC batch arrays (confirmed: both
// rpc.mainnet.fastnear.com and rpc.mainnet.near.org reject an array body with
// HTTP 400 / -32700 "Parse error"). So there is no HTTP-level request batching
// to be had. Instead, the bulk API (`near.batch` / `near.view.many`) fans each
// call out as its own retried request under a bounded-concurrency limit — which
// is what curbs 429s (no bursting), tier by tier.

let _rpcIdCounter = 0;

/** Process-unique, monotonic, string-typed JSON-RPC id (avoids Date.now() collisions). */
export function nextRpcId(): string {
  return `fastnear-${++_rpcIdCounter}`;
}

/** Test hook: reset the id counter for deterministic assertions. */
export function __resetBatchState(): void {
  _rpcIdCounter = 0;
}

export interface ResolvedBatchConfig {
  maxConcurrency: number;
}

export function resolveBatchConfig(config: { batch?: { maxConcurrency?: number } }): ResolvedBatchConfig {
  const b = config?.batch || {};
  const maxConcurrency =
    typeof b.maxConcurrency === "number" && Number.isFinite(b.maxConcurrency)
      ? Math.max(1, Math.floor(b.maxConcurrency))
      : 30;
  return { maxConcurrency };
}

/**
 * Run `worker` over `items` with at most `limit` in flight at once, preserving
 * input order in the returned array. Workers are expected not to throw (bulk
 * callers wrap each item to return a settled result).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;

  async function drain(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => drain()));
  return results;
}
