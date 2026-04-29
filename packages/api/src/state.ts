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
  // Optional archival RPC. Used when callers pass `useArchival: true` to
  // `view`/`queryAccount`/etc. Falls back to `rpc` when not configured so
  // callers don't error on misconfiguration — they just see fresh-only state.
  archival?: FastNearServiceConfig;
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
    archival: mergeServiceConfig(base?.archival, override?.archival),
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
      archival: { baseUrl: "https://archival-rpc.testnet.near.org/" },
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
      archival: { baseUrl: "https://archival-rpc.mainnet.near.org/" },
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

export interface AccountSlot {
  accountId?: string | null;
  privateKey?: string | null;
  publicKey?: string | null;
  lastWalletId?: string | null;
  accessKeyContractId?: string | null;
}

// Pre-1.1.1 callers used `AppState` for the flat global state blob. The
// shape now lives as `AccountSlot` (one per network), and `AppState`
// stays as a permissive alias so legacy `update({ … })` callers passing
// extra keys continue to type-check.
export interface AppState extends AccountSlot {
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

// Per-network account state. With @fastnear/wallet 1.1.0+ the wallet keeps
// parallel mainnet+testnet sessions; api now does the same — `_state` is a
// live alias for whichever network slot is currently active.
const _networkStates: Record<FastNearNetworkId, AccountSlot> = {
  mainnet: lsGet("state.mainnet") ?? {},
  testnet: lsGet("state.testnet") ?? {},
};

function persistShape(slot: AccountSlot) {
  return {
    accountId: slot.accountId,
    privateKey: slot.privateKey,
    lastWalletId: slot.lastWalletId,
    accessKeyContractId: slot.accessKeyContractId,
  };
}

// Legacy migration: pre-1.1.1 wrote a single `state` blob. Promote it
// into the mainnet slot once, then clear the legacy key. Mirrors the
// wallet's 1.1.0 migration of unscoped storage keys.
const _legacyState = lsGet("state");
if (_legacyState && Object.keys(_legacyState).length > 0) {
  _networkStates.mainnet = { ..._networkStates.mainnet, ..._legacyState };
  lsSet("state.mainnet", persistShape(_networkStates.mainnet));
  lsSet("state", null);
}

// Same migration for the local-signing nonce/block caches — pre-1.1.2
// kept these as unscoped `nonce` and `block` keys, which collided across
// networks. Promote into the mainnet slot once and clear. Per-network
// keys are written by `sendTx`'s local-signing path going forward.
const _legacyNonce = lsGet("nonce");
if (_legacyNonce !== null && _legacyNonce !== undefined) {
  lsSet("nonce.mainnet", _legacyNonce);
  lsSet("nonce", null);
}
const _legacyBlock = lsGet("block");
if (_legacyBlock) {
  lsSet("block.mainnet", _legacyBlock);
  lsSet("block", null);
}

let _activeNetwork: FastNearNetworkId = normalizeNetworkId(_config.networkId);

// `_state` is a live binding pointing at the active slot. ESM live
// bindings mean importers see the current value at read time; we
// reassign on `setActiveNetwork` and `updateAccountState` so reads
// like `_state.accountId` always resolve to the active network.
export let _state: AccountSlot = _networkStates[_activeNetwork];

export interface WalletProvider {
  connect(options?: {
    contractId?: string;
    network?: string;
    excludedWallets?: string[];
    features?: Record<string, boolean>;
    signMessageParams?: {
      message: string;
      recipient: string;
      nonce: Uint8Array;
    };
  }): Promise<{
    accountId: string;
    network?: string;
    publicKey?: string;
    signedMessage?: {
      accountId: string;
      publicKey: string;
      signature: string;
    };
  } | null>;
  restore?(options?: { contractId?: string; network?: string }): Promise<{ accountId: string; network?: string } | null>;
  disconnect(options?: { network?: string }): Promise<void>;
  sendTransaction(params: { receiverId: string; actions: any[]; signerId?: string; network?: string }): Promise<any>;
  signMessage?(params: { message: string; recipient: string; nonce: Uint8Array; network?: string }): Promise<any>;
  accountId(options?: { network?: string }): string | null;
  isConnected(options?: { network?: string }): boolean;
}

let _walletProvider: WalletProvider | null = null;

export const setWalletProvider = (provider: WalletProvider): void => {
  _walletProvider = provider;
};

export const getWalletProvider = (): WalletProvider | null => {
  return _walletProvider;
};

// Initial publicKey derivation per slot. Each network's persisted
// privateKey is parsed independently; a parse error clears that slot's
// keys without touching the other network.
for (const network of ["mainnet", "testnet"] as const) {
  try {
    const slot = _networkStates[network];
    slot.publicKey = slot.privateKey ? publicKeyFromPrivate(slot.privateKey) : null;
  } catch (e) {
    console.error(`Error parsing private key for ${network}:`, e);
    _networkStates[network].privateKey = null;
    _networkStates[network].publicKey = null;
    lsSet(`nonce.${network}`, null);
  }
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

export const updateAccountState = (
  partial: Partial<AccountSlot>,
  network?: FastNearNetworkId,
): void => {
  const target = network ?? _activeNetwork;
  const oldSlot = _networkStates[target];
  const newSlot: AccountSlot = { ...oldSlot, ...partial };

  if (
    Object.prototype.hasOwnProperty.call(partial, "privateKey") &&
    newSlot.privateKey !== oldSlot.privateKey
  ) {
    newSlot.publicKey = newSlot.privateKey
      ? publicKeyFromPrivate(newSlot.privateKey as string)
      : null;
    // Invalidate the per-network nonce cache when the slot's key changes
    // — the next sendTx local-signing call refetches via view_access_key.
    lsSet(`nonce.${target}`, null);
  }

  _networkStates[target] = newSlot;
  if (target === _activeNetwork) _state = newSlot;
  lsSet(`state.${target}`, persistShape(newSlot));

  if (target === _activeNetwork && newSlot.accountId !== oldSlot.accountId) {
    events.notifyAccountListeners(newSlot.accountId as string);
  }
};

export const getAccountState = (network?: FastNearNetworkId): AccountSlot =>
  _networkStates[network ?? _activeNetwork];

export const getActiveNetwork = (): FastNearNetworkId => _activeNetwork;

export const setActiveNetwork = (network: FastNearNetworkId): void => {
  _activeNetwork = normalizeNetworkId(network);
  _state = _networkStates[_activeNetwork];
};

// Back-compat: legacy `update(partial)` writes into the active network slot.
export const update = (newState: Partial<AppState>) => {
  updateAccountState(newState, _activeNetwork);
};

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
