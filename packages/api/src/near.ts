import {
  lsSet,
  lsGet,
  tryParseJson,
  fromBase64,
  toBase64,
  canSignWithLAK,
  toBase58,
  parseJsonFromBytes,
  signHash,
  serializeTransaction,
  serializeSignedTransaction, bytesToBase64, PlainTransaction,
} from "@fastnear/utils";

import type { NEP413Message } from "@fastnear/utils";

import {
  _state,
  DEFAULT_NETWORK_ID,
  NETWORKS,
  getWalletProvider,
  setWalletProvider,
  getTxHistory,
  update,
  updateTxHistory,
} from "./state.js";

import type { WalletProvider, FastNearNetworkId } from "./state.js";
import type { NetworkConfig } from "./state.js";
import type {
  AccessKeyWithError,
  BlockView,
  ExplainedAction,
  ExplainedError,
  ExplainedTransaction,
  FastNearApiV1AccountFtResponse,
  FastNearApiV1AccountFullResponse,
  FastNearApiV1AccountNftResponse,
  FastNearApiV1AccountStakingResponse,
  FastNearApiV1FtTopResponse,
  FastNearApiV1PublicKeyAllResponse,
  FastNearApiV1PublicKeyResponse,
  FastNearRecipeDiscoveryEntry,
  FastNearRecipeViewAccountResult,
  FastNearKvAllByPredecessorResponse,
  FastNearKvGetHistoryKeyResponse,
  FastNearKvGetLatestKeyResponse,
  FastNearKvHistoryByAccountResponse,
  FastNearKvHistoryByPredecessorResponse,
  FastNearKvLatestByAccountResponse,
  FastNearKvLatestByPredecessorResponse,
  FastNearKvMultiResponse,
  FastNearNeardataBlockChunkResponse,
  FastNearNeardataBlockHeadersResponse,
  FastNearNeardataBlockOptimisticResponse,
  FastNearNeardataBlockResponse,
  FastNearNeardataBlockShardResponse,
  FastNearNeardataFirstBlockResponse,
  FastNearNeardataHealthResponse,
  FastNearNeardataLastBlockFinalResponse,
  FastNearNeardataLastBlockOptimisticResponse,
  FastNearTransfersQueryResponse,
  FastNearRpcQueryAccountResponse,
  FastNearTxAccountResponse,
  FastNearTxBlockResponse,
  FastNearTxBlocksResponse,
  FastNearTxReceiptResponse,
  FastNearTxTransactionRow,
  FastNearTxTransactionsResponse,
  LastKnownBlock,
  RecipeConnectParams,
  RecipeFunctionCallParams,
  RecipeInspectTransactionInput,
  RecipeInspectTransactionParams,
  RecipeViewAccountInput,
  RecipeTransferParams,
  RecipeViewAccountParams,
  RecipeViewContractParams,
} from "./types.js";

import {
  getConfig,
  setConfig,
  resetTxHistory,
} from "./state.js";

import { sha256 } from "@noble/hashes/sha2.js";
import * as reExportAllUtils from "@fastnear/utils";
import * as stateExports from "./state.js";

export const MaxBlockDelayMs = 1000 * 60 * 60 * 6; // 6 hours

function normalizeActionParams(action: any): Record<string, any> {
  if (!action || typeof action !== "object") {
    return {};
  }
  if (action.params && typeof action.params === "object") {
    return { ...action.params };
  }
  const { type, ...rest } = action;
  return { ...rest };
}

function looksRetryable(message: string, code: string | number | null, kind: ExplainedError["kind"]): boolean {
  if (kind === "transport_error") {
    return true;
  }
  if (typeof code === "number" && [408, 429, 500, 502, 503, 504, -32000].includes(code)) {
    return true;
  }
  return /timeout|temporar|temporarily|rate limit|unavailable|network|gateway/i.test(message);
}

function parseErrorPayload(error: unknown): {
  code: string | number | null;
  name: string | null;
  message: string;
  data: any;
  kind: ExplainedError["kind"];
} {
  const fallbackMessage = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Unknown error";

  const parsedMessage = tryParseJson(fallbackMessage);
  const parsedObject = parsedMessage && typeof parsedMessage === "object"
    ? parsedMessage
    : error && typeof error === "object"
      ? error
      : null;

  const code = parsedObject && "code" in parsedObject ? (parsedObject as any).code : null;
  const data = parsedObject && "data" in parsedObject
    ? (parsedObject as any).data
    : parsedMessage && parsedMessage !== parsedObject
      ? parsedMessage
      : null;
  const name = error instanceof Error
    ? error.name
    : parsedObject && "name" in parsedObject
      ? String((parsedObject as any).name)
      : "Error";
  const message = parsedObject && "message" in parsedObject
    ? String((parsedObject as any).message)
    : fallbackMessage;

  let kind: ExplainedError["kind"] = "error";
  if (parsedObject && ("code" in parsedObject || "data" in parsedObject)) {
    kind = "rpc_error";
  } else if (/wallet/i.test(message)) {
    kind = "wallet_error";
  } else if (/network|timeout|fetch|gateway|unavailable/i.test(message)) {
    kind = "transport_error";
  }

  return {
    code,
    name,
    message,
    data,
    kind,
  };
}

export function withBlockId(params: Record<string, any>, blockId?: string) {
  if (blockId === "final" || blockId === "optimistic") {
    return { ...params, finality: blockId };
  }
  return blockId ? { ...params, block_id: blockId } : { ...params, finality: "optimistic" };
}

type ServiceFamily = "rpc" | "api" | "tx" | "transfers" | "neardata" | "fastdata.kv";
type ServiceAuthStyle = "none" | "bearer" | "query";

