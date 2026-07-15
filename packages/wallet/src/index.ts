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

export type { ConnectOptions, ConnectResult, WalletManifest, SignDelegateActionsParams, SignDelegateActionResult, SignDelegateActionsResponse } from "./connector.js";
