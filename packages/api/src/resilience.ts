// Transport-agnostic retry / backoff machinery.
//
// Pure logic only — no `fetch`, no config storage. It operates over a
// discriminated `HttpOnceOutcome` produced by the transport layer, so the
// exact same retry loop drives a single JSON-RPC call and a batch array.
//
// Ported from the reference `batchedStaking.ts`: `parseRetryAfter` and the
// full-jitter backoff.
import type { ResolvedRetryConfig } from "./state.js";

// Rate-limit / transient status + code classification. Single source of truth,
// also imported by `looksRetryable` in near.ts.
export const RETRYABLE_HTTP_STATUSES = [408, 429, 500, 502, 503, 504] as const;
// -32000 is NEAR's generic "server error"; -429 is the JSON-RPC-body form of a
// rate limit (the ARL edge returns HTTP 429 + a `-429` body).
export const RETRYABLE_RPC_CODES = [-32000, -429] as const;

export function isRetryableStatus(status: number): boolean {
  // Broad 5xx form (matches the reference transport); the explicit list above
  // is the display/classification set used by `looksRetryable`.
  return status === 408 || status === 429 || status >= 500;
}

// Whether a top-level JSON-RPC error object should be retried. Uses NEAR's
// error `name`, not just the code: `-32000` "Server error" is transient EXCEPT
// deterministic `HANDLER_ERROR`s (UNKNOWN_ACCOUNT / UNKNOWN_BLOCK / …), which
// fail identically on retry and shouldn't burn attempts.
export function isRetryableRpcError(error: any): boolean {
  const code = error?.code;
  if (code === -429) return true; // rate limit signaled in the JSON-RPC body
  if (code === -32000) return error?.name !== "HANDLER_ERROR";
  return false; // -32601 / -32602 / -32700 / etc. are deterministic
}

export type RetryReason = "rate_limited" | "transient";

// The result of one transport attempt. Never thrown — the loop decides.
export type HttpOnceOutcome<T = any> =
  | { kind: "ok"; value: T }
  | {
      kind: "retry";
      reason: RetryReason;
      // HTTP status when a response was seen; null for pre-response failures
      // (network error / timeout abort) — the distinction gates write retries.
      status: number | null;
      retryAfterMs: number | null;
      // The error to surface if retries are exhausted (preserves legacy shape).
      giveUp: () => Error;
    }
  | { kind: "terminal"; error: Error };

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Retry-After may be a seconds count ("2") or an HTTP-date. Returns ms, or null. */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(header);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

/** Full-jitter exponential backoff, honoring Retry-After when present. */
export function computeBackoffMs(
  cfg: ResolvedRetryConfig,
  attempt: number,
  outcome: Extract<HttpOnceOutcome, { kind: "retry" }>,
): number {
  if (
    cfg.respectRetryAfter &&
    outcome.reason === "rate_limited" &&
    outcome.retryAfterMs != null
  ) {
    // Honor exactly (deterministic, no jitter), but bound UI latency.
    return Math.min(outcome.retryAfterMs, cfg.maxBackoffMs);
  }
  const exp = Math.min(cfg.maxBackoffMs, cfg.baseBackoffMs * 2 ** Math.min(attempt - 1, 12));
  return Math.random() * exp;
}

function writeAllowsRetry(
  policy: ResolvedRetryConfig["writePolicy"],
  isWrite: boolean,
  outcome: Extract<HttpOnceOutcome, { kind: "retry" }>,
): boolean {
  if (!isWrite) return true;
  if (policy === "all") return true;
  if (policy === "never") return false;
  // "transport-only": retry writes only on pre-response failures (no status
  // seen) — the request almost certainly never reached the node, so resending
  // the identical signed bytes is safe. Never retry a write on 429/5xx.
  return outcome.reason === "transient" && outcome.status === null;
}

/** Convenience: the error to throw for a non-ok final outcome. */
export function outcomeError(outcome: HttpOnceOutcome): Error {
  if (outcome.kind === "terminal") return outcome.error;
  if (outcome.kind === "retry") return outcome.giveUp();
  return new Error("fastnear: outcomeError called on an ok outcome");
}

/**
 * Run `doOnce` under the retry policy, returning the FINAL outcome (never
 * throws). Callers decide whether to throw (single call) or demux (batch).
 * Owns the per-attempt AbortController timeout.
 */
export async function runWithRetry<T = any>(
  cfg: ResolvedRetryConfig,
  isWrite: boolean,
  doOnce: (signal: AbortSignal | undefined) => Promise<HttpOnceOutcome<T>>,
): Promise<HttpOnceOutcome<T>> {
  for (let attempt = 1; ; attempt++) {
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (cfg.enabled && cfg.timeoutMs > 0) {
      controller = new AbortController();
      timer = setTimeout(() => controller!.abort(), cfg.timeoutMs);
    }

    let outcome: HttpOnceOutcome<T>;
    try {
      outcome = await doOnce(controller?.signal);
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (outcome.kind === "ok" || outcome.kind === "terminal") return outcome;

    const canRetry =
      cfg.enabled &&
      attempt < cfg.maxAttempts &&
      writeAllowsRetry(cfg.writePolicy, isWrite, outcome);
    if (!canRetry) return outcome;

    await sleep(computeBackoffMs(cfg, attempt, outcome));
  }
}
