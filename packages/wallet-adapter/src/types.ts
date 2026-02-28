export type WalletNetwork = "mainnet" | "testnet";

export interface WalletAccount {
  accountId: string;
  publicKey: string;
}

export interface ConnectorActionLike {
  type: string;
  params?: Record<string, any>;
}

export interface SignInParams {
  network: WalletNetwork;
  contractId?: string;
  methodNames?: string[];
  allowance?: string;
}

export interface SignOutParams {
  network: WalletNetwork;
}

export interface GetAccountsParams {
  network: WalletNetwork;
}

export interface SignMessageParams {
  network: WalletNetwork;
  message: string;
  nonce: number[];
  recipient: string;
  callbackUrl?: string;
  state?: string;
  accountId?: string;
}

export interface SignAndSendTransactionParams {
  network: WalletNetwork;
  signerId?: string;
  receiverId: string;
  actions: ConnectorActionLike[];
}

export interface SignAndSendTransactionsParams {
  network: WalletNetwork;
  signerId?: string;
  transactions: Array<{
    receiverId: string;
    actions: ConnectorActionLike[];
    signerId?: string;
  }>;
}

export interface WalletAdapter {
  signIn(params: SignInParams): Promise<WalletAccount[]>;
  signOut(params: SignOutParams): Promise<void>;
  getAccounts(params: GetAccountsParams): Promise<WalletAccount[]>;
  signMessage(params: SignMessageParams): Promise<{
    accountId: string;
    publicKey: string;
    signature: string;
    state?: string;
  }>;
  signAndSendTransaction(params: SignAndSendTransactionParams): Promise<any>;
  signAndSendTransactions(params: SignAndSendTransactionsParams): Promise<any[]>;
}

export interface AdapterStorage {
  get(key: string): Promise<string | null | undefined> | string | null | undefined;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

export interface PopupWindowLike {
  close?: () => void;
  focus?: () => void;
  postMessage?: (message: any, targetOrigin?: string) => void;
  closed?: boolean;
  windowIdPromise?: Promise<string | null>;
}

export interface MeteorExtensionBridge {
  addMessageDataListener: (listener: (data: any) => void) => void;
  sendMessageData: (data: any) => void;
}

export interface MeteorAdapterOptions {
  walletBaseUrl?: string;
  appKeyPrefix?: string;
  getLocation?: () => string;
  storage?: AdapterStorage;
  getNetworkProviders?: (network: WalletNetwork) => string[];
  openWindow?: (url: string, name?: string, features?: string) => PopupWindowLike | null | undefined;
  getExtensionBridge?: () => MeteorExtensionBridge | undefined;
}

export interface NearMobileMetadata {
  name: string;
  logoUrl: string;
  url?: string;
}

export interface NearMobileRequestPayload {
  id: string;
  kind: "request" | "message";
  network: WalletNetwork;
  requestUrl: string;
  request: unknown;
  close: () => Promise<void>;
}

export interface NearMobileAdapterOptions {
  signerBackendUrl?: string;
  nearMobileWalletUrl?: string;
  storage?: AdapterStorage;
  metadata?: NearMobileMetadata;
  getNetworkProviders?: (network: WalletNetwork) => string[];
  onRequested?: (payload: NearMobileRequestPayload) => void;
  onApproved?: () => void;
  onSuccess?: () => void;
  onError?: (error?: Error) => void;
  fetcher?: typeof fetch;
  polling?: {
    delayMs?: number;
    maxIterations?: number;
    requestTimeoutMs?: number;
    backgroundVisibilityCheckIntervalMs?: number;
    backgroundVisibilityCheckTimeoutMs?: number;
  };
}
