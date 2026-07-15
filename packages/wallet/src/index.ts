export {
  connect,
  disconnect,
  restore,
  reset,
  sendTransaction,
  sendTransactions,
  signMessage,
  accountId,
  isConnected,
  walletName,
  onConnect,
  onDisconnect,
  selectWallet,
  availableWallets,
  registerDebugWallet,
  removeDebugWallet,
  switchNetwork,
  addFunctionCallKey,
  signDelegateActions
} from "./connector.js";

export type {
  BorshSerializedSignedDelegate,
  ConnectOptions,
  ConnectResult,
  WalletManifest,
  SignDelegateAction,
  SignDelegateActionsParams,
  SignDelegateActionResult,
  SignDelegateActionsResponse,
} from "./connector.js";
