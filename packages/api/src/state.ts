import {
  lsSet,
  lsGet,
  publicKeyFromPrivate,
} from "@fastnear/utils";
import {WalletAdapter} from "@fastnear/wallet-adapter";

export const WIDGET_URL = "https://wallet-adapter.fastnear.com";

export const DEFAULT_NETWORK_ID = "mainnet";
export const NETWORKS = {
  testnet: {
    networkId: "testnet",
    nodeUrl: "https://rpc.testnet.fastnear.com/",
  },
  mainnet: {
    networkId: "mainnet",
    nodeUrl: "https://rpc.mainnet.fastnear.com/",
  },
};

export interface NetworkConfig {
  networkId: string;
  nodeUrl?: string;
  walletUrl?: string;
  helperUrl?: string;
  explorerUrl?: string;

  [key: string]: any;
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

export interface WalletAdapterState {
  publicKey?: string | null;
  privateKey?: string | null;
  accountId?: string | null;
  lastWalletId?: string | null;
  networkId: string;
}


// Load config from localStorage or default to the network's config
export let _config: NetworkConfig = lsGet("config") || {
  ...NETWORKS[DEFAULT_NETWORK_ID]
};

// Load application state from localStorage
export let _state: AppState = lsGet("state") || {};

// Triggered by the wallet adapter
export const onAdapterStateUpdate = (state: WalletAdapterState) => {
  console.log("Adapter state update:", state);
  const {accountId, lastWalletId, privateKey} = state;
  updateState({
    accountId: accountId || undefined,
    lastWalletId: lastWalletId || undefined,
    ...(privateKey ? {privateKey} : {}),
  });
}

export const getWalletAdapterState = (): WalletAdapterState => {
  return {
    publicKey: _state.publicKey,
    accountId: _state.accountId,
    lastWalletId: _state.lastWalletId,
    networkId: DEFAULT_NETWORK_ID,
  };
}

// We can create an adapter instance here
export let _adapter = new WalletAdapter({
  onStateUpdate: onAdapterStateUpdate,
  lastState: getWalletAdapterState(),
  widgetUrl: WIDGET_URL,
});

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

// Event listeners
export const _eventListeners: EventListeners = {
  account: new Set(),
  tx: new Set(),
};

export const _unbroadcastedEvents: UnbroadcastedEvents = {
  account: [],
  tx: [],
};

// Mutators
export const updateState = (newState: Partial<AppState>) => {
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
    notifyAccountListeners(newState.accountId as string);
  }

  if (
    (newState.hasOwnProperty("lastWalletId") &&
      newState.lastWalletId !== oldState.lastWalletId) ||
    (newState.hasOwnProperty("accountId") &&
      newState.accountId !== oldState.accountId) ||
    (newState.hasOwnProperty("privateKey") &&
      newState.privateKey !== oldState.privateKey)
  ) {
    _adapter.setState(getWalletAdapterState());
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
  notifyTxListeners(_txHistory[txId]);
}



// Event Notifiers
export const notifyAccountListeners = (accountId: string) => {
  if (_eventListeners.account.size === 0) {
    _unbroadcastedEvents.account.push(accountId);
    return;
  }
  _eventListeners.account.forEach((callback) => {
    try {
      callback(accountId);
    } catch (e) {
      console.error(e);
    }
  });
}

export const notifyTxListeners = (tx: TxStatus) => {
  if (_eventListeners.tx.size === 0) {
    _unbroadcastedEvents.tx.push(tx);
    return;
  }
  _eventListeners.tx.forEach((callback) => {
    try {
      callback(tx);
    } catch (e) {
      console.error(e);
    }
  });
}

// Event Handlers
export const onAccount = (callback: (accountId: string) => void) => {
  _eventListeners.account.add(callback);
  if (_unbroadcastedEvents.account.length > 0) {
    const events = _unbroadcastedEvents.account;
    _unbroadcastedEvents.account = [];
    events.forEach(notifyAccountListeners);
  }
};

export const onTx = (callback: (tx: TxStatus) => void): void => {
  _eventListeners.tx.add(callback);
  if (_unbroadcastedEvents.tx.length > 0) {
    const events = _unbroadcastedEvents.tx;
    _unbroadcastedEvents.tx = [];
    events.forEach(notifyTxListeners);
  }
};

export const getConfig = (): NetworkConfig => {
  return _config;
}

export const getTxHistory = (): TxHistory => {
  return _txHistory;
}

// Exposed "write" functions
export const setConfig = (newConf: NetworkConfig): void => {
  _config = { ...NETWORKS[newConf.networkId], ...newConf };
  lsSet("config", _config);
}

export const resetTxHistory = (): void => {
  _txHistory = {};
  lsSet("txHistory", _txHistory);
}
