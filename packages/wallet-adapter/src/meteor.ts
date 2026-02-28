import { serialize as borshSerialize } from "borsh";
import { privateKeyFromRandom, publicKeyFromPrivate, bytesToBase64, mapTransaction, SCHEMA } from "@fastnear/utils";
import type { PlainTransaction } from "@fastnear/utils";
import { connectorActionsToFastnearActions } from "./actions.js";
import { createRpcFactory } from "./rpc.js";
import { TransportError, UserRejectedError } from "./errors.js";
import { createDefaultStorage, readJson, writeJson } from "./storage.js";
import type {
  AdapterStorage,
  ConnectorActionLike,
  MeteorAdapterOptions,
  MeteorExtensionBridge,
  PopupWindowLike,
  SignAndSendTransactionParams,
  SignAndSendTransactionsParams,
  SignInParams,
  SignMessageParams,
  WalletAccount,
  WalletNetwork,
} from "./types.js";

const METEOR_DEFAULT_WALLET_BASE = "https://wallet.meteorwallet.app";
const METEOR_CONNECTION_PING_MS = 450;
const METEOR_POPUP_WIDTH = 390;
const METEOR_POPUP_HEIGHT = 650;
const LEGACY_AUTH_KEY_SUFFIX = "_meteor_wallet_auth_key";

type MeteorConnectionStatus =
  | "initializing"
  | "connected"
  | "attempting_reconnect"
  | "disconnected"
  | "closed_success"
  | "closed_fail"
  | "closed_window";

type MeteorActionType = "login" | "logout" | "sign" | "verify_owner" | "sign_message";

interface MeteorAuthState {
  accountId?: string;
  allKeys: string[];
  signedInContract?: {
    contract_id?: string;
    public_key: string;
  };
}

interface MeteorConnection {
  uid: string;
  network: WalletNetwork;
  actionType: MeteorActionType;
  status: MeteorConnectionStatus;
  inputs?: Record<string, any>;
  popup?: PopupWindowLike;
  extension?: MeteorExtensionBridge;
  walletOrigin: string;
  cleanupFns: Array<() => void>;
  interval?: ReturnType<typeof setInterval>;
  resolve: (payload: any) => void;
  reject: (error: Error) => void;
}

interface MeteorActionResponse {
  uid?: string;
  status?: MeteorConnectionStatus;
  payload?: any;
  endTags?: string[];
  message?: string;
}

