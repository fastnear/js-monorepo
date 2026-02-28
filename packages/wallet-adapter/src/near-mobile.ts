import { serialize as borshSerialize, type Schema } from "borsh";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  base64ToBytes,
  keyFromString,
  privateKeyFromRandom,
  publicKeyFromPrivate,
  sha256,
} from "@fastnear/utils";
import { createRpcFactory } from "./rpc.js";
import { TransportError, UserRejectedError } from "./errors.js";
import { createDefaultStorage, readJson, writeJson } from "./storage.js";
import { defaultPollingOptions, visibilityAwarePoll } from "./polling.js";
import type {
  AdapterStorage,
  ConnectorActionLike,
  NearMobileAdapterOptions,
  NearMobileMetadata,
  SignAndSendTransactionParams,
  SignAndSendTransactionsParams,
  SignInParams,
  SignMessageParams,
  WalletAccount,
  WalletNetwork,
} from "./types.js";

const DEFAULT_SIGNER_BACKEND_URL = "https://near-mobile-signer-backend_production.peersyst.tech";
const DEFAULT_NEAR_MOBILE_WALLET_URL = "near-mobile-wallet://sign";
const SESSION_KEY = "session";
const NEP413_TAG = 2147484061;

type SignerRequestStatus = "pending" | "approved" | "rejected";

interface SessionState {
  mainnet: {
    activeAccount: string | null;
    accounts: Record<string, string>;
  };
  testnet: {
    activeAccount: string | null;
    accounts: Record<string, string>;
  };
}

interface SignerRequestStatusDto {
  id: string;
  status: SignerRequestStatus;
}

interface SignerRequestDto {
  id: string;
  status: SignerRequestStatus;
  network: WalletNetwork;
  signerAccountId?: string;
  requests?: any[];
  txHash?: string[];
}

interface SignMessageResponseDto {
  accountId: string;
  publicKey: string;
  signature: string;
}

interface SignMessageRequestDto {
  id: string;
  network: WalletNetwork;
  status: SignerRequestStatus;
  response?: SignMessageResponseDto;
}

const ensureNetwork = (network: string): WalletNetwork => {
  if (network !== "mainnet" && network !== "testnet") {
    throw new TransportError("INVALID_NETWORK", `Unsupported network: ${network}`);
  }
  return network;
};

const normalizeError = (error: unknown, fallbackCode: string, fallbackMessage: string): Error => {
  if (error instanceof TransportError || error instanceof UserRejectedError) return error;
  if (error instanceof Error) return new TransportError(fallbackCode, error.message, { cause: error });
  return new TransportError(fallbackCode, fallbackMessage, { details: error });
};

const signMessagePayloadSchema: Schema = {
  struct: {
    tag: "u32",
    message: "string",
    nonce: { array: { type: "u8", len: 32 } },
    recipient: "string",
    callbackUrl: { option: "string" },
  },
};

const verifyNep413Signature = ({
  publicKey,
  signature,
  message,
  nonce,
  recipient,
  callbackUrl,
}: {
  publicKey: string;
  signature: string;
  message: string;
  nonce: number[];
  recipient: string;
  callbackUrl?: string;
}): boolean => {
  const borshPayload = borshSerialize(signMessagePayloadSchema, {
    tag: NEP413_TAG,
    message,
    nonce: Uint8Array.from(nonce),
    recipient,
    callbackUrl: callbackUrl ?? null,
  });

  const hash = sha256(new Uint8Array(borshPayload));
  const pk = keyFromString(publicKey);
  const sig = base64ToBytes(signature);

  return ed25519.verify(sig, hash, pk);
};

class SessionRepository {
  private readonly storage: AdapterStorage;
  private readonly key: string;

  constructor(storage: AdapterStorage, key = SESSION_KEY) {
    this.storage = storage;
    this.key = key;
  }

  private defaultState(): SessionState {
    return {
      mainnet: { activeAccount: null, accounts: {} },
      testnet: { activeAccount: null, accounts: {} },
    };
  }

  async get(): Promise<SessionState> {
    return readJson<SessionState>(this.storage, this.key, this.defaultState());
  }

  async set(state: SessionState): Promise<void> {
    await writeJson(this.storage, this.key, state);
  }

  async getKey(network: WalletNetwork, accountId: string): Promise<string> {
    const state = await this.get();
    const key = state[network]?.accounts[accountId];
    if (key == null) {
      throw new TransportError("ACCOUNT_KEY_NOT_FOUND", "Account key not found in session storage");
    }
    return key;
  }

  async setKey(network: WalletNetwork, accountId: string, privateKey: string): Promise<void> {
    const state = await this.get();
    state[network].accounts[accountId] = privateKey;
    await this.set(state);
  }

