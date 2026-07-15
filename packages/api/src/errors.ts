// Structured error type for FastNear HTTP / JSON-RPC failures.
//
// `message` is deliberately kept as a JSON string of the failure payload so
// that legacy consumers keep working unchanged — `explain.error`,
// `parseErrorPayload`, and the `tryParseJson(error.message)` calls in
// `sendTxToRpc` / `afterTxSent` all parse `.message` as JSON. On top of that
// legacy shape we expose typed fields, most importantly `kind`, so callers can
// tell an infra failure from an application (smart-contract) failure:
//
//   const [r] = await near.batch([...]);
//   if (r.status === "error" && r.kind === "contract") showRevert(r.error);
//   else if (r.status === "error") retryLater();   // transport / http / rpc
//
export type RpcErrorKind =
  | "transport" // no HTTP response: network error or timeout (retryable)
  | "http" // HTTP status error: 429 / 402 / 401 / 403 / 5xx / 4xx (has .status)
  | "rpc" // top-level JSON-RPC error (bad method, unknown account/block, …)
  | "contract"; // HTTP 200 but the contract call itself failed (panic/revert)

export interface FastNearRpcErrorFields {
  kind?: RpcErrorKind;
  /** HTTP status when the failure was HTTP-level; null otherwise. */
  status?: number | null;
  /** JSON-RPC error code, or the HTTP status mirrored as a code. */
  code?: number | string | null;
  data?: any;
  /** Whether this class of failure is transient/retryable. */
  retryable?: boolean;
}

export class FastNearRpcError extends Error {
  readonly kind: RpcErrorKind;
  readonly status: number | null;
  readonly code: number | string | null;
  readonly data: any;
  readonly retryable: boolean;

  constructor(serializedMessage: string, fields: FastNearRpcErrorFields = {}) {
    super(serializedMessage);
    // Restore the prototype chain so `instanceof FastNearRpcError` holds even
    // when the CJS/IIFE builds down-level `extends Error`.
    Object.setPrototypeOf(this, FastNearRpcError.prototype);
    this.name = "FastNearRpcError";
    this.kind = fields.kind ?? "rpc";
    this.status = fields.status ?? null;
    this.code = fields.code ?? null;
    this.data = fields.data ?? null;
    this.retryable = fields.retryable ?? false;
  }
}

/** No HTTP response — network error or AbortController timeout. */
export function transportError(err: unknown): FastNearRpcError {
  const message = err instanceof Error ? err.message : String(err);
  return new FastNearRpcError(
    JSON.stringify({ code: null, name: "transport_error", message, data: null }),
    { kind: "transport", status: null, code: null, retryable: true },
  );
}

/**
 * HTTP-level failure. Message shape matches the previous `buildHttpError`
 * exactly (`{ code, name, message, data }` JSON) so existing parsers are
 * unaffected.
 */
export function rpcHttpError(
  service: string,
  status: number,
  statusText: string | undefined,
  payload: any,
  retryable = false,
): FastNearRpcError {
  const humanMessage = `${service} request failed with ${status} ${statusText ?? ""}`.trimEnd();
  const serialized = JSON.stringify({
    code: status,
    name: `${service}.http_error`,
    message: humanMessage,
    data: payload ?? null,
  });
  return new FastNearRpcError(serialized, {
    kind: "http",
    status,
    code: status,
    data: payload ?? null,
    retryable,
  });
}

/**
 * Top-level JSON-RPC error (HTTP 200 with a `.error`, e.g. bad method, unknown
 * account/block). Message is `JSON.stringify(error)` — byte-identical to the
 * previous `throw new Error(JSON.stringify(result.error))`.
 */
export function rpcResultError(error: any, retryable = false): FastNearRpcError {
  return new FastNearRpcError(JSON.stringify(error), {
    kind: "rpc",
    status: null,
    code: error?.code ?? null,
    data: error?.data ?? null,
    retryable,
  });
}

/**
 * Smart-contract execution failure: HTTP 200, but nearcore reports the call
 * failed via a nested `result.error` string (e.g. a panic / MethodNotFound on
 * the contract). Always terminal — it will fail identically on retry.
 */
export function contractError(executionError: string, resultInfo: any): FastNearRpcError {
  return new FastNearRpcError(
    JSON.stringify({ code: null, name: "contract_error", message: executionError, data: resultInfo ?? null }),
    { kind: "contract", status: null, code: null, data: resultInfo ?? null, retryable: false },
  );
}