const randomUid = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `meteor-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

const popupFeatures = (): string => {
  if (typeof window === "undefined" || window.top == null) {
    return `popup=1,width=${METEOR_POPUP_WIDTH},height=${METEOR_POPUP_HEIGHT}`;
  }

  const y = window.top.outerHeight / 2 + window.top.screenY - METEOR_POPUP_HEIGHT / 2;
  const x = window.top.outerWidth / 2 + window.top.screenX - METEOR_POPUP_WIDTH / 2;
  return `popup=1,width=${METEOR_POPUP_WIDTH},height=${METEOR_POPUP_HEIGHT},top=${y},left=${x}`;
};

const isUserRejectedTag = (tag?: string): boolean => {
  return tag === "USER_CANCELLED" || tag === "WINDOW_CLOSED" || tag === "INCOMPLETE_ACTION";
};

const mapMeteorError = (message: string, endTags?: string[]): Error => {
  const tags = endTags ?? [];
  const lastTag = tags[tags.length - 1];

  if (isUserRejectedTag(lastTag)) {
    return new UserRejectedError(lastTag ?? "USER_REJECTED", message, { details: { endTags: tags } });
  }

  if (lastTag === "POPUP_WINDOW_OPEN_FAILED" || lastTag === "POPUP_WINDOW_REFUSED") {
    return new TransportError(lastTag, message, { details: { endTags: tags } });
  }

  return new TransportError(lastTag ?? "METEOR_ACTION_FAILED", message, {
    details: { endTags: tags },
  });
};

const ensureNetwork = (network: string): WalletNetwork => {
  if (network !== "mainnet" && network !== "testnet") {
    throw new TransportError("INVALID_NETWORK", `Unsupported network: ${network}`);
  }
  return network;
};

const toMeteorTxPayload = (tx: PlainTransaction): string => {
  const encoded = borshSerialize(SCHEMA.Transaction, mapTransaction(tx));
  return bytesToBase64(new Uint8Array(encoded));
};

const normalizeActionError = (error: unknown): Error => {
  if (error instanceof TransportError || error instanceof UserRejectedError) return error;
  if (error instanceof Error) return new TransportError("METEOR_ACTION_FAILED", error.message, { cause: error });
  return new TransportError("METEOR_ACTION_FAILED", "Meteor action failed", { details: error });
};

export const createMeteorAdapter = (options: MeteorAdapterOptions = {}) => {
  const storage: AdapterStorage = options.storage ?? createDefaultStorage();
  const walletBaseUrl = options.walletBaseUrl ?? METEOR_DEFAULT_WALLET_BASE;
  const appKeyPrefix = options.appKeyPrefix ?? "near_app";
  const openWindow =
    options.openWindow ??
    ((url: string, name?: string, features?: string) => {
      if (typeof window === "undefined") return null;
      return window.open(url, name ?? "MeteorWallet", features ?? popupFeatures()) as any;
    });

  const rpcForNetwork = createRpcFactory(options.getNetworkProviders);
  const walletOrigin = new URL(walletBaseUrl).origin;
  const authStorageKey = (network: WalletNetwork) => `${appKeyPrefix}${LEGACY_AUTH_KEY_SUFFIX}:${network}`;
  const legacyAuthKey = `${appKeyPrefix}${LEGACY_AUTH_KEY_SUFFIX}`;

  let extensionListenerAttached = false;
  let activeConnection: MeteorConnection | null = null;

  const loadAuth = async (network: WalletNetwork): Promise<MeteorAuthState> => {
    const keyed = await readJson<MeteorAuthState>(storage, authStorageKey(network), { allKeys: [] });
    if (keyed.accountId || (keyed.allKeys?.length ?? 0) > 0) return keyed;
    return readJson<MeteorAuthState>(storage, legacyAuthKey, { allKeys: [] });
  };

  const saveAuth = async (network: WalletNetwork, state: MeteorAuthState): Promise<void> => {
    await writeJson(storage, authStorageKey(network), state);
    await writeJson(storage, legacyAuthKey, state);
  };

  const clearAuth = async (network: WalletNetwork): Promise<void> => {
    await storage.remove(authStorageKey(network));
  };

  const cleanupConnection = () => {
    if (activeConnection == null) return;
    if (activeConnection.interval != null) clearInterval(activeConnection.interval);
    activeConnection.cleanupFns.forEach((fn) => fn());
    activeConnection.cleanupFns = [];
    activeConnection.popup?.close?.();
    activeConnection = null;
  };

  const sendConnectionMessage = (connection: MeteorConnection): void => {
    const payload: Record<string, any> = {
      uid: connection.uid,
      actionType: connection.actionType,
      status: connection.status,
      network: connection.network,
      endTags: [],
    };
    if (connection.status === "initializing") payload.inputs = connection.inputs;

    if (connection.extension != null) {
      connection.extension.sendMessageData(payload);
      return;
    }

    if (connection.popup?.postMessage == null) return;
    try {
      connection.popup.postMessage(payload, connection.walletOrigin);
    } catch {
      connection.popup.postMessage(payload);
    }
  };

  const closeWithError = (error: Error): void => {
    if (activeConnection == null) return;
    const reject = activeConnection.reject;
    cleanupConnection();
    reject(error);
  };

  const closeWithSuccess = (payload: any): void => {
    if (activeConnection == null) return;
    const resolve = activeConnection.resolve;
    cleanupConnection();
    resolve(payload);
  };

  const handleMeteorResponse = (raw: any) => {
    const data = raw as MeteorActionResponse;
    if (activeConnection == null) return;
    if (data.uid !== activeConnection.uid) return;
    if (data.status == null) return;

    if (data.status === "attempting_reconnect") {
      activeConnection.status = "initializing";
      sendConnectionMessage(activeConnection);
      return;
    }

    if (data.status === "connected" && activeConnection.status === "initializing") {
      activeConnection.status = "connected";
      return;
    }

    if (data.status === "closed_success") {
      closeWithSuccess(data.payload);
      return;
    }

    if (data.status === "closed_fail") {
      closeWithError(mapMeteorError(data.message ?? "Meteor action failed", data.endTags));
      return;
    }

    if (data.status === "closed_window") {
      closeWithError(
        new UserRejectedError(
          "WINDOW_CLOSED",
          data.message ?? "User closed the wallet window",
          { details: { endTags: data.endTags ?? ["WINDOW_CLOSED"] } },
        ),
      );
      return;
    }

    if (data.status === "disconnected") {
      closeWithError(new TransportError("DISCONNECTED", "Meteor wallet transport disconnected"));
    }
  };

  const attachExtensionListenerIfNeeded = (extension?: MeteorExtensionBridge) => {
    if (extension == null || extensionListenerAttached) return;
    extension.addMessageDataListener((message) => handleMeteorResponse(message));
    extensionListenerAttached = true;
  };

  const connectAndWaitForResponse = async <T>(
    network: WalletNetwork,
    actionType: MeteorActionType,
    inputs?: Record<string, any>,
  ): Promise<T> => {
    if (activeConnection != null) {
      activeConnection.reject(
        new TransportError("NEW_ACTION_STARTED", "A new action was started before the previous action completed"),
      );
      cleanupConnection();
    }

    const uid = randomUid();
    const extension = options.getExtensionBridge?.();
    attachExtensionListenerIfNeeded(extension);

    let popup: PopupWindowLike | undefined;
    const cleanupFns: Array<() => void> = [];

    if (extension == null) {
      const url = new URL(`${walletBaseUrl}/connect/${network}/${actionType}`);
      url.searchParams.set("source", "wpm");
      url.searchParams.set("connectionUid", uid);

      popup = openWindow(url.toString(), "MeteorWallet", popupFeatures()) ?? undefined;
      if (popup == null) {
        throw new TransportError("POPUP_WINDOW_OPEN_FAILED", "Couldn't open popup window to complete wallet action");
      }

      if (popup.windowIdPromise != null) {
        const popupId = await popup.windowIdPromise;
        if (popupId == null) {
          throw new TransportError("POPUP_WINDOW_OPEN_FAILED", "Couldn't open popup window to complete wallet action");
        }
      }

      if (typeof window !== "undefined") {
        const listener = (event: MessageEvent) => handleMeteorResponse(event.data);
        window.addEventListener("message", listener);
        cleanupFns.push(() => window.removeEventListener("message", listener));
      }
    }

    return new Promise<T>((resolve, reject) => {
      const connection: MeteorConnection = {
        uid,
        network,
        actionType,
        status: "initializing",
        inputs,
        popup,
        extension,
        walletOrigin,
        cleanupFns,
        resolve,
        reject,
      };

      activeConnection = connection;
      sendConnectionMessage(connection);
      connection.interval = setInterval(() => {
        if (activeConnection == null) return;
        if (activeConnection.popup != null && activeConnection.popup.closed) {
          closeWithError(
            new UserRejectedError(
              "WINDOW_CLOSED",
              "User closed the wallet window before completing the action",
              { details: { endTags: ["INCOMPLETE_ACTION", "WINDOW_CLOSED"] } },
            ),
          );
          return;
        }
        sendConnectionMessage(activeConnection);
      }, METEOR_CONNECTION_PING_MS);
    });
  };

  const findSignerPublicKey = async (network: WalletNetwork, accountId: string, preferredKeys: string[]): Promise<string> => {
    const rpc = rpcForNetwork(network);
    for (const key of preferredKeys) {
      try {
        await rpc.query({
          request_type: "view_access_key",
          finality: "optimistic",
          account_id: accountId,
          public_key: key,
        });
        return key;
      } catch {
        // Ignore and continue probing candidate keys.
      }
    }

    const accessKeyList = await rpc.query<{ keys: Array<{ public_key: string }> }>({
      request_type: "view_access_key_list",
      finality: "optimistic",
      account_id: accountId,
    });

    if (!accessKeyList.keys?.length) {
      throw new TransportError("NO_ACCESS_KEYS", `No access keys found for account ${accountId}`);
    }

    return accessKeyList.keys[0].public_key;
  };

  const prepareMeteorTransactions = async (
    network: WalletNetwork,
    signerId: string,
    preferredKeys: string[],
    transactions: Array<{ receiverId: string; actions: ConnectorActionLike[] }>,
  ): Promise<PlainTransaction[]> => {
    const rpc = rpcForNetwork(network);
    const block = await rpc.block({ finality: "final" });
    const publicKey = await findSignerPublicKey(network, signerId, preferredKeys);
    const accessKey = await rpc.query<{ nonce: number }>({
      request_type: "view_access_key",
      finality: "optimistic",
      account_id: signerId,
      public_key: publicKey,
    });

    return transactions.map((tx, index) => ({
      signerId,
      publicKey,
      nonce: BigInt(accessKey.nonce) + BigInt(index + 1),
      receiverId: tx.receiverId,
      blockHash: block.header.hash,
      actions: connectorActionsToFastnearActions(tx.actions),
    }));
  };

  const getAccountsForNetwork = async (network: WalletNetwork): Promise<WalletAccount[]> => {
    const auth = await loadAuth(network);
    if (!auth.accountId) return [];
    const publicKey = auth.signedInContract?.public_key ?? auth.allKeys?.[0] ?? "";
    return [{ accountId: auth.accountId, publicKey }];
  };

  const signIn = async ({ network, contractId, methodNames }: SignInParams): Promise<WalletAccount[]> => {
    const net = ensureNetwork(network);
    const generatedKey = privateKeyFromRandom();
    const generatedPublicKey = publicKeyFromPrivate(generatedKey);

    const inputs: Record<string, any> = {
      type: methodNames && methodNames.length > 0 ? "SELECTED_METHODS" : "ALL_METHODS",
      contract_id: contractId,
      methods: methodNames ?? [],
      public_key: generatedPublicKey,
    };

    const response = await connectAndWaitForResponse<{ accountId?: string; account_id?: string; allKeys?: string[] }>(
      net,
      "login",
      inputs,
    ).catch((error) => {
      throw normalizeActionError(error);
    });

    const accountId = response.accountId ?? response.account_id;
    if (accountId == null) {
      throw new TransportError("INVALID_LOGIN_RESPONSE", "Meteor login response did not contain an account id", { details: response });
    }

    await saveAuth(net, {
      accountId,
      allKeys: response.allKeys ?? [],
      signedInContract: contractId ? { contract_id: contractId, public_key: generatedPublicKey } : undefined,
    });

    return getAccountsForNetwork(net);
  };

  const signOut = async ({ network }: { network: WalletNetwork }): Promise<void> => {
    const net = ensureNetwork(network);
    const auth = await loadAuth(net);
    if (!auth.accountId) return;

    if (auth.signedInContract != null) {
      await connectAndWaitForResponse(net, "logout", {
        accountId: auth.accountId,
        contractInfo: auth.signedInContract,
      }).catch((error) => {
        throw normalizeActionError(error);
      });
    }

    await clearAuth(net);
    await saveAuth(net, { allKeys: [] });
  };

  const verifyOwner = async ({ network, message, accountId }: { network: WalletNetwork; message: string; accountId?: string }) => {
    const net = ensureNetwork(network);
    const auth = await loadAuth(net);
    const useAccountId = accountId ?? auth.accountId;
    return connectAndWaitForResponse(net, "verify_owner", {
      accountId: useAccountId,
      message,
    }).catch((error) => {
      throw normalizeActionError(error);
    });
  };

  const signMessage = async ({
    network,
    message,
    nonce,
    recipient,
    callbackUrl,
    state,
    accountId,
  }: SignMessageParams): Promise<{ accountId: string; publicKey: string; signature: string; state?: string }> => {
    const net = ensureNetwork(network);
    const auth = await loadAuth(net);
    const useAccountId = accountId ?? auth.accountId;

    const response = await connectAndWaitForResponse<{ accountId: string; publicKey: string; signature: string }>(
      net,
      "sign_message",
      {
        message,
        nonce,
        recipient,
        callbackUrl: callbackUrl ?? options.getLocation?.(),
        state,
        accountId: useAccountId,
      },
    ).catch((error) => {
      throw normalizeActionError(error);
    });

    return {
      ...response,
      state,
    };
  };

  const signAndSendTransactions = async ({
    network,
    signerId,
    transactions,
  }: SignAndSendTransactionsParams): Promise<any[]> => {
    const net = ensureNetwork(network);
    const auth = await loadAuth(net);
    const useSigner = signerId ?? auth.accountId;
    if (useSigner == null) throw new TransportError("NOT_SIGNED_IN", "Wallet is not signed in");

    const prepared = await prepareMeteorTransactions(net, useSigner, auth.allKeys ?? [], transactions);
    const serialized = prepared.map(toMeteorTxPayload).join(",");

    const response = await connectAndWaitForResponse<any>(net, "sign", {
      transactions: serialized,
    }).catch((error) => {
      throw normalizeActionError(error);
    });

    if (Array.isArray(response?.executionOutcomes)) {
      return response.executionOutcomes;
    }

    if (Array.isArray(response)) return response;
    return [response];
  };

  const signAndSendTransaction = async ({
    network,
    signerId,
    receiverId,
    actions,
  }: SignAndSendTransactionParams): Promise<any> => {
    const result = await signAndSendTransactions({
      network,
      signerId,
      transactions: [{ receiverId, actions }],
    });
    return result[0];
  };

  return {
    signIn,
    signOut,
    getAccounts: ({ network }: { network: WalletNetwork }) => getAccountsForNetwork(ensureNetwork(network)),
    verifyOwner,
    signMessage,
    signAndSendTransaction,
    signAndSendTransactions,
  };
};
