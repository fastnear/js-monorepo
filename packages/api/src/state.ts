import {
  lsSet,
  lsGet,
  publicKeyFromPrivate,
} from "@fastnear/utils";

export type FastNearNetworkId = "mainnet" | "testnet";

export interface FastNearServiceConfig {
  baseUrl?: string | null;
}

export interface FastNearServicesConfig {
  rpc?: FastNearServiceConfig;
  api?: FastNearServiceConfig;
  tx?: FastNearServiceConfig;
  transfers?: FastNearServiceConfig;
  neardata?: FastNearServiceConfig;
  fastdata?: {
    kvBaseUrl?: string | null;
  };
}

export interface NetworkConfig {
  networkId: FastNearNetworkId;
  apiKey?: string | null;
  nodeUrl?: string;
  walletUrl?: string;
  helperUrl?: string;
  explorerUrl?: string;
  services?: FastNearServicesConfig;

  [key: string]: any;
}

function mergeServiceConfig(
  base?: FastNearServiceConfig,
  override?: FastNearServiceConfig
): FastNearServiceConfig {
  return {
    ...(base || {}),
    ...(override || {}),
  };
}

function mergeServices(
  base?: FastNearServicesConfig,
  override?: FastNearServicesConfig
): FastNearServicesConfig {
  return {
    rpc: mergeServiceConfig(base?.rpc, override?.rpc),
    api: mergeServiceConfig(base?.api, override?.api),
    tx: mergeServiceConfig(base?.tx, override?.tx),
    transfers: mergeServiceConfig(base?.transfers, override?.transfers),
    neardata: mergeServiceConfig(base?.neardata, override?.neardata),
    fastdata: {
      ...(base?.fastdata || {}),
      ...(override?.fastdata || {}),
    },
  };
}

function normalizeNetworkId(networkId?: string | null): FastNearNetworkId {
  return networkId === "testnet" ? "testnet" : "mainnet";
}

function normalizeApiKey(apiKey?: string | null): string | null {
  if (typeof apiKey !== "string") {
    return null;
  }
  const trimmed = apiKey.trim();
  return trimmed ? trimmed : null;
}

export const DEFAULT_NETWORK_ID: FastNearNetworkId = "mainnet";
export const NETWORKS: Record<FastNearNetworkId, NetworkConfig> = {
  testnet: {
    networkId: "testnet",
    nodeUrl: "https://rpc.testnet.fastnear.com/",
    services: {
      rpc: { baseUrl: "https://rpc.testnet.fastnear.com/" },
      api: { baseUrl: "https://test.api.fastnear.com" },
      tx: { baseUrl: "https://tx.test.fastnear.com" },
      transfers: { baseUrl: null },
      neardata: { baseUrl: "https://testnet.neardata.xyz" },
      fastdata: { kvBaseUrl: "https://kv.test.fastnear.com" },
    },
  },
  mainnet: {
    networkId: "mainnet",
    nodeUrl: "https://rpc.mainnet.fastnear.com/",
    services: {
      rpc: { baseUrl: "https://rpc.mainnet.fastnear.com/" },
      api: { baseUrl: "https://api.fastnear.com" },
      tx: { baseUrl: "https://tx.main.fastnear.com" },
      transfers: { baseUrl: "https://transfers.main.fastnear.com" },
      neardata: { baseUrl: "https://mainnet.neardata.xyz" },
      fastdata: { kvBaseUrl: "https://kv.main.fastnear.com" },
    },
  },
};

export function resolveConfig(
  input?: Partial<NetworkConfig> | null,
  base?: NetworkConfig | null
): NetworkConfig {
  const requested = input || {};
  const baseConfig = base || NETWORKS[DEFAULT_NETWORK_ID];
  const networkId = normalizeNetworkId(requested.networkId ?? baseConfig.networkId);
  const networkDefaults = NETWORKS[networkId];
  const services = mergeServices(
    mergeServices(networkDefaults.services, baseConfig.services),
    requested.services
  );

  const requestedRpcBaseUrl = requested.services?.rpc?.baseUrl;
  const requestedNodeUrl = requested.nodeUrl;
  const rpcBaseUrl =
    requestedRpcBaseUrl ??
    requestedNodeUrl ??
    services.rpc?.baseUrl ??
    networkDefaults.nodeUrl ??
    null;
  const nodeUrl = requestedNodeUrl ?? rpcBaseUrl ?? networkDefaults.nodeUrl;

  services.rpc = {
    ...(services.rpc || {}),
    baseUrl: rpcBaseUrl,
  };

  const next: NetworkConfig = {
    ...networkDefaults,
    ...baseConfig,
    ...requested,
    networkId,
    nodeUrl,
    services,
  };

  if (Object.prototype.hasOwnProperty.call(requested, "apiKey")) {
    next.apiKey = normalizeApiKey(requested.apiKey);
  } else {
    next.apiKey = normalizeApiKey(baseConfig.apiKey);
  }

  return next;
}

export interface AppState {
  accountId?: string | null;
  privateKey?: string | null;
  lastWalletId?: string | null;
  publicKey?: string | null;
  accessKeyContractId?: string | null;

  [key: string]: any;
}