  async removeKey(network: WalletNetwork, accountId: string): Promise<void> {
    const state = await this.get();
    if (state[network].activeAccount === accountId) {
      state[network].activeAccount = null;
    }
    delete state[network].accounts[accountId];
    await this.set(state);
  }

  async getActiveAccount(network: WalletNetwork): Promise<string | null> {
    const state = await this.get();
    return state[network].activeAccount ?? null;
  }

  async setActiveAccount(network: WalletNetwork, accountId: string): Promise<void> {
    const state = await this.get();
    const exists = Object.prototype.hasOwnProperty.call(state[network].accounts, accountId);
    if (!exists) {
      throw new TransportError("INVALID_ACCOUNT_ID", "Cannot set active account that does not exist in session storage");
    }
    state[network].activeAccount = accountId;
    await this.set(state);
  }

  async getAccounts(network: WalletNetwork): Promise<string[]> {
    const state = await this.get();
    return Object.keys(state[network].accounts);
  }
}

class NearMobileApiClient {
  private readonly backendUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(backendUrl: string, fetcher?: typeof fetch) {
    this.backendUrl = backendUrl.replace(/\/$/, "");
    this.fetcher = fetcher ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetcher(`${this.backendUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "Unknown API error");
        throw new TransportError("API_HTTP_ERROR", `Near Mobile backend request failed (${response.status}): ${text}`);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error: any) {
      if (controller.signal.aborted) {
        throw new TransportError("API_TIMEOUT", "Near Mobile backend request timed out", { cause: error });
      }
      if (error instanceof TransportError) throw error;
      throw new TransportError("API_NETWORK_ERROR", "Near Mobile backend request failed", { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  async createRequest(network: WalletNetwork, transactions: any[], metadata?: NearMobileMetadata): Promise<SignerRequestDto> {
    return this.request<SignerRequestDto>("/api/signer-request", {
      method: "POST",
      body: JSON.stringify({
        network,
        transactions,
        dAppMetadata: metadata,
      }),
    });
  }

  async getRequestStatus(id: string): Promise<SignerRequestStatusDto> {
    return this.request<SignerRequestStatusDto>(`/api/signer-request/${id}/status`, { method: "GET" });
  }

  async getRequest(id: string): Promise<SignerRequestDto> {
    return this.request<SignerRequestDto>(`/api/signer-request/${id}`, { method: "GET" });
  }

  async rejectRequest(id: string): Promise<void> {
    await this.request(`/api/signer-request/${id}/reject`, { method: "POST" });
  }

  async createSignMessageRequest(
    network: WalletNetwork,
    message: string,
    receiver: string,
    nonce: number[],
    callbackUrl?: string,
    metadata?: NearMobileMetadata,
  ): Promise<SignMessageRequestDto> {
    return this.request<SignMessageRequestDto>("/api/signer-request/message", {
      method: "POST",
      body: JSON.stringify({
        network,
        message,
        receiver,
        nonce,
        callbackUrl,
        receiverMetadata: metadata,
      }),
    });
  }

  async getSignMessageRequest(id: string): Promise<SignMessageRequestDto> {
    return this.request<SignMessageRequestDto>(`/api/signer-request/message/${id}`, { method: "GET" });
  }

  async rejectSignMessageRequest(id: string): Promise<void> {
    await this.request(`/api/signer-request/message/${id}/reject`, { method: "POST" });
  }
}

const normalizeTransactions = (
  signerId: string | undefined,
  transactions: Array<{ receiverId: string; actions: ConnectorActionLike[]; signerId?: string }>,
): Array<{ signerId: string; receiverId: string; actions: ConnectorActionLike[] }> => {
  return transactions.map((tx) => {
    const useSigner = tx.signerId ?? signerId;
    if (useSigner == null) throw new TransportError("MISSING_SIGNER_ID", "Missing signer id for transaction");
    return {
      signerId: useSigner,
      receiverId: tx.receiverId,
      actions: tx.actions,
    };
  });
};

export const createNearMobileAdapter = (options: NearMobileAdapterOptions = {}) => {
  const storage = options.storage ?? createDefaultStorage();
  const session = new SessionRepository(storage);
  const backendUrl = options.signerBackendUrl ?? DEFAULT_SIGNER_BACKEND_URL;
  const nearMobileWalletUrl = options.nearMobileWalletUrl ?? DEFAULT_NEAR_MOBILE_WALLET_URL;
  const api = new NearMobileApiClient(backendUrl, options.fetcher);
  const rpcForNetwork = createRpcFactory(options.getNetworkProviders);
  const polling = { ...defaultPollingOptions, ...(options.polling ?? {}) };

  const emitError = (error?: Error) => options.onError?.(error);
  const emitRequested = (payload: {
    id: string;
    kind: "request" | "message";
    network: WalletNetwork;
    request: unknown;
    close: () => Promise<void>;
  }) => {
    options.onRequested?.({
      ...payload,
      requestUrl: `${nearMobileWalletUrl}/${payload.kind}/${payload.id}`,
    });
  };

  const awaitRequestStatus = async (id: string): Promise<SignerRequestStatusDto> => {
    return visibilityAwarePoll(
      () => api.getRequestStatus(id),
      ({ status }) => status === "pending",
      polling,
    );
  };

  const awaitMessageStatus = async (id: string): Promise<SignMessageRequestDto> => {
    return visibilityAwarePoll(
      () => api.getSignMessageRequest(id),
      ({ status, response }) => status === "pending" && response == null,
      polling,
    );
  };

  const handleRejectedStatus = (status: SignerRequestStatus, message: string): void => {
    if (status === "approved") {
      options.onApproved?.();
      return;
    }
    if (status === "rejected") {
      throw new UserRejectedError("USER_REJECTED", message);
    }
  };

  const ensureFullAccessKey = async (network: WalletNetwork, accountId: string, publicKey: string): Promise<void> => {
    const rpc = rpcForNetwork(network);
    const accessKey = await rpc.query<any>({
      request_type: "view_access_key",
      finality: "optimistic",
      account_id: accountId,
      public_key: publicKey,
    });

    if (accessKey?.permission !== "FullAccess") {
      throw new TransportError("INVALID_ACCESS_KEY", "Signer key is not a full access key");
    }
  };

  const getAccounts = async (network: WalletNetwork): Promise<WalletAccount[]> => {
    const net = ensureNetwork(network);
    const accountIds = await session.getAccounts(net);
    const accounts: WalletAccount[] = [];

    for (const accountId of accountIds) {
      const privateKey = await session.getKey(net, accountId);
      accounts.push({
        accountId,
        publicKey: publicKeyFromPrivate(privateKey),
      });
    }

    return accounts;
  };

  const signIn = async ({ network, contractId, methodNames = [], allowance }: SignInParams): Promise<WalletAccount[]> => {
    const net = ensureNetwork(network);
    const privateKey = privateKeyFromRandom();
    const publicKey = publicKeyFromPrivate(privateKey);

    const permission =
      contractId != null
        ? {
            receiverId: contractId,
            methodNames,
            ...(allowance ? { allowance } : {}),
          }
        : "FullAccess";

    const { id, network: responseNetwork, requests } = await api.createRequest(
      net,
      [
        {
          actions: [
            {
              type: "AddKey",
              params: {
                publicKey,
                accessKey: {
                  permission,
                },
              },
            },
          ],
        },
      ],
      options.metadata,
    );

    emitRequested({
      id,
      kind: "request",
      network: responseNetwork,
      request: requests,
      close: async () => api.rejectRequest(id),
    });

    const { status } = await awaitRequestStatus(id);
    handleRejectedStatus(status, "User rejected Near Mobile sign-in");

    const request = await api.getRequest(id);
    if (request.signerAccountId == null) {
      throw new TransportError("REQUEST_NOT_SIGNED", "Signer request was approved but did not return signer account id");
    }

    await session.setKey(net, request.signerAccountId, privateKey);
    await session.setActiveAccount(net, request.signerAccountId);

    options.onSuccess?.();
    return getAccounts(net);
  };

  const signOut = async ({ network }: { network: WalletNetwork }): Promise<void> => {
    const net = ensureNetwork(network);
    const activeAccount = await session.getActiveAccount(net);
    if (activeAccount == null) return;

    const privateKey = await session.getKey(net, activeAccount);
    const publicKey = publicKeyFromPrivate(privateKey);

    const { id, network: responseNetwork, requests } = await api.createRequest(
      net,
      [
        {
          signerId: activeAccount,
          receiverId: activeAccount,
          actions: [
            {
              type: "DeleteKey",
              params: { publicKey },
            },
          ],
        },
      ],
      options.metadata,
    );

    emitRequested({
      id,
      kind: "request",
      network: responseNetwork,
      request: requests,
      close: async () => api.rejectRequest(id),
    });

    const { status } = await awaitRequestStatus(id);
    handleRejectedStatus(status, "User rejected Near Mobile sign-out");

    await session.removeKey(net, activeAccount);
    options.onSuccess?.();
  };

  const signAndSendTransactions = async ({
    network,
    signerId,
    transactions,
  }: SignAndSendTransactionsParams): Promise<any[]> => {
    const net = ensureNetwork(network);
    const activeAccount = signerId ?? (await session.getActiveAccount(net)) ?? undefined;
    const normalizedTransactions = normalizeTransactions(activeAccount, transactions);

    const { id, network: responseNetwork, requests } = await api.createRequest(net, normalizedTransactions, options.metadata);
    emitRequested({
      id,
      kind: "request",
      network: responseNetwork,
      request: requests,
      close: async () => api.rejectRequest(id),
    });

    const { status } = await awaitRequestStatus(id);
    handleRejectedStatus(status, "User rejected Near Mobile transaction signing");

    const request = await api.getRequest(id);
    if (!request.txHash || request.txHash.length === 0) {
      throw new TransportError("REQUEST_NOT_SIGNED", "Near Mobile request did not include transaction hashes");
    }

    const requestSigner = request.signerAccountId ?? normalizedTransactions[0].signerId;
    const rpc = rpcForNetwork(net);
    const outcomes: any[] = [];
    for (const hash of request.txHash) {
      outcomes.push(await rpc.txStatus(hash, requestSigner, "EXECUTED_OPTIMISTIC"));
    }

    options.onSuccess?.();
    return outcomes;
  };

  const signAndSendTransaction = async ({
    network,
    signerId,
    receiverId,
    actions,
  }: SignAndSendTransactionParams): Promise<any> => {
    const outcomes = await signAndSendTransactions({
      network,
      signerId,
      transactions: [{ receiverId, actions, signerId }],
    });
    return outcomes[0];
  };

  const signMessage = async ({
    network,
    message,
    nonce,
    recipient,
    callbackUrl,
  }: SignMessageParams): Promise<{ accountId: string; publicKey: string; signature: string }> => {
    const net = ensureNetwork(network);
    const { id, network: responseNetwork } = await api.createSignMessageRequest(
      net,
      message,
      recipient,
      Array.from(nonce),
      callbackUrl,
      options.metadata,
    );

    emitRequested({
      id,
      kind: "message",
      network: responseNetwork,
      request: { message, nonce, recipient, callbackUrl },
      close: async () => api.rejectSignMessageRequest(id),
    });

    const result = await awaitMessageStatus(id);
    handleRejectedStatus(result.status, "User rejected Near Mobile message signing");

    if (result.response == null) {
      throw new TransportError("NO_SIGNATURE", "Near Mobile message request was approved without a signature");
    }

    const { accountId, publicKey, signature } = result.response;
    const isValidSignature = verifyNep413Signature({
      publicKey,
      signature,
      message,
      nonce,
      recipient,
      callbackUrl,
    });

    if (!isValidSignature) {
      throw new TransportError("INVALID_SIGNATURE", "Near Mobile returned an invalid message signature");
    }

    await ensureFullAccessKey(net, accountId, publicKey);
    options.onSuccess?.();

    return { accountId, publicKey, signature };
  };

  return {
    async signIn(params: SignInParams): Promise<WalletAccount[]> {
      try {
        return await signIn(params);
      } catch (error) {
        const normalized = normalizeError(error, "SIGN_IN_FAILED", "Near Mobile sign-in failed");
        emitError(normalized);
        throw normalized;
      }
    },

    async signOut({ network }: { network: WalletNetwork }): Promise<void> {
      try {
        return await signOut({ network });
      } catch (error) {
        const normalized = normalizeError(error, "SIGN_OUT_FAILED", "Near Mobile sign-out failed");
        emitError(normalized);
        throw normalized;
      }
    },

    async getAccounts({ network }: { network: WalletNetwork }): Promise<WalletAccount[]> {
      try {
        return await getAccounts(network);
      } catch (error) {
        const normalized = normalizeError(error, "GET_ACCOUNTS_FAILED", "Near Mobile getAccounts failed");
        emitError(normalized);
        throw normalized;
      }
    },

    async signMessage(params: SignMessageParams): Promise<{ accountId: string; publicKey: string; signature: string }> {
      try {
        return await signMessage(params);
      } catch (error) {
        const normalized = normalizeError(error, "SIGN_MESSAGE_FAILED", "Near Mobile signMessage failed");
        emitError(normalized);
        throw normalized;
      }
    },

    async signAndSendTransaction(params: SignAndSendTransactionParams): Promise<any> {
      try {
        return await signAndSendTransaction(params);
      } catch (error) {
        const normalized = normalizeError(error, "SIGN_TX_FAILED", "Near Mobile signAndSendTransaction failed");
        emitError(normalized);
        throw normalized;
      }
    },

    async signAndSendTransactions(params: SignAndSendTransactionsParams): Promise<any[]> {
      try {
        return await signAndSendTransactions(params);
      } catch (error) {
        const normalized = normalizeError(error, "SIGN_TXS_FAILED", "Near Mobile signAndSendTransactions failed");
        emitError(normalized);
        throw normalized;
      }
    },
  };
};
