// The one place that calls `fetch`. Non-throwing primitives that classify a
// single HTTP attempt into an `HttpOnceOutcome`, consumed by `runWithRetry`.
//
// Takes a fully-resolved `RpcRoute` (URL already authed with `?apiKey=`) and a
// pre-serialized body, so retries send byte-identical bytes and a batch array
// travels the same path as a single call. Never imports `near.ts` — avoids a
// cycle with `batch.ts`.
import { contractError, rpcHttpError, rpcResultError, transportError } from "./errors.js";
import {
  isRetryableRpcError,
  isRetryableStatus,
  parseRetryAfter,
  type HttpOnceOutcome,
} from "./resilience.js";
import type { FastNearNetworkId, ResolvedRetryConfig } from "./state.js";

export interface RpcRoute {
  /** Fully-authed POST URL (rpc/archival base + `?apiKey=` already applied). */
  url: string;
  networkId: FastNearNetworkId;
  useArchival: boolean;
  retry: ResolvedRetryConfig;
}

export async function parseResponsePayload(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Null-safe: existing test mocks return a plain object with no `headers`.
const headerGet = (response: Response, name: string): string | null =>
  (response as any)?.headers?.get?.(name) ?? null;

function transientFromThrow(err: unknown): Extract<HttpOnceOutcome, { kind: "retry" }> {
  return {
    kind: "retry",
    reason: "transient",
    status: null, // pre-response: network error or AbortController timeout
    retryAfterMs: null,
    giveUp: () => transportError(err),
  };
}

/**
 * One JSON-RPC POST. `body` is a bare object (single call) or an array (batch).
 * The top-level-error classification only applies to object bodies; batch
 * arrays carry per-element errors that the caller demuxes.
 */
export async function rpcSend(
  route: RpcRoute,
  bodyStr: string,
  signal?: AbortSignal,
): Promise<HttpOnceOutcome<any>> {
  let response: Response;
  try {
    response = await fetch(route.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyStr,
      signal,
    });
  } catch (err) {
    return transientFromThrow(err);
  }

  const result = await parseResponsePayload(response);

  if (!response.ok) {
    const status = response.status;
    if (isRetryableStatus(status)) {
      return {
        kind: "retry",
        reason: status === 429 ? "rate_limited" : "transient",
        status,
        retryAfterMs: status === 429 ? parseRetryAfter(headerGet(response, "retry-after")) : null,
        giveUp: () => rpcHttpError("rpc", status, response.statusText, result, true),
      };
    }
    return { kind: "terminal", error: rpcHttpError("rpc", status, response.statusText, result, false) };
  }

  // HTTP 200 with a top-level JSON-RPC error (bad method, unknown account/block…).
  if (
    result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    "error" in result &&
    (result as any).error
  ) {
    const err = (result as any).error;
    if (isRetryableRpcError(err)) {
      return {
        kind: "retry",
        reason: err.code === -429 ? "rate_limited" : "transient",
        status: 200,
        retryAfterMs: null,
        giveUp: () => rpcResultError(err, true),
      };
    }
    return { kind: "terminal", error: rpcResultError(err, false) };
  }

  // HTTP 200 but the CONTRACT call failed: nearcore nests the failure as a
  // `result.error` string (e.g. a panic / MethodNotFound on the contract).
  // Terminal — surfaced as a `contract` error instead of leaking as success.
  const inner = (result as any)?.result;
  if (result && typeof result === "object" && inner && typeof inner === "object" && typeof inner.error === "string" && inner.error) {
    return { kind: "terminal", error: contractError(inner.error, inner) };
  }

  return { kind: "ok", value: result };
}

/** One REST (non-RPC service) request. No JSON-RPC-error classification. */
export async function serviceSend(
  family: string,
  url: string,
  method: string,
  headers: Record<string, string>,
  bodyStr: string | undefined,
  signal?: AbortSignal,
): Promise<HttpOnceOutcome<any>> {
  let response: Response;
  try {
    response = await fetch(url, { method, headers, body: bodyStr, signal });
  } catch (err) {
    return transientFromThrow(err);
  }

  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    const status = response.status;
    if (isRetryableStatus(status)) {
      return {
        kind: "retry",
        reason: status === 429 ? "rate_limited" : "transient",
        status,
        retryAfterMs: status === 429 ? parseRetryAfter(headerGet(response, "retry-after")) : null,
        giveUp: () => rpcHttpError(family, status, response.statusText, payload, true),
      };
    }
    return { kind: "terminal", error: rpcHttpError(family, status, response.statusText, payload, false) };
  }

  return { kind: "ok", value: payload };
}
