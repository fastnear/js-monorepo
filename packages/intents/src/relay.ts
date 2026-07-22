import { IntentsHttpError } from "./one-click.js";
import {
  SOLVER_RELAY_URL,
  type RelayPublishResult,
  type RelayQuote,
  type RelayQuoteParams,
  type RelayStatusResult,
  type SignedIntent,
} from "./types.js";

export interface SolverRelayClientOptions {
  url?: string;
  /** Relay API key (X-API-Key header), issued via the partner dashboard. */
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
}

export interface SolverRelayClient {
  /** Ask connected solvers for quotes (relay-side timeout ~3s). null = no quotes. */
  quote(params: RelayQuoteParams): Promise<RelayQuote[] | null>;
  /** Publish one signed intent against the quote hashes it fills. */
  publishIntent(params: {
    signedData: SignedIntent;
    quoteHashes: string[];
  }): Promise<RelayPublishResult>;
  /** Publish a batch of signed intents. */
  publishIntents(params: {
    signedDatas: SignedIntent[];
    quoteHashes: string[];
    requote?: boolean;
  }): Promise<RelayPublishResult>;
  /** Poll a published intent: PENDING → TX_BROADCASTED → SETTLED. */
  getStatus(params: { intentHash: string }): Promise<RelayStatusResult>;
}

/** Error carrying the JSON-RPC error object from the solver relay. */
export class SolverRelayError extends Error {
  readonly rpcError: unknown;

  constructor(message: string, rpcError: unknown) {
    super(message);
    this.name = "SolverRelayError";
    this.rpcError = rpcError;
  }
}

/**
 * Zero-dependency JSON-RPC client for the NEAR Intents solver relay
 * (the message bus that brokers quotes between users and solvers and
 * submits matched intent bundles to intents.near).
 */
export function createSolverRelayClient(
  options: SolverRelayClientOptions = {},
): SolverRelayClient {
  const url = options.url ?? SOLVER_RELAY_URL;
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new Error("A fetch implementation is required");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.apiKey) headers["X-API-Key"] = options.apiKey;

  let nextId = 0;

  async function call<T>(method: string, params: unknown): Promise<T> {
    const id = ++nextId;
    const response = await fetchImplementation(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ id, jsonrpc: "2.0", method, params: [params] }),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!response.ok) {
      throw new IntentsHttpError(
        `Solver relay ${method} failed with ${response.status}`,
        response.status,
        parsed,
      );
    }
    const body = parsed as { result?: T; error?: unknown };
    if (body && typeof body === "object" && body.error != null) {
      throw new SolverRelayError(
        `Solver relay ${method} returned an error: ${JSON.stringify(body.error)}`,
        body.error,
      );
    }
    return (body as { result: T }).result;
  }

  return {
    quote: (params) => call("quote", params),
    publishIntent: ({ signedData, quoteHashes }) =>
      call("publish_intent", {
        signed_data: signedData,
        quote_hashes: quoteHashes,
      }),
    publishIntents: ({ signedDatas, quoteHashes, requote }) =>
      call("publish_intents", {
        signed_datas: signedDatas,
        quote_hashes: quoteHashes,
        ...(requote === undefined ? {} : { requote }),
      }),
    getStatus: ({ intentHash }) =>
      call("get_status", { intent_hash: intentHash }),
  };
}
