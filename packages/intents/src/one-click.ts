import {
  ONE_CLICK_BASE_URL,
  type OneClickGenerateIntentRequest,
  type OneClickGenerateIntentResponse,
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type OneClickStatusResponse,
  type OneClickSubmitDepositRequest,
  type OneClickSubmitIntentResponse,
  type OneClickToken,
  type SignedIntent,
} from "./types.js";

/** Error thrown for non-2xx 1Click (and solver relay) HTTP responses. */
export class IntentsHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "IntentsHttpError";
    this.status = status;
    this.body = body;
  }
}

export interface OneClickClientOptions {
  baseUrl?: string;
  /** Partner API key (X-API-Key). Without one, quotes carry a 0.2% platform fee. */
  apiKey?: string;
  /** Legacy JWT bearer token — same fee waiver as apiKey. */
  jwt?: string;
  fetch?: typeof globalThis.fetch;
}

export interface OneClickClient {
  /** List supported assets; each entry's assetId is used in quotes. */
  tokens(): Promise<OneClickToken[]>;
  /** Request a quote. dry:true previews pricing; dry:false allocates the depositAddress. */
  quote(request: OneClickQuoteRequest): Promise<OneClickQuoteResponse>;
  /** Poll swap execution by deposit address. */
  status(params: {
    depositAddress: string;
    depositMemo?: string;
  }): Promise<OneClickStatusResponse>;
  /** Optional accelerator: report the deposit tx hash. */
  submitDeposit(
    request: OneClickSubmitDepositRequest,
  ): Promise<OneClickStatusResponse>;
  /** INTENTS deposit type: server builds the swap_transfer intent to sign. */
  generateIntent(
    request: OneClickGenerateIntentRequest,
  ): Promise<OneClickGenerateIntentResponse>;
  /** INTENTS deposit type: submit the signed intent. */
  submitIntent(params: {
    signedData: SignedIntent;
  }): Promise<OneClickSubmitIntentResponse>;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

/**
 * Zero-dependency typed client for the hosted 1Click swap API.
 * Works unauthenticated (0.2% platform fee baked into quotes); pass an
 * apiKey from https://partners.near-intents.org/ to waive it.
 */
export function createOneClickClient(
  options: OneClickClientOptions = {},
): OneClickClient {
  const baseUrl = (options.baseUrl ?? ONE_CLICK_BASE_URL).replace(/\/$/, "");
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new Error("A fetch implementation is required");
  }

  const authHeaders: Record<string, string> = {};
  if (options.apiKey) authHeaders["X-API-Key"] = options.apiKey;
  if (options.jwt) authHeaders.Authorization = `Bearer ${options.jwt}`;

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    // Content-Type only when a body exists — a bodyless GET with
    // application/json forces an unnecessary CORS preflight in browsers.
    const headers =
      body === undefined
        ? authHeaders
        : { ...authHeaders, "Content-Type": "application/json" };
    const response = await fetchImplementation(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed = await parseBody(response);
    if (!response.ok) {
      const detail =
        parsed && typeof parsed === "object" && "message" in parsed
          ? ` — ${JSON.stringify((parsed as { message: unknown }).message)}`
          : "";
      throw new IntentsHttpError(
        `1Click ${method} ${path} failed with ${response.status}${detail}`,
        response.status,
        parsed,
      );
    }
    return parsed as T;
  }

  return {
    tokens: () => request("GET", "/v0/tokens"),
    quote: (quoteRequest) => request("POST", "/v0/quote", quoteRequest),
    status: ({ depositAddress, depositMemo }) => {
      const query = new URLSearchParams({ depositAddress });
      if (depositMemo) query.set("depositMemo", depositMemo);
      return request("GET", `/v0/status?${query}`);
    },
    submitDeposit: (submitRequest) =>
      request("POST", "/v0/deposit/submit", submitRequest),
    generateIntent: ({ standard = "nep413", signerId, depositAddress }) =>
      request("POST", "/v0/generate-intent", {
        type: "swap_transfer",
        standard,
        signerId,
        depositAddress,
      }),
    submitIntent: ({ signedData }) =>
      request("POST", "/v0/submit-intent", {
        type: "swap_transfer",
        signedData,
      }),
  };
}
