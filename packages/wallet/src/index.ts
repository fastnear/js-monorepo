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
} from "./connector";

export type { ConnectOptions, ConnectResult, WalletManifest } from "./connector";