interface ServiceRequestOptions {
  family: Exclude<ServiceFamily, "rpc">;
  path: string;
  method?: "GET" | "POST";
  query?: Record<string, any>;
  body?: any;
  headers?: Record<string, string>;
}

const SERVICE_AUTH_STYLES: Record<ServiceFamily, ServiceAuthStyle> = {
  rpc: "query",
  api: "bearer",
  tx: "bearer",
  transfers: "bearer",
  neardata: "query",
  "fastdata.kv": "bearer",
};

function omitUndefinedEntries<T extends Record<string, any>>(value?: T): T | undefined {
  if (!value) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, "");
}

function appendQueryParams(url: URL, query?: Record<string, any>): URL {
  if (!query) {
    return url;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null) {
          url.searchParams.append(key, String(item));
        }
      });
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  return url;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, any>): string {
  const url = new URL(trimLeadingSlash(path), `${trimTrailingSlash(baseUrl)}/`);
  return appendQueryParams(url, query).toString();
}

async function parseResponsePayload(response: Response) {
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

function buildHttpError(service: ServiceFamily, response: Response, payload: any): Error {
  return new Error(
    JSON.stringify({
      code: response.status,
      name: `${service}.http_error`,
      message: `${service} request failed with ${response.status} ${response.statusText}`,
      data: payload,
    })
  );
}

function resolveServiceBaseUrl(family: Exclude<ServiceFamily, "rpc">, config: NetworkConfig): string {
  let baseUrl: string | null | undefined;

  switch (family) {
    case "api":
      baseUrl = config.services?.api?.baseUrl;
      break;
    case "tx":
      baseUrl = config.services?.tx?.baseUrl;
      break;
    case "transfers":
      baseUrl = config.services?.transfers?.baseUrl;
      break;
    case "neardata":
      baseUrl = config.services?.neardata?.baseUrl;
      break;
    case "fastdata.kv":
      baseUrl = config.services?.fastdata?.kvBaseUrl;
      break;
  }

  if (!baseUrl) {
    if (family === "transfers" && config.networkId === "testnet") {
      throw new Error(
        "fastnear: transfers service is not configured for testnet. Provide near.config({ services: { transfers: { baseUrl: \"https://...\" } } }) to override."
      );
    }
    throw new Error(`fastnear: ${family} service is not configured for ${config.networkId}.`);
  }

  return baseUrl;
}

function resolveRpcUrl(config: NetworkConfig): string {
  const rpcUrl = config.nodeUrl || config.services?.rpc?.baseUrl;
  if (!rpcUrl) {
    throw new Error("fastnear: getConfig() returned invalid config: missing nodeUrl.");
  }
  return rpcUrl;
}

// Pick the archival RPC if configured; fall back to the regular RPC so
// callers that opt into `useArchival` against a network without archival
// configured still get an answer (just from the non-archival node).
function resolveArchivalUrl(config: NetworkConfig): string {
  return config.services?.archival?.baseUrl || resolveRpcUrl(config);
}

function buildAuthedUrl(service: ServiceFamily, baseUrl: string, path = "", query?: Record<string, any>): string {
  const config = getConfig();
  const authStyle = SERVICE_AUTH_STYLES[service];
  const authQuery =
    authStyle === "query" && config.apiKey
      ? { ...(query || {}), apiKey: config.apiKey }
      : query;

  return buildUrl(baseUrl, path, authQuery);
}

async function sendServiceRequest<T = any>({
  family,
  path,
  method = "GET",
  query,
  body,
  headers = {},
}: ServiceRequestOptions): Promise<T> {
  const config = getConfig();
  const authStyle = SERVICE_AUTH_STYLES[family];
  const url = buildAuthedUrl(family, resolveServiceBaseUrl(family, config), path, query);
  const requestHeaders: Record<string, string> = { ...headers };

  if (authStyle === "bearer" && config.apiKey) {
    requestHeaders.Authorization = `Bearer ${config.apiKey}`;
  }

  let requestBody: string | undefined;
  if (body !== undefined) {
    requestHeaders["Content-Type"] = requestHeaders["Content-Type"] || "application/json";
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: requestBody,
  });
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    throw buildHttpError(family, response, payload);
  }

  return payload as T;
}

export interface RpcRouteOptions {
  /**
   * Route this call to the archival RPC (`services.archival.baseUrl`)
   * instead of the default. Useful for queries with a historical
   * `blockId`. Falls back to the regular RPC if archival isn't configured.
   */
  useArchival?: boolean;
}

export async function sendRpc<T = any>(
  method: string,
  params: Record<string, any> | any[],
  options?: RpcRouteOptions,
): Promise<T> {
  const config = getConfig();
  const baseUrl = options?.useArchival ? resolveArchivalUrl(config) : resolveRpcUrl(config);
  const response = await fetch(buildAuthedUrl("rpc", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `fastnear-${Date.now()}`,
      method,
      params,
    }),
  });
  const result = await parseResponsePayload(response);
  if (!response.ok) {
    throw buildHttpError("rpc", response, result);
  }
  if (result && typeof result === "object" && "error" in result && (result as any).error) {
    throw new Error(JSON.stringify(result.error));
  }
  return result as T;
}

export function afterTxSent(txId: string) {
  const txHistory = getTxHistory();
  sendRpc("tx", {
    tx_hash: txHistory[txId]?.txHash,
    sender_account_id: txHistory[txId]?.tx?.signerId,
    wait_until: "EXECUTED_OPTIMISTIC",
  })
    .then( result => {
      const successValue = result?.result?.status?.SuccessValue;
      updateTxHistory({
        txId,
        status: "Executed",
        result,
        successValue: successValue ? tryParseJson(fromBase64(successValue)) : undefined,
        finalState: true,
      });
    })
    .catch((error) => {
      updateTxHistory({
        txId,
        status: "ErrorAfterIncluded",
        error: tryParseJson(error.message) ?? error.message,
        finalState: true,
      });
    });
}

