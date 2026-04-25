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
  getAccountState,
  getActiveNetwork,
  getWalletProvider,
  setActiveNetwork,
  setWalletProvider,
  getTxHistory,
  update,
  updateAccountState,
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
  resolveConfig,
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
  // When set, routes the request through the override network's defaults
  // (URLs from `NETWORKS[network].services.*`) instead of the active
  // config. The active config's `apiKey` still flows through. Without
  // it, the active config is used end-to-end.
  network?: FastNearNetworkId;
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

// Resolve the config to use for a per-call override. Without an
// override, returns the active config. With one, returns a config built
// from `NETWORKS[network].services` (so URLs hit the right hosts) but
// inheriting the active `apiKey` (which is account-bound, not
// network-bound). User-applied per-network URL overrides via
// `near.config({ services: …, networkId: "testnet" })` are not currently
// preserved across cross-network calls — callers who need that should
// switch via `near.config({ networkId })` and back.
function resolveConfigForCall(network?: FastNearNetworkId): NetworkConfig {
  const active = getConfig();
  if (!network || network === active.networkId) {
    return active;
  }
  return resolveConfig({ apiKey: active.apiKey ?? null }, NETWORKS[network]);
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

function buildAuthedUrl(
  service: ServiceFamily,
  baseUrl: string,
  path = "",
  query?: Record<string, any>,
  config: NetworkConfig = getConfig(),
): string {
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
  network,
}: ServiceRequestOptions): Promise<T> {
  const config = resolveConfigForCall(network);
  const authStyle = SERVICE_AUTH_STYLES[family];
  const url = buildAuthedUrl(family, resolveServiceBaseUrl(family, config), path, query, config);
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
  /**
   * Route this call to the override network's RPC instead of the active
   * `near.config().networkId`. Useful when a page holds parallel
   * mainnet+testnet sessions and a single read or write needs to target
   * the non-active network without flipping config back and forth.
   */
  network?: FastNearNetworkId;
}

