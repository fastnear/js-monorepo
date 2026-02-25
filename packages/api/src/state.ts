import {
  lsSet,
  lsGet,
  publicKeyFromPrivate,
} from "@fastnear/utils";

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

// Load config from localStorage or default to the network's config
export let _config: NetworkConfig = lsGet("config") || {
  ...NETWORKS[DEFAULT_NETWORK_ID]
};

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
export const setConfig = (newConf: NetworkConfig): void => {
  _config = { ...NETWORKS[newConf.networkId], ...newConf };
  lsSet("config", _config);
}

export const resetTxHistory = (): void => {
  _txHistory = {};
  lsSet("txHistory", _txHistory);
}