export async function sendTxToRpc(signedTxBase64: string, waitUntil: string | undefined, txId: string) {
  // default to "INCLUDED"
  // see options: https://docs.near.org/api/rpc/transactions#tx-status-result
  waitUntil = waitUntil || "INCLUDED";

  try {
    const sendTxRes = await sendRpc("send_tx", {
      signed_tx_base64: signedTxBase64,
      wait_until: waitUntil,
    });

    updateTxHistory({ txId, status: "Included", finalState: false });
    afterTxSent(txId);

    return sendTxRes;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    updateTxHistory({
      txId,
      status: "Error",
      error: tryParseJson(errorMessage) ?? errorMessage,
      finalState: false,
    });
    throw new Error(errorMessage);
  }
}

/**
 * Generates a mock transaction ID.
 */
export function generateTxId(): string {
  const randomPart = crypto.getRandomValues(new Uint32Array(2)).join("");
  return `tx-${Date.now()}-${parseInt(randomPart, 10).toString(36)}`;
}

export const accountId = () => _state.accountId;
export const publicKey = () => _state.publicKey;

export const config = (newConfig?: Partial<NetworkConfig>) => {
  const current = getConfig();
  if (newConfig) {
    if (newConfig.networkId && current.networkId !== newConfig.networkId) {
      setConfig(newConfig);
      update({ accountId: null, privateKey: null, lastWalletId: null });
      lsSet("block", null);
      resetTxHistory();
    } else {
      setConfig(newConfig);
    }
  }
  return getConfig();
};

export const authStatus = (): string | Record<string, any> => {
  if (!_state.accountId) {
    return "SignedOut";
  }
  return "SignedIn";
};

export const getPublicKeyForContract = () => {
  return publicKey();
}

export const selected = () => {
  const network = getConfig().networkId;
  const nodeUrl = getConfig().nodeUrl;
  const walletUrl = getConfig().walletUrl;
  const helperUrl = getConfig().helperUrl;
  const explorerUrl = getConfig().explorerUrl;

  const account = accountId();
  const contract = _state.accessKeyContractId;
  const publicKey = getPublicKeyForContract();

  return {
    network,
    nodeUrl,
    walletUrl,
    helperUrl,
    explorerUrl,
    account,
    contract,
    publicKey
  }
}

export const requestSignIn = async ({
  contractId,
  excludedWallets,
  features,
  network,
}: {
  contractId?: string;
  excludedWallets?: string[];
  features?: Record<string, boolean>;
  network?: FastNearNetworkId;
} = {}) => {
  const provider = getWalletProvider();
  if (!provider) {
    throw new Error("No wallet provider set. Call useWallet() first or load the @fastnear/wallet IIFE bundle.");
  }

  const targetNetwork = network ?? getConfig().networkId;

  // Drop any prior session on the *target* network only — leaving sessions
  // on other networks intact. With @fastnear/wallet 1.1.0+ the optional
  // `{ network }` argument scopes both checks; older providers that ignore
  // the option fall back to "active network", which matches pre-1.1.2
  // behavior since `targetNetwork` defaulted to the active config.
  if (provider.isConnected({ network: targetNetwork })) {
    await provider.disconnect({ network: targetNetwork });
  }

  const result = await provider.connect({
    contractId,
    network: targetNetwork,
    excludedWallets,
    features,
  });

  if (!result) {
    // User rejected
    return undefined;
  }

  update({ accountId: result.accountId });
  return result;
};

export const view = async ({
                             contractId,
                             methodName,
                             args,
                             argsBase64,
                             blockId,
                             useArchival,
                           }: {
  contractId: string;
  methodName: string;
  args?: any;
  argsBase64?: string;
  blockId?: string;
  useArchival?: boolean;
}) => {
  const encodedArgs = argsBase64 || (args ? toBase64(JSON.stringify(args)) : "");
  const queryResult = await sendRpc(
    "query",
    withBlockId(
      {
        request_type: "call_function",
        account_id: contractId,
        method_name: methodName,
        args_base64: encodedArgs,
      },
      blockId
    ),
    { useArchival },
  );

  return parseJsonFromBytes(queryResult.result.result);
};

export const queryAccount = async ({
                                accountId,
                                blockId,
                                useArchival,
                              }: {
  accountId: string;
  blockId?: string;
  useArchival?: boolean;
}): Promise<FastNearRpcQueryAccountResponse> => {
  return sendRpc(
    "query",
    withBlockId({ request_type: "view_account", account_id: accountId }, blockId),
    { useArchival },
  );
};

export const queryBlock = async ({ blockId, useArchival }: { blockId?: string; useArchival?: boolean }): Promise<BlockView> => {
  return sendRpc("block", withBlockId({}, blockId), { useArchival });
};

export const queryAccessKey = async ({
                                  accountId,
                                  publicKey,
                                  blockId,
                                  useArchival,
                                }: {
  accountId: string;
  publicKey: string;
  blockId?: string;
  useArchival?: boolean;
}): Promise<AccessKeyWithError> => {
  return sendRpc(
    "query",
    withBlockId(
      { request_type: "view_access_key", account_id: accountId, public_key: publicKey },
      blockId
    ),
    { useArchival },
  );
};

export const queryTx = async ({ txHash, accountId, useArchival }: { txHash: string; accountId: string; useArchival?: boolean }) => {
  return sendRpc("tx", [txHash, accountId], { useArchival });
};

function shouldPrintInteractiveSeparator(): boolean {
  if (typeof process === "undefined") {
    return false;
  }

  return Boolean(process.stdout?.isTTY);
}