export async function sendRpc<T = any>(
  method: string,
  params: Record<string, any> | any[],
  options?: RpcRouteOptions,
): Promise<T> {
  const config = resolveConfigForCall(options?.network);
  const baseUrl = options?.useArchival ? resolveArchivalUrl(config) : resolveRpcUrl(config);
  const response = await fetch(buildAuthedUrl("rpc", baseUrl, "", undefined, config), {
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

export function afterTxSent(txId: string, network?: FastNearNetworkId) {
  const txHistory = getTxHistory();
  sendRpc("tx", {
    tx_hash: txHistory[txId]?.txHash,
    sender_account_id: txHistory[txId]?.tx?.signerId,
    wait_until: "EXECUTED_OPTIMISTIC",
  }, { network })
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

export async function sendTxToRpc(
  signedTxBase64: string,
  waitUntil: string | undefined,
  txId: string,
  network?: FastNearNetworkId,
) {
  // default to "INCLUDED"
  // see options: https://docs.near.org/api/rpc/transactions#tx-status-result
  waitUntil = waitUntil || "INCLUDED";

  try {
    const sendTxRes = await sendRpc("send_tx", {
      signed_tx_base64: signedTxBase64,
      wait_until: waitUntil,
    }, { network });

    updateTxHistory({ txId, status: "Included", finalState: false });
    afterTxSent(txId, network);

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

export const accountId = (options: { network?: FastNearNetworkId } = {}) =>
  getAccountState(options.network).accountId;

export const publicKey = (options: { network?: FastNearNetworkId } = {}) =>
  getAccountState(options.network).publicKey;

export const config = (newConfig?: Partial<NetworkConfig>) => {
  const current = getConfig();
  if (newConfig) {
    const networkChanging =
      !!newConfig.networkId && current.networkId !== newConfig.networkId;
    setConfig(newConfig);
    if (networkChanging) {
      // Per-network state and per-network block cache are preserved
      // across config switches — each network's slot survives. tx
      // history is still cleared because it's keyed by local txId, not
      // network, and a switch is the natural boundary for "I'm done
      // with the previous network's recent activity."
      resetTxHistory();
    }
    // Whenever a `networkId` is explicitly specified, pin the active
    // cursor to it — even when config.networkId was already that value.
    // Callers use `config({ networkId })` as the canonical "switch
    // default network" idiom, so it should also flip active.
    if (newConfig.networkId) {
      setActiveNetwork(getConfig().networkId);
    }
  }
  return getConfig();
};

export const authStatus = (
  options: { network?: FastNearNetworkId } = {},
): string | Record<string, any> => {
  return getAccountState(options.network).accountId ? "SignedIn" : "SignedOut";
};

export const getPublicKeyForContract = (options: { network?: FastNearNetworkId } = {}) => {
  return publicKey(options);
}

export const selected = (options: { network?: FastNearNetworkId } = {}) => {
  const network = options.network ?? getConfig().networkId;
  const slot = getAccountState(network);

  return {
    network,
    nodeUrl: getConfig().nodeUrl,
    walletUrl: getConfig().walletUrl,
    helperUrl: getConfig().helperUrl,
    explorerUrl: getConfig().explorerUrl,
    account: slot.accountId,
    contract: slot.accessKeyContractId,
    publicKey: slot.publicKey,
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

  // Write the connected account into the *target network*'s slot rather
  // than the legacy global, and promote that network to active so that
  // back-compat callers (`near.accountId()` without args, etc.) resolve
  // to the just-connected session.
  updateAccountState({ accountId: result.accountId }, targetNetwork);
  setActiveNetwork(targetNetwork);
  return result;
};

export const view = async ({
                             contractId,
                             methodName,
                             args,
                             argsBase64,
                             blockId,
                             useArchival,
                             network,
                           }: {
  contractId: string;
  methodName: string;
  args?: any;
  argsBase64?: string;
  blockId?: string;
  useArchival?: boolean;
  network?: FastNearNetworkId;
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
    { useArchival, network },
  );

  return parseJsonFromBytes(queryResult.result.result);
};

export const queryAccount = async ({
                                accountId,
                                blockId,
                                useArchival,
                                network,
                              }: {
  accountId: string;
  blockId?: string;
  useArchival?: boolean;
  network?: FastNearNetworkId;
}): Promise<FastNearRpcQueryAccountResponse> => {
  return sendRpc(
    "query",
    withBlockId({ request_type: "view_account", account_id: accountId }, blockId),
    { useArchival, network },
  );
};

export const queryBlock = async ({ blockId, useArchival, network }: { blockId?: string; useArchival?: boolean; network?: FastNearNetworkId }): Promise<BlockView> => {
  return sendRpc("block", withBlockId({}, blockId), { useArchival, network });
};

export const queryAccessKey = async ({
                                  accountId,
                                  publicKey,
                                  blockId,
                                  useArchival,
                                  network,
                                }: {
  accountId: string;
  publicKey: string;
  blockId?: string;
  useArchival?: boolean;
  network?: FastNearNetworkId;
}): Promise<AccessKeyWithError> => {
  return sendRpc(
    "query",
    withBlockId(
      { request_type: "view_access_key", account_id: accountId, public_key: publicKey },
      blockId
    ),
    { useArchival, network },
  );
};

export const queryTx = async ({ txHash, accountId, useArchival, network }: { txHash: string; accountId: string; useArchival?: boolean; network?: FastNearNetworkId }) => {
  return sendRpc("tx", [txHash, accountId], { useArchival, network });
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
  transactions: ({ txHashes, network, ...filters }: { txHashes: string[]; network?: FastNearNetworkId; [key: string]: any }) =>
    sendServiceRequest<FastNearTxTransactionsResponse>({
      family: "tx",
      path: "/v0/transactions",
      method: "POST",
      network,
      body: omitUndefinedEntries({
        ...filters,
        tx_hashes: requiredParam(txHashes, "txHashes"),
      }),
    }),

  receipt: ({ receiptId, network, ...filters }: { receiptId: string; network?: FastNearNetworkId; [key: string]: any }) =>
    sendServiceRequest<FastNearTxReceiptResponse>({
      family: "tx",
      path: "/v0/receipt",
      method: "POST",
      network,
      body: omitUndefinedEntries({
        ...filters,
        receipt_id: requiredParam(receiptId, "receiptId"),
      }),
    }),

  account: ({ accountId, network, ...filters }: { accountId: string; network?: FastNearNetworkId; [key: string]: any }) =>
    sendServiceRequest<FastNearTxAccountResponse>({
      family: "tx",
      path: "/v0/account",
      method: "POST",
      network,
      body: omitUndefinedEntries({
        ...filters,
        account_id: requiredParam(accountId, "accountId"),
      }),
    }),

  block: ({ network, ...params }: { network?: FastNearNetworkId; [key: string]: any } = {}) =>
    sendServiceRequest<FastNearTxBlockResponse>({
      family: "tx",
      path: "/v0/block",
      method: "POST",
      network,
      body: omitUndefinedEntries(params),
    }),

  blocks: ({ network, ...params }: { network?: FastNearNetworkId; [key: string]: any } = {}) =>
    sendServiceRequest<FastNearTxBlocksResponse>({
      family: "tx",
      path: "/v0/blocks",
      method: "POST",
      network,
      body: omitUndefinedEntries(params),
    }),
};

export const api = {
  v1: {
    accountFull: ({ accountId, network, ...query }: { accountId: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1AccountFullResponse>({
        family: "api",
        path: `/v1/account/${encodePathParam(accountId, "accountId")}/full`,
        network,
        query: omitUndefinedEntries(query),
      }),

    accountFt: ({ accountId, network, ...query }: { accountId: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1AccountFtResponse>({
        family: "api",
        path: `/v1/account/${encodePathParam(accountId, "accountId")}/ft`,
        network,
        query: omitUndefinedEntries(query),
      }),

    accountNft: ({ accountId, network, ...query }: { accountId: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1AccountNftResponse>({
        family: "api",
        path: `/v1/account/${encodePathParam(accountId, "accountId")}/nft`,
        network,
        query: omitUndefinedEntries(query),
      }),

    accountStaking: ({ accountId, network, ...query }: { accountId: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1AccountStakingResponse>({
        family: "api",
        path: `/v1/account/${encodePathParam(accountId, "accountId")}/staking`,
        network,
        query: omitUndefinedEntries(query),
      }),

    publicKey: ({ publicKey, network, ...query }: { publicKey: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1PublicKeyResponse>({
        family: "api",
        path: `/v1/public_key/${encodePathParam(publicKey, "publicKey")}`,
        network,
        query: omitUndefinedEntries(query),
      }),

    publicKeyAll: ({ publicKey, network, ...query }: { publicKey: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1PublicKeyAllResponse>({
        family: "api",
        path: `/v1/public_key/${encodePathParam(publicKey, "publicKey")}/all`,
        network,
        query: omitUndefinedEntries(query),
      }),

    ftTop: ({ tokenId, network, ...query }: { tokenId: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearApiV1FtTopResponse>({
        family: "api",
        path: `/v1/ft/${encodePathParam(tokenId, "tokenId")}/top`,
        network,
        query: omitUndefinedEntries(query),
      }),
  },
};

export const transfers = {
  query: ({ network, ...params }: { network?: FastNearNetworkId; [key: string]: any } = {}) =>
    sendServiceRequest<FastNearTransfersQueryResponse>({
      family: "transfers",
      path: "/v0/transfers",
      method: "POST",
      network,
      body: omitUndefinedEntries(withAliases(params, { accountId: "account_id", resumeToken: "resume_token" })),
    }),
};

// NEP-141 (fungible token) view-call shorthand.
// Each helper is a one-line wrapper around `view` with the standard
// method name pre-filled — agents prompt with the spec's verb instead
// of pasting the underlying methodName recipe each time.
export const ft = {
  balance: ({ contractId, accountId, blockId, useArchival, network }: { contractId: string; accountId: string; blockId?: string; useArchival?: boolean; network?: FastNearNetworkId }) =>
    view({ contractId, methodName: "ft_balance_of", args: { account_id: accountId }, blockId, useArchival, network }),

  metadata: ({ contractId, blockId, useArchival, network }: { contractId: string; blockId?: string; useArchival?: boolean; network?: FastNearNetworkId }) =>
    view({ contractId, methodName: "ft_metadata", args: {}, blockId, useArchival, network }),

  totalSupply: ({ contractId, blockId, useArchival, network }: { contractId: string; blockId?: string; useArchival?: boolean; network?: FastNearNetworkId }) =>
    view({ contractId, methodName: "ft_total_supply", args: {}, blockId, useArchival, network }),

  // NEP-145 storage-management read; many wallet/dApp flows need to know
  // whether an account is registered with the FT contract before transferring.
  storageBalance: ({ contractId, accountId, blockId, useArchival, network }: { contractId: string; accountId: string; blockId?: string; useArchival?: boolean; network?: FastNearNetworkId }) =>
    view({ contractId, methodName: "storage_balance_of", args: { account_id: accountId }, blockId, useArchival, network }),

  // Cross-contract: list every FT contract this account holds, served by
  // the FastNear indexer. Layer-mixed but the natural name from the
  // agent's perspective.
  inventory: ({ accountId, network, ...query }: { accountId: string; network?: FastNearNetworkId; [key: string]: any }) =>
    sendServiceRequest<FastNearApiV1AccountFtResponse>({
      family: "api",
      path: `/v1/account/${encodePathParam(accountId, "accountId")}/ft`,
      network,
      query: omitUndefinedEntries(query),
    }),
};

// NEP-171 (non-fungible token) view-call shorthand. Same pattern as `ft`.
export const nft = {
  metadata: ({ contractId, blockId, useArchival, network }: { contractId: string; blockId?: string; useArchival?: boolean; network?: FastNearNetworkId }) =>
    view({ contractId, methodName: "nft_metadata", args: {}, blockId, useArchival, network }),

  token: ({ contractId, tokenId, blockId, useArchival, network }: { contractId: string; tokenId: string; blockId?: string; useArchival?: boolean; network?: FastNearNetworkId }) =>
    view({ contractId, methodName: "nft_token", args: { token_id: tokenId }, blockId, useArchival, network }),

  forOwner: ({ contractId, accountId, fromIndex, limit, blockId, useArchival, network }: { contractId: string; accountId: string; fromIndex?: string; limit?: number; blockId?: string; useArchival?: boolean; network?: FastNearNetworkId }) =>
    view({
      contractId,
      methodName: "nft_tokens_for_owner",
      args: omitUndefinedEntries({ account_id: accountId, from_index: fromIndex, limit }),
      blockId,
      useArchival,
      network,
    }),

  supplyForOwner: ({ contractId, accountId, blockId, useArchival, network }: { contractId: string; accountId: string; blockId?: string; useArchival?: boolean; network?: FastNearNetworkId }) =>
    view({ contractId, methodName: "nft_supply_for_owner", args: { account_id: accountId }, blockId, useArchival, network }),

  totalSupply: ({ contractId, blockId, useArchival, network }: { contractId: string; blockId?: string; useArchival?: boolean; network?: FastNearNetworkId }) =>
    view({ contractId, methodName: "nft_total_supply", args: {}, blockId, useArchival, network }),

  tokens: ({ contractId, fromIndex, limit, blockId, useArchival, network }: { contractId: string; fromIndex?: string; limit?: number; blockId?: string; useArchival?: boolean; network?: FastNearNetworkId }) =>
    view({
      contractId,
      methodName: "nft_tokens",
      args: omitUndefinedEntries({ from_index: fromIndex, limit }),
      blockId,
      useArchival,
      network,
    }),

  // List every NFT contract this account holds, served by the FastNear indexer.
  inventory: ({ accountId, network, ...query }: { accountId: string; network?: FastNearNetworkId; [key: string]: any }) =>
    sendServiceRequest<FastNearApiV1AccountNftResponse>({
      family: "api",
      path: `/v1/account/${encodePathParam(accountId, "accountId")}/nft`,
      network,
      query: omitUndefinedEntries(query),
    }),
};

export const neardata = {
  lastBlockFinal: ({ network, ...query }: { network?: FastNearNetworkId; [key: string]: any } = {}) =>
    sendServiceRequest<FastNearNeardataLastBlockFinalResponse>({
      family: "neardata",
      path: "/v0/last_block/final",
      network,
      query: omitUndefinedEntries(query),
    }),

  lastBlockOptimistic: ({ network, ...query }: { network?: FastNearNetworkId; [key: string]: any } = {}) =>
    sendServiceRequest<FastNearNeardataLastBlockOptimisticResponse>({
      family: "neardata",
      path: "/v0/last_block/optimistic",
      network,
      query: omitUndefinedEntries(query),
    }),

  block: ({ blockHeight, network, ...query }: { blockHeight: string | number; network?: FastNearNetworkId; [key: string]: any }) =>
    sendServiceRequest<FastNearNeardataBlockResponse>({
      family: "neardata",
      path: `/v0/block/${encodePathParam(blockHeight, "blockHeight")}`,
      network,
      query: omitUndefinedEntries(query),
    }),

  blockHeaders: ({ blockHeight, network, ...query }: { blockHeight: string | number; network?: FastNearNetworkId; [key: string]: any }) =>
    sendServiceRequest<FastNearNeardataBlockHeadersResponse>({
      family: "neardata",
      path: `/v0/block/${encodePathParam(blockHeight, "blockHeight")}/headers`,
      network,
      query: omitUndefinedEntries(query),
    }),

  blockShard: ({ blockHeight, shardId, network, ...query }: { blockHeight: string | number; shardId: string | number; network?: FastNearNetworkId; [key: string]: any }) =>
    sendServiceRequest<FastNearNeardataBlockShardResponse>({
      family: "neardata",
      path: `/v0/block/${encodePathParam(blockHeight, "blockHeight")}/shard/${encodePathParam(shardId, "shardId")}`,
      network,
      query: omitUndefinedEntries(query),
    }),

  blockChunk: ({ blockHeight, shardId, network, ...query }: { blockHeight: string | number; shardId: string | number; network?: FastNearNetworkId; [key: string]: any }) =>
    sendServiceRequest<FastNearNeardataBlockChunkResponse>({
      family: "neardata",
      path: `/v0/block/${encodePathParam(blockHeight, "blockHeight")}/chunk/${encodePathParam(shardId, "shardId")}`,
      network,
      query: omitUndefinedEntries(query),
    }),

  blockOptimistic: ({ blockHeight, network, ...query }: { blockHeight: string | number; network?: FastNearNetworkId; [key: string]: any }) =>
    sendServiceRequest<FastNearNeardataBlockOptimisticResponse>({
      family: "neardata",
      path: `/v0/block_opt/${encodePathParam(blockHeight, "blockHeight")}`,
      network,
      query: omitUndefinedEntries(query),
    }),

  firstBlock: ({ network, ...query }: { network?: FastNearNetworkId; [key: string]: any } = {}) =>
    sendServiceRequest<FastNearNeardataFirstBlockResponse>({
      family: "neardata",
      path: "/v0/first_block",
      network,
      query: omitUndefinedEntries(query),
    }),

  health: ({ network, ...query }: { network?: FastNearNetworkId; [key: string]: any } = {}) =>
    sendServiceRequest<FastNearNeardataHealthResponse>({
      family: "neardata",
      path: "/health",
      network,
      query: omitUndefinedEntries(query),
    }),
};

export const fastdata = {
  kv: {
    getLatestKey: ({ currentAccountId, predecessorId, key, network, ...query }: { currentAccountId: string; predecessorId: string; key: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearKvGetLatestKeyResponse>({
        family: "fastdata.kv",
        path: `/v0/latest/${encodePathParam(currentAccountId, "currentAccountId")}/${encodePathParam(predecessorId, "predecessorId")}/${encodePathParam(key, "key")}`,
        network,
        query: omitUndefinedEntries(query),
      }),

    getHistoryKey: ({ currentAccountId, predecessorId, key, network, ...query }: { currentAccountId: string; predecessorId: string; key: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearKvGetHistoryKeyResponse>({
        family: "fastdata.kv",
        path: `/v0/history/${encodePathParam(currentAccountId, "currentAccountId")}/${encodePathParam(predecessorId, "predecessorId")}/${encodePathParam(key, "key")}`,
        network,
        query: omitUndefinedEntries(query),
      }),

    latestByAccount: ({ accountId, network, ...body }: { accountId: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearKvLatestByAccountResponse>({
        family: "fastdata.kv",
        path: `/v0/latest/${encodePathParam(accountId, "accountId")}`,
        method: "POST",
        network,
        body: omitUndefinedEntries(body),
      }),

    historyByAccount: ({ accountId, network, ...body }: { accountId: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearKvHistoryByAccountResponse>({
        family: "fastdata.kv",
        path: `/v0/history/${encodePathParam(accountId, "accountId")}`,
        method: "POST",
        network,
        body: omitUndefinedEntries(body),
      }),

    latestByPredecessor: ({ currentAccountId, predecessorId, network, ...body }: { currentAccountId: string; predecessorId: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearKvLatestByPredecessorResponse>({
        family: "fastdata.kv",
        path: `/v0/latest/${encodePathParam(currentAccountId, "currentAccountId")}/${encodePathParam(predecessorId, "predecessorId")}`,
        method: "POST",
        network,
        body: omitUndefinedEntries(body),
      }),

    historyByPredecessor: ({ currentAccountId, predecessorId, network, ...body }: { currentAccountId: string; predecessorId: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearKvHistoryByPredecessorResponse>({
        family: "fastdata.kv",
        path: `/v0/history/${encodePathParam(currentAccountId, "currentAccountId")}/${encodePathParam(predecessorId, "predecessorId")}`,
        method: "POST",
        network,
        body: omitUndefinedEntries(body),
      }),

    allByPredecessor: ({ predecessorId, network, ...body }: { predecessorId: string; network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearKvAllByPredecessorResponse>({
        family: "fastdata.kv",
        path: `/v0/all/${encodePathParam(predecessorId, "predecessorId")}`,
        method: "POST",
        network,
        body: omitUndefinedEntries(body),
      }),

    multi: ({ network, ...body }: { network?: FastNearNetworkId; [key: string]: any }) =>
      sendServiceRequest<FastNearKvMultiResponse>({
        family: "fastdata.kv",
        path: "/v0/multi",
        method: "POST",
        network,
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

  // Per-network state means we always clear the target network's slot
  // — parallel sessions on other networks survive untouched. (Pre-1.1.1
  // state was global; this used to be guarded so a non-active sign-out
  // wouldn't clobber the active session. The per-network split moots
  // that guard.)
  updateAccountState(
    {
      accountId: null,
      privateKey: null,
      accessKeyContractId: null,
      lastWalletId: null,
    },
    targetNetwork,
  );

  // Implicit `signOut()` (no arg) preserves the legacy reset-to-default
  // shape: callers using single-session signOut expect the active config
  // to flip back to mainnet defaults afterwards.
  if (network === undefined) {
    setConfig(NETWORKS[DEFAULT_NETWORK_ID]);
    setActiveNetwork(DEFAULT_NETWORK_ID);
  }
};

export const sendTx = async ({
                               receiverId,
                               actions,
                               waitUntil,
                               network,
                             }: {
  receiverId: string;
  actions: any[];
  waitUntil?: string;
  network?: FastNearNetworkId;
}) => {
  const targetNetwork = network ?? getConfig().networkId;
  const slot = getAccountState(targetNetwork);
  const signerId = slot.accountId;
  if (!signerId) throw new Error("Must sign in");

  const pubKey = slot.publicKey ?? "";
  const privKey = slot.privateKey;
  const txId = generateTxId();

  // If no local private key, or the receiver doesn't match the access key contract,
  // or the actions aren't signable with a limited access key, delegate to the wallet
  if (!privKey || receiverId !== slot.accessKeyContractId || !canSignWithLAK(actions)) {
    const jsonTx = { signerId, receiverId, actions };
    updateTxHistory({ status: "Pending", txId, tx: jsonTx, finalState: false });

    try {
      const provider = getWalletProvider();
      if (!provider?.isConnected({ network: targetNetwork })) {
        throw new Error("Must sign in");
      }

      const result = await provider.sendTransaction({ ...jsonTx, network: targetNetwork });

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

  // Local signing path (limited access key). The RPC helpers and the
  // `nonce`/`block` caches are now per-network too, so a sendTx on a
  // non-active network signs against that network's RPC and caches the
  // nonce/block under the right key.
  const nonceKey = `nonce.${targetNetwork}`;
  const blockKey = `block.${targetNetwork}`;

  let nonce = lsGet(nonceKey) as number | null;
  if (nonce == null) {
    const accessKey = await queryAccessKey({ accountId: signerId, publicKey: pubKey, network: targetNetwork });
    if (accessKey.result.error) {
      throw new Error(`Access key error: ${accessKey.result.error} when attempting to get nonce for ${signerId} for public key ${pubKey}`);
    }
    nonce = accessKey.result.nonce;
    lsSet(nonceKey, nonce);
  }

  let lastKnownBlock = lsGet(blockKey) as LastKnownBlock | null;
  if (
    !lastKnownBlock ||
    parseFloat(lastKnownBlock.header.timestamp_nanosec) / 1e6 + MaxBlockDelayMs < Date.now()
  ) {
    const latestBlock = await queryBlock({ blockId: "final", network: targetNetwork });
    lastKnownBlock = {
      header: {
        hash: latestBlock.result.header.hash,
        timestamp_nanosec: latestBlock.result.header.timestamp_nanosec,
      },
    };
    lsSet(blockKey, lastKnownBlock);
  }

  nonce += 1;
  lsSet(nonceKey, nonce);

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

  return await sendTxToRpc(signedTxBase64, waitUntil, txId, targetNetwork);
};

/**
 * Signs a NEP-413 message using the connected wallet. Pass an explicit
 * `{ network }` to route the signature through that network's wallet
 * session — useful when a page holds parallel mainnet+testnet sessions.
 * Without it, the active network's session is used.
 */
export const signMessage = async (
  message: NEP413Message,
  options: { network?: FastNearNetworkId } = {},
) => {
  const provider = getWalletProvider();
  const targetNetwork = options.network ?? getConfig().networkId;
  if (!provider?.isConnected({ network: targetNetwork })) {
    throw new Error("Must sign in");
  }
  if (!provider.signMessage) {
    throw new Error("Connected wallet does not support signMessage");
  }
  return provider.signMessage({ ...message, network: targetNetwork });
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

// `_state` is a live binding in state.ts (reassigned on
// setActiveNetwork / updateAccountState). The literal-object form of
// this namespace would freeze a value-copy at module load and go stale
// as soon as the active network changed, so we expose `_state` as a
// getter that always resolves to the current active slot.
export const state = (() => {
  const ns: Record<string, any> = {
    DEFAULT_NETWORK_ID: stateExports.DEFAULT_NETWORK_ID,
    NETWORKS: stateExports.NETWORKS,
    _config: stateExports._config,
    _txHistory: stateExports._txHistory,
    _unbroadcastedEvents: stateExports._unbroadcastedEvents,
    setWalletProvider: stateExports.setWalletProvider,
    getWalletProvider: stateExports.getWalletProvider,
    update: stateExports.update,
    updateAccountState: stateExports.updateAccountState,
    getAccountState: stateExports.getAccountState,
    getActiveNetwork: stateExports.getActiveNetwork,
    setActiveNetwork: stateExports.setActiveNetwork,
    updateTxHistory: stateExports.updateTxHistory,
    getConfig: stateExports.getConfig,
    getTxHistory: stateExports.getTxHistory,
    setConfig: stateExports.setConfig,
    resetTxHistory: stateExports.resetTxHistory,
  };
  Object.defineProperty(ns, "_state", {
    get: () => stateExports._state,
    enumerable: true,
  });
  return ns;
})();

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
  {
    id: "ft-balance",
    api: "near.ft.balance",
    title: "What is this account's FT balance?",
  },
  {
    id: "ft-metadata",
    api: "near.ft.metadata",
    title: "What does this NEP-141 token call itself?",
  },
  {
    id: "ft-inventory",
    api: "near.ft.inventory",
    title: "Which fungible tokens does this account hold?",
  },
  {
    id: "nft-for-owner",
    api: "near.nft.forOwner",
    title: "Which NFTs does this account own on this contract?",
  },
  {
    id: "nft-inventory",
    api: "near.nft.inventory",
    title: "Which NFT contracts does this account hold tokens on?",
  },
  {
    id: "archival-snapshot",
    api: "near.queryAccount",
    title: "What did this account look like at a specific block?",
  },
  {
    id: "connect-testnet",
    api: "near.recipes.connect",
    title: "How do I open a testnet wallet session alongside mainnet?",
  },
  {
    id: "function-call-testnet",
    api: "near.recipes.functionCall",
    title: "How do I send a function call on testnet without losing my mainnet session?",
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
    network,
  }: RecipeFunctionCallParams) =>
    sendTx({
      receiverId,
      waitUntil,
      network,
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
    network,
  }: RecipeTransferParams) =>
    sendTx({
      receiverId,
      waitUntil,
      network,
      actions: [actions.transfer(amount)],
    }),

  connect: (params: RecipeConnectParams = {}) => requestSignIn(params),

  signMessage: (
    message: NEP413Message,
    options?: { network?: FastNearNetworkId },
  ) => signMessage(message, options),

  list: listRecipes,

  toJSON: listRecipes,
};