export interface TxStatus {
  txId: string;
  updateTimestamp?: number;

  [key: string]: any;
}

export type TxHistory = Record<string, TxStatus>;

export interface EventListeners {
  account: Set<(accountId: string) => void>;
  tx: Set<(tx: TxStatus) => void>;
}

export interface UnbroadcastedEvents {
  account: string[];
  tx: TxStatus[];
}

// Load config from localStorage or default to the network's config
export let _config: NetworkConfig = resolveConfig(lsGet("config"));

// Load application state from localStorage
export let _state: AppState = lsGet("state") || {};

export interface WalletProvider {
  connect(options?: { contractId?: string; network?: string; excludedWallets?: string[]; features?: Record<string, boolean> }): Promise<{ accountId: string } | null>;
  restore?(options?: { contractId?: string; network?: string }): Promise<{ accountId: string } | null>;
  disconnect(): Promise<void>;
  sendTransaction(params: { receiverId: string; actions: any[]; signerId?: string }): Promise<any>;
  signMessage?(params: { message: string; recipient: string; nonce: Uint8Array }): Promise<any>;
  accountId(): string | null;
  isConnected(): boolean;
}

let _walletProvider: WalletProvider | null = null;

export const setWalletProvider = (provider: WalletProvider): void => {
  _walletProvider = provider;
};

export const getWalletProvider = (): WalletProvider | null => {
  return _walletProvider;
};

// Attempt to set publicKey if we have a privateKey
try {
  _state.publicKey = _state.privateKey
    ? publicKeyFromPrivate(_state.privateKey)
    : null;
} catch (e) {
  console.error("Error parsing private key:", e);
  _state.privateKey = null;
  lsSet("nonce", null);
}

// Transaction history
export let _txHistory: TxHistory = lsGet("txHistory") || {};


export const _unbroadcastedEvents: UnbroadcastedEvents = {
  account: [],
  tx: [],
};

// events / listeners
export const events = {
  _eventListeners: {
    account: new Set(),
    tx: new Set(),
  },

  notifyAccountListeners: (accountId: string) => {
    if (events._eventListeners.account.size === 0) {
      _unbroadcastedEvents.account.push(accountId);
      return;
    }
    events._eventListeners.account.forEach((callback: any) => {
      try {
        callback(accountId);
      } catch (e) {
        console.error(e);
      }
    });
  },

  notifyTxListeners: (tx: TxStatus) => {
    if (events._eventListeners.tx.size === 0) {
      _unbroadcastedEvents.tx.push(tx);
      return;
    }
    events._eventListeners.tx.forEach((callback: any) => {
      try {
        callback(tx);
      } catch (e) {
        console.error(e);
      }
    });
  },

  onAccount: (callback: (accountId: string) => void) => {
    events._eventListeners.account.add(callback);
    if (_unbroadcastedEvents.account.length > 0) {
      const accountEvent = _unbroadcastedEvents.account;
      _unbroadcastedEvents.account = [];
      accountEvent.forEach(events.notifyAccountListeners);
    }
  },

  onTx: (callback: (tx: TxStatus) => void): void => {
    events._eventListeners.tx.add(callback);
    if (_unbroadcastedEvents.tx.length > 0) {
      const txEvent = _unbroadcastedEvents.tx;
      _unbroadcastedEvents.tx = [];
      txEvent.forEach(events.notifyTxListeners);
    }
  }
}

// Mutators
export const update = (newState: Partial<AppState>) => {
  const oldState = _state;
  _state = {..._state, ...newState};

  lsSet("state", {
    accountId: _state.accountId,
    privateKey: _state.privateKey,
    lastWalletId: _state.lastWalletId,
    accessKeyContractId: _state.accessKeyContractId,
  });

  if (
    newState.hasOwnProperty("privateKey") &&
    newState.privateKey !== oldState.privateKey
  ) {
    _state.publicKey = newState.privateKey
      ? publicKeyFromPrivate(newState.privateKey as string)
      : null;
    lsSet("nonce", null);
  }

  if (newState.accountId !== oldState.accountId) {
    events.notifyAccountListeners(newState.accountId as string);
  }
}

export const updateTxHistory = (txStatus: TxStatus) => {
  const txId = txStatus.txId;
  _txHistory[txId] = {
    ...(_txHistory[txId] || {}),
    ...txStatus,
    updateTimestamp: Date.now(),
  };
  lsSet("txHistory", _txHistory);
  events.notifyTxListeners(_txHistory[txId]);
}

export const getConfig = (): NetworkConfig => {
  return _config;
}

export const getTxHistory = (): TxHistory => {
  return _txHistory;
}

// Exposed "write" functions
export const setConfig = (newConf: Partial<NetworkConfig> | FastNearNetworkId): void => {
  const partial = typeof newConf === "string" ? { networkId: newConf } : newConf;
  const nextNetworkId = normalizeNetworkId(partial.networkId ?? _config.networkId);
  const base = nextNetworkId !== _config.networkId ? NETWORKS[nextNetworkId] : _config;
  _config = resolveConfig(partial, base);
  lsSet("config", _config);
}

export const resetTxHistory = (): void => {
  _txHistory = {};
  lsSet("txHistory", _txHistory);
}