export function print(value: unknown): void {
  if (shouldPrintInteractiveSeparator()) {
    console.log("");
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    console.log(value);
    return;
  }

  try {
    console.log(JSON.stringify(value, null, 2));
  } catch {
    console.log(value);
  }
}

function requiredParam<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(`fastnear: missing required parameter "${name}"`);
  }
  return value;
}

function encodePathParam(value: string | number, name: string): string {
  return encodeURIComponent(String(requiredParam(value, name)));
}

function withAliases(
  params: Record<string, any>,
  aliases: Record<string, string>
): Record<string, any> {
  const next = { ...params };
  for (const [from, to] of Object.entries(aliases)) {
    if (next[from] !== undefined && next[to] === undefined) {
      next[to] = next[from];
    }
    delete next[from];
  }
  return next;
}

export const tx = {
  transactions: ({ txHashes, ...filters }: { txHashes: string[]; [key: string]: any }) =>
    sendServiceRequest<FastNearTxTransactionsResponse>({
      family: "tx",
      path: "/v0/transactions",
      method: "POST",
      body: omitUndefinedEntries({
        ...filters,
        tx_hashes: requiredParam(txHashes, "txHashes"),
      }),
    }),

  receipt: ({ receiptId, ...filters }: { receiptId: string; [key: string]: any }) =>
    sendServiceRequest<FastNearTxReceiptResponse>({
      family: "tx",
      path: "/v0/receipt",
      method: "POST",
      body: omitUndefinedEntries({
        ...filters,
        receipt_id: requiredParam(receiptId, "receiptId"),
      }),
    }),

  account: ({ accountId, ...filters }: { accountId: string; [key: string]: any }) =>
    sendServiceRequest<FastNearTxAccountResponse>({
      family: "tx",
      path: "/v0/account",
      method: "POST",
      body: omitUndefinedEntries({
        ...filters,
        account_id: requiredParam(accountId, "accountId"),
      }),
    }),

  block: (params: Record<string, any> = {}) =>
    sendServiceRequest<FastNearTxBlockResponse>({
      family: "tx",
      path: "/v0/block",
      method: "POST",
      body: omitUndefinedEntries(params),
    }),

  blocks: (params: Record<string, any> = {}) =>
    sendServiceRequest<FastNearTxBlocksResponse>({
      family: "tx",
      path: "/v0/blocks",
      method: "POST",
      body: omitUndefinedEntries(params),
    }),
};

export const api = {
  v1: {
    accountFull: ({ accountId, ...query }: { accountId: string; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1AccountFullResponse>({
        family: "api",
        path: `/v1/account/${encodePathParam(accountId, "accountId")}/full`,
        query: omitUndefinedEntries(query),
      }),

    accountFt: ({ accountId, ...query }: { accountId: string; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1AccountFtResponse>({
        family: "api",
        path: `/v1/account/${encodePathParam(accountId, "accountId")}/ft`,
        query: omitUndefinedEntries(query),
      }),

    accountNft: ({ accountId, ...query }: { accountId: string; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1AccountNftResponse>({
        family: "api",
        path: `/v1/account/${encodePathParam(accountId, "accountId")}/nft`,
        query: omitUndefinedEntries(query),
      }),

    accountStaking: ({ accountId, ...query }: { accountId: string; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1AccountStakingResponse>({
        family: "api",
        path: `/v1/account/${encodePathParam(accountId, "accountId")}/staking`,
        query: omitUndefinedEntries(query),
      }),

    publicKey: ({ publicKey, ...query }: { publicKey: string; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1PublicKeyResponse>({
        family: "api",
        path: `/v1/public_key/${encodePathParam(publicKey, "publicKey")}`,
        query: omitUndefinedEntries(query),
      }),

    publicKeyAll: ({ publicKey, ...query }: { publicKey: string; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1PublicKeyAllResponse>({
        family: "api",
        path: `/v1/public_key/${encodePathParam(publicKey, "publicKey")}/all`,
        query: omitUndefinedEntries(query),
      }),

    ftTop: ({ tokenId, ...query }: { tokenId: string; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1FtTopResponse>({
        family: "api",
        path: `/v1/ft/${encodePathParam(tokenId, "tokenId")}/top`,
        query: omitUndefinedEntries(query),
      }),
  },
};

export const transfers = {
  query: (params: Record<string, any> = {}) =>
    sendServiceRequest<FastNearTransfersQueryResponse>({
      family: "transfers",
      path: "/v0/transfers",
      method: "POST",
      body: omitUndefinedEntries(withAliases(params, { accountId: "account_id", resumeToken: "resume_token" })),
    }),
};

// NEP-141 (fungible token) view-call shorthand.
// Each helper is a one-line wrapper around `view` with the standard
// method name pre-filled — agents prompt with the spec's verb instead
// of pasting the underlying methodName recipe each time.
export const ft = {
  balance: ({ contractId, accountId, blockId, useArchival }: { contractId: string; accountId: string; blockId?: string; useArchival?: boolean }) =>
    view({ contractId, methodName: "ft_balance_of", args: { account_id: accountId }, blockId, useArchival }),

  metadata: ({ contractId, blockId, useArchival }: { contractId: string; blockId?: string; useArchival?: boolean }) =>
    view({ contractId, methodName: "ft_metadata", args: {}, blockId, useArchival }),

  totalSupply: ({ contractId, blockId, useArchival }: { contractId: string; blockId?: string; useArchival?: boolean }) =>
    view({ contractId, methodName: "ft_total_supply", args: {}, blockId, useArchival }),

  // NEP-145 storage-management read; many wallet/dApp flows need to know
  // whether an account is registered with the FT contract before transferring.
  storageBalance: ({ contractId, accountId, blockId, useArchival }: { contractId: string; accountId: string; blockId?: string; useArchival?: boolean }) =>
    view({ contractId, methodName: "storage_balance_of", args: { account_id: accountId }, blockId, useArchival }),

  // Cross-contract: list every FT contract this account holds, served by
  // the FastNear indexer. Layer-mixed but the natural name from the
  // agent's perspective.
  inventory: ({ accountId, ...query }: { accountId: string; [key: string]: any }) =>
    sendServiceRequest<FastNearApiV1AccountFtResponse>({
      family: "api",
      path: `/v1/account/${encodePathParam(accountId, "accountId")}/ft`,
      query: omitUndefinedEntries(query),
    }),
};

// NEP-171 (non-fungible token) view-call shorthand. Same pattern as `ft`.
export const nft = {
  metadata: ({ contractId, blockId, useArchival }: { contractId: string; blockId?: string; useArchival?: boolean }) =>
    view({ contractId, methodName: "nft_metadata", args: {}, blockId, useArchival }),

  token: ({ contractId, tokenId, blockId, useArchival }: { contractId: string; tokenId: string; blockId?: string; useArchival?: boolean }) =>
    view({ contractId, methodName: "nft_token", args: { token_id: tokenId }, blockId, useArchival }),

  forOwner: ({ contractId, accountId, fromIndex, limit, blockId, useArchival }: { contractId: string; accountId: string; fromIndex?: string; limit?: number; blockId?: string; useArchival?: boolean }) =>
    view({
      contractId,
      methodName: "nft_tokens_for_owner",
      args: omitUndefinedEntries({ account_id: accountId, from_index: fromIndex, limit }),
      blockId,
      useArchival,
    }),

  supplyForOwner: ({ contractId, accountId, blockId, useArchival }: { contractId: string; accountId: string; blockId?: string; useArchival?: boolean }) =>
    view({ contractId, methodName: "nft_supply_for_owner", args: { account_id: accountId }, blockId, useArchival }),

  totalSupply: ({ contractId, blockId, useArchival }: { contractId: string; blockId?: string; useArchival?: boolean }) =>
    view({ contractId, methodName: "nft_total_supply", args: {}, blockId, useArchival }),

  tokens: ({ contractId, fromIndex, limit, blockId, useArchival }: { contractId: string; fromIndex?: string; limit?: number; blockId?: string; useArchival?: boolean }) =>
    view({
      contractId,
      methodName: "nft_tokens",
      args: omitUndefinedEntries({ from_index: fromIndex, limit }),
      blockId,
      useArchival,
    }),

  // List every NFT contract this account holds, served by the FastNear indexer.
  inventory: ({ accountId, ...query }: { accountId: string; [key: string]: any }) =>
    sendServiceRequest<FastNearApiV1AccountNftResponse>({
      family: "api",
      path: `/v1/account/${encodePathParam(accountId, "accountId")}/nft`,
      query: omitUndefinedEntries(query),
    }),
};

export const neardata = {
  lastBlockFinal: (query?: Record<string, any>) =>
    sendServiceRequest<FastNearNeardataLastBlockFinalResponse>({
      family: "neardata",
      path: "/v0/last_block/final",
      query: omitUndefinedEntries(query),
    }),

  lastBlockOptimistic: (query?: Record<string, any>) =>
    sendServiceRequest<FastNearNeardataLastBlockOptimisticResponse>({
      family: "neardata",
      path: "/v0/last_block/optimistic",
      query: omitUndefinedEntries(query),
    }),

  block: ({ blockHeight, ...query }: { blockHeight: string | number; [key: string]: any }) =>
    sendServiceRequest<FastNearNeardataBlockResponse>({
      family: "neardata",
      path: `/v0/block/${encodePathParam(blockHeight, "blockHeight")}`,
      query: omitUndefinedEntries(query),
    }),

  blockHeaders: ({ blockHeight, ...query }: { blockHeight: string | number; [key: string]: any }) =>
    sendServiceRequest<FastNearNeardataBlockHeadersResponse>({
      family: "neardata",
      path: `/v0/block/${encodePathParam(blockHeight, "blockHeight")}/headers`,
      query: omitUndefinedEntries(query),
    }),

  blockShard: ({ blockHeight, shardId, ...query }: { blockHeight: string | number; shardId: string | number; [key: string]: any }) =>
    sendServiceRequest<FastNearNeardataBlockShardResponse>({
      family: "neardata",
      path: `/v0/block/${encodePathParam(blockHeight, "blockHeight")}/shard/${encodePathParam(shardId, "shardId")}`,
      query: omitUndefinedEntries(query),
    }),

  blockChunk: ({ blockHeight, shardId, ...query }: { blockHeight: string | number; shardId: string | number; [key: string]: any }) =>
    sendServiceRequest<FastNearNeardataBlockChunkResponse>({
      family: "neardata",
      path: `/v0/block/${encodePathParam(blockHeight, "blockHeight")}/chunk/${encodePathParam(shardId, "shardId")}`,
      query: omitUndefinedEntries(query),
    }),

  blockOptimistic: ({ blockHeight, ...query }: { blockHeight: string | number; [key: string]: any }) =>
    sendServiceRequest<FastNearNeardataBlockOptimisticResponse>({
      family: "neardata",
      path: `/v0/block_opt/${encodePathParam(blockHeight, "blockHeight")}`,
      query: omitUndefinedEntries(query),
    }),

  firstBlock: (query?: Record<string, any>) =>
    sendServiceRequest<FastNearNeardataFirstBlockResponse>({
      family: "neardata",
      path: "/v0/first_block",
      query: omitUndefinedEntries(query),
    }),

  health: (query?: Record<string, any>) =>
    sendServiceRequest<FastNearNeardataHealthResponse>({
      family: "neardata",
      path: "/health",
      query: omitUndefinedEntries(query),
    }),
};

export const fastdata = {
  kv: {
    getLatestKey: ({ currentAccountId, predecessorId, key, ...query }: { currentAccountId: string; predecessorId: string; key: string; [key: string]: any }) =>
      sendServiceRequest<FastNearKvGetLatestKeyResponse>({
        family: "fastdata.kv",
        path: `/v0/latest/${encodePathParam(currentAccountId, "currentAccountId")}/${encodePathParam(predecessorId, "predecessorId")}/${encodePathParam(key, "key")}`,
        query: omitUndefinedEntries(query),
      }),

    getHistoryKey: ({ currentAccountId, predecessorId, key, ...query }: { currentAccountId: string; predecessorId: string; key: string; [key: string]: any }) =>
      sendServiceRequest<FastNearKvGetHistoryKeyResponse>({
        family: "fastdata.kv",
        path: `/v0/history/${encodePathParam(currentAccountId, "currentAccountId")}/${encodePathParam(predecessorId, "predecessorId")}/${encodePathParam(key, "key")}`,
        query: omitUndefinedEntries(query),
      }),

    latestByAccount: ({ accountId, ...body }: { accountId: string; [key: string]: any }) =>
      sendServiceRequest<FastNearKvLatestByAccountResponse>({
        family: "fastdata.kv",
        path: `/v0/latest/${encodePathParam(accountId, "accountId")}`,
        method: "POST",
        body: omitUndefinedEntries(body),
      }),

    historyByAccount: ({ accountId, ...body }: { accountId: string; [key: string]: any }) =>
      sendServiceRequest<FastNearKvHistoryByAccountResponse>({
        family: "fastdata.kv",
        path: `/v0/history/${encodePathParam(accountId, "accountId")}`,
        method: "POST",
        body: omitUndefinedEntries(body),
      }),

    latestByPredecessor: ({ currentAccountId, predecessorId, ...body }: { currentAccountId: string; predecessorId: string; [key: string]: any }) =>
      sendServiceRequest<FastNearKvLatestByPredecessorResponse>({
        family: "fastdata.kv",
        path: `/v0/latest/${encodePathParam(currentAccountId, "currentAccountId")}/${encodePathParam(predecessorId, "predecessorId")}`,
        method: "POST",
        body: omitUndefinedEntries(body),
      }),

    historyByPredecessor: ({ currentAccountId, predecessorId, ...body }: { currentAccountId: string; predecessorId: string; [key: string]: any }) =>
      sendServiceRequest<FastNearKvHistoryByPredecessorResponse>({
        family: "fastdata.kv",
        path: `/v0/history/${encodePathParam(currentAccountId, "currentAccountId")}/${encodePathParam(predecessorId, "predecessorId")}`,
        method: "POST",
        body: omitUndefinedEntries(body),
      }),

    allByPredecessor: ({ predecessorId, ...body }: { predecessorId: string; [key: string]: any }) =>
      sendServiceRequest<FastNearKvAllByPredecessorResponse>({
        family: "fastdata.kv",
        path: `/v0/all/${encodePathParam(predecessorId, "predecessorId")}`,
        method: "POST",
        body: omitUndefinedEntries(body),
      }),

    multi: (body: Record<string, any>) =>
      sendServiceRequest<FastNearKvMultiResponse>({
        family: "fastdata.kv",
        path: "/v0/multi",
        method: "POST",
        body: omitUndefinedEntries(body),
      }),
  },
};

export const localTxHistory = () => {
  return getTxHistory();
};

export const signOut = async ({
  network,
}: { network?: FastNearNetworkId } = {}) => {
  const provider = getWalletProvider();
  const targetNetwork = network ?? getConfig().networkId;

  if (provider?.isConnected({ network: targetNetwork })) {
    await provider.disconnect({ network: targetNetwork });
  }

  // Only reset the api-level global state when signing out the *active*
  // network. Signing out a non-active network (e.g. testnet while the
  // active config is mainnet) leaves `_state.accountId` and the active
  // config untouched so the active session survives. Once api gains a
  // per-network state map, this clear can move to per-network too.
  if (targetNetwork === getConfig().networkId) {
    update({ accountId: null, privateKey: null, contractId: null });
    setConfig(NETWORKS[DEFAULT_NETWORK_ID]);
  }
};

export const sendTx = async ({
                               receiverId,
                               actions,
                               waitUntil,
                             }: {
  receiverId: string;
  actions: any[];
  waitUntil?: string;
}) => {
  const signerId = _state.accountId;
  if (!signerId) throw new Error("Must sign in");

  const pubKey = _state.publicKey ?? "";
  const privKey = _state.privateKey;
  const txId = generateTxId();

  // If no local private key, or the receiver doesn't match the access key contract,
  // or the actions aren't signable with a limited access key, delegate to the wallet
  if (!privKey || receiverId !== _state.accessKeyContractId || !canSignWithLAK(actions)) {
    const jsonTx = { signerId, receiverId, actions };
    updateTxHistory({ status: "Pending", txId, tx: jsonTx, finalState: false });

    try {
      const provider = getWalletProvider();
      if (!provider?.isConnected()) {
        throw new Error("Must sign in");
      }

      const result = await provider.sendTransaction(jsonTx);

      if (!result) {
        // User rejected
        updateTxHistory({ txId, status: "RejectedByUser", finalState: true });
        return { rejected: true };
      }

      if (result.outcomes?.length) {
        result.outcomes.forEach((r: any) =>
          updateTxHistory({
            txId,
            status: "Executed",
            result: r,
            txHash: r.transaction?.hash,
            finalState: true,
          })
        );
      }

      return result;
    } catch (err) {
      console.error('fastnear: error sending tx using wallet provider:', err)
      updateTxHistory({
        txId,
        status: "Error",
        error: tryParseJson((err as Error).message),
        finalState: true,
      });

      return Promise.reject(err);
    }
  }

  // Local signing path (limited access key)
  let nonce = lsGet("nonce") as number | null;
  if (nonce == null) {
    const accessKey = await queryAccessKey({ accountId: signerId, publicKey: pubKey });
    if (accessKey.result.error) {
      throw new Error(`Access key error: ${accessKey.result.error} when attempting to get nonce for ${signerId} for public key ${pubKey}`);
    }
    nonce = accessKey.result.nonce;
    lsSet("nonce", nonce);
  }

  let lastKnownBlock = lsGet("block") as LastKnownBlock | null;
  if (
    !lastKnownBlock ||
    parseFloat(lastKnownBlock.header.timestamp_nanosec) / 1e6 + MaxBlockDelayMs < Date.now()
  ) {
    const latestBlock = await queryBlock({ blockId: "final" });
    lastKnownBlock = {
      header: {
        hash: latestBlock.result.header.hash,
        timestamp_nanosec: latestBlock.result.header.timestamp_nanosec,
      },
    };
    lsSet("block", lastKnownBlock);
  }

  nonce += 1;
  lsSet("nonce", nonce);

  const blockHash = lastKnownBlock.header.hash;

  const plainTransactionObj: PlainTransaction = {
    signerId,
    publicKey: pubKey,
    nonce,
    receiverId,
    blockHash,
    actions,
  };

  const txBytes = serializeTransaction(plainTransactionObj);
  const txHashBytes = sha256(txBytes);
  const txHash58 = toBase58(txHashBytes);

  const signatureBase58 = signHash(txHashBytes, privKey, { returnBase58: true }) as string;
  const signedTransactionBytes = serializeSignedTransaction(plainTransactionObj, signatureBase58);
  const signedTxBase64 = bytesToBase64(signedTransactionBytes);

  updateTxHistory({
    status: "Pending",
    txId,
    tx: plainTransactionObj,
    signature: signatureBase58,
    signedTxBase64,
    txHash: txHash58,
    finalState: false,
  });

  return await sendTxToRpc(signedTxBase64, waitUntil, txId);
};

/**
 * Signs a NEP-413 message using the connected wallet.
 */
export const signMessage = async (message: NEP413Message) => {
  const provider = getWalletProvider();
  if (!provider?.isConnected()) {
    throw new Error("Must sign in");
  }
  if (!provider.signMessage) {
    throw new Error("Connected wallet does not support signMessage");
  }
  return provider.signMessage(message);
};

/**
 * Set the wallet provider used by the API for signing and sending transactions.
 * Automatically called in IIFE builds when globalThis.nearWallet is present.
 */
export const useWallet = (provider: WalletProvider): void => {
  setWalletProvider(provider);
};

// exports
export const utils = reExportAllUtils;

export const event = stateExports.events;

export const state = {
  DEFAULT_NETWORK_ID: stateExports.DEFAULT_NETWORK_ID,
  NETWORKS: stateExports.NETWORKS,
  _config: stateExports._config,
  _state: stateExports._state,
  _txHistory: stateExports._txHistory,
  _unbroadcastedEvents: stateExports._unbroadcastedEvents,
  setWalletProvider: stateExports.setWalletProvider,
  getWalletProvider: stateExports.getWalletProvider,
  update: stateExports.update,
  updateTxHistory: stateExports.updateTxHistory,
  getConfig: stateExports.getConfig,
  getTxHistory: stateExports.getTxHistory,
  setConfig: stateExports.setConfig,
  resetTxHistory: stateExports.resetTxHistory,
};

export const exp = {
  utils,
  borsh: reExportAllUtils.exp.borsh,
  borshSchema: reExportAllUtils.exp.borshSchema.getBorshSchema(),
};

// action helpers
export const actions = {
  functionCall: ({
                   methodName,
                   gas,
                   deposit,
                   args,
                   argsBase64,
                 }: {
    methodName: string;
    gas?: string;
    deposit?: string;
    args?: Record<string, any>;
    argsBase64?: string;
  }) => ({
    type: "FunctionCall",
    methodName,
    args,
    argsBase64,
    gas,
    deposit,
  }),

  transfer: (yoctoAmount: string) => ({
    type: "Transfer",
    deposit: yoctoAmount,
  }),

  stakeNEAR: ({amount, publicKey}: { amount: string; publicKey: string }) => ({
    type: "Stake",
    stake: amount,
    publicKey,
  }),

  addFullAccessKey: ({publicKey}: { publicKey: string }) => ({
    type: "AddKey",
    publicKey: publicKey,
    accessKey: {permission: "FullAccess"},
  }),

  addLimitedAccessKey: ({
                          publicKey,
                          allowance,
                          accountId,
                          methodNames,
                        }: {
    publicKey: string;
    allowance: string;
    accountId: string;
    methodNames: string[];
  }) => ({
    type: "AddKey",
    publicKey: publicKey,
    accessKey: {
      permission: "FunctionCall",
      allowance,
      receiverId: accountId,
      methodNames,
    },
  }),

  deleteKey: ({publicKey}: { publicKey: string }) => ({
    type: "DeleteKey",
    publicKey,
  }),

  deleteAccount: ({beneficiaryId}: { beneficiaryId: string }) => ({
    type: "DeleteAccount",
    beneficiaryId,
  }),

  createAccount: () => ({
    type: "CreateAccount",
  }),

  deployContract: ({codeBase64}: { codeBase64: string }) => ({
    type: "DeployContract",
    codeBase64,
  }),
};

export const explain = {
  action: (action: any): ExplainedAction => {
    const type = action?.type ?? "Unknown";
    const params = normalizeActionParams(action);

    switch (type) {
      case "FunctionCall":
        return {
          kind: "action",
          type,
          methodName: params.methodName ?? null,
          gas: params.gas ?? null,
          deposit: params.deposit ?? "0",
          args: params.args ?? null,
          argsBase64: params.argsBase64 ?? null,
          params,
        };
      case "Transfer":
        return {
          kind: "action",
          type,
          deposit: params.deposit ?? null,
          params,
        };
      case "Stake":
        return {
          kind: "action",
          type,
          stake: params.stake ?? null,
          publicKey: params.publicKey ?? null,
          params,
        };
      case "AddKey":
        return {
          kind: "action",
          type,
          publicKey: params.publicKey ?? null,
          accessKey: params.accessKey ?? null,
          params,
        };
      case "DeleteKey":
        return {
          kind: "action",
          type,
          publicKey: params.publicKey ?? null,
          params,
        };
      case "DeleteAccount":
        return {
          kind: "action",
          type,
          beneficiaryId: params.beneficiaryId ?? null,
          params,
        };
      case "DeployContract":
        return {
          kind: "action",
          type,
          codeBase64: params.codeBase64 ?? params.code ?? null,
          codeLength: typeof (params.codeBase64 ?? params.code) === "string"
            ? (params.codeBase64 ?? params.code).length
            : null,
          params,
        };
      case "CreateAccount":
      default:
        return {
          kind: "action",
          type,
          params,
        };
    }
  },

  tx: ({
    signerId,
    receiverId,
    actions,
  }: {
    signerId?: string;
    receiverId: string;
    actions: any[];
  }): ExplainedTransaction => ({
    kind: "transaction",
    signerId: signerId ?? null,
    receiverId,
    actionCount: actions.length,
    actions: actions.map((action) => explain.action(action)),
  }),

  error: (error: unknown): ExplainedError => {
    const parsed = parseErrorPayload(error);
    return {
      ...parsed,
      retryable: looksRetryable(parsed.message, parsed.code, parsed.kind),
    };
  },
};

function normalizeRecipeViewAccountParams(input: RecipeViewAccountInput): RecipeViewAccountParams {
  return typeof input === "string" ? { accountId: input } : input;
}

function normalizeRecipeInspectTransactionParams(
  input: RecipeInspectTransactionInput
): RecipeInspectTransactionParams {
  return typeof input === "string" ? { txHash: input } : input;
}

const recipeDiscoveryEntries: FastNearRecipeDiscoveryEntry[] = [
  {
    id: "view-contract",
    api: "near.recipes.viewContract",
    title: "What does this contract method return?",
  },
  {
    id: "view-account",
    api: "near.recipes.viewAccount",
    title: "What does this account look like on chain?",
  },
  {
    id: "inspect-transaction",
    api: "near.tx.transactions",
    title: "What happened in this transaction?",
  },
  {
    id: "account-full",
    api: "near.api.v1.accountFull",
    title: "What does this account own?",
  },
  {
    id: "transfers-query",
    api: "near.transfers.query",
    title: "What is this account's recent transfer activity?",
  },
  {
    id: "last-block-final",
    api: "near.neardata.lastBlockFinal",
    title: "What block is NEAR on right now?",
  },
  {
    id: "kv-latest-key",
    api: "near.fastdata.kv.getLatestKey",
    title: "What is the latest indexed value for this exact key?",
  },
  {
    id: "connect-wallet",
    api: "near.recipes.connect",
    title: "How do I connect a wallet?",
  },
  {
    id: "function-call",
    api: "near.recipes.functionCall",
    title: "How do I send one function call?",
  },
  {
    id: "transfer",
    api: "near.recipes.transfer",
    title: "How do I transfer NEAR?",
  },
  {
    id: "sign-message",
    api: "near.recipes.signMessage",
    title: "How do I sign a message?",
  },
];

function listRecipes(): FastNearRecipeDiscoveryEntry[] {
  return recipeDiscoveryEntries.map((entry) => ({ ...entry }));
}

function viewAccountRecipe(
  input: string
): Promise<FastNearRecipeViewAccountResult>;
function viewAccountRecipe(
  input: RecipeViewAccountParams
): Promise<FastNearRecipeViewAccountResult>;
async function viewAccountRecipe(
  input: RecipeViewAccountInput
): Promise<FastNearRecipeViewAccountResult> {
  const result = await queryAccount(normalizeRecipeViewAccountParams(input));
  return result.result;
}

function inspectTransactionRecipe(
  input: string
): Promise<FastNearTxTransactionRow | null>;
function inspectTransactionRecipe(
  input: RecipeInspectTransactionParams
): Promise<FastNearTxTransactionRow | null>;
async function inspectTransactionRecipe(
  input: RecipeInspectTransactionInput
): Promise<FastNearTxTransactionRow | null> {
  const { txHash } = normalizeRecipeInspectTransactionParams(input);
  const result = await tx.transactions({ txHashes: [txHash] });
  return result?.transactions?.[0] ?? null;
}

export const recipes = {
  viewContract: (params: RecipeViewContractParams) => view(params),

  viewAccount: viewAccountRecipe,

  inspectTransaction: inspectTransactionRecipe,

  functionCall: ({
    receiverId,
    methodName,
    args,
    argsBase64,
    gas,
    deposit,
    waitUntil,
  }: RecipeFunctionCallParams) =>
    sendTx({
      receiverId,
      waitUntil,
      actions: [
        actions.functionCall({
          methodName,
          args,
          argsBase64,
          gas,
          deposit,
        }),
      ],
    }),

  transfer: ({
    receiverId,
    amount,
    waitUntil,
  }: RecipeTransferParams) =>
    sendTx({
      receiverId,
      waitUntil,
      actions: [actions.transfer(amount)],
    }),

  connect: (params: RecipeConnectParams = {}) => requestSignIn(params),

  signMessage: (message: NEP413Message) => signMessage(message),

  list: listRecipes,

  toJSON: listRecipes,
};
