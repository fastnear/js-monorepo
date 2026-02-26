import {
  NearConnector,
  type NearWalletBase,
  type SignAndSendTransactionParams,
  type SignAndSendTransactionsParams,
  type SignMessageParams,
  type ConnectorAction,
  type WalletManifest,
} from "@fastnear/near-connect";

export type { WalletManifest };

type Network = "mainnet" | "testnet";

export interface ConnectOptions {
  network?: Network;
  contractId?: string;
  methodNames?: string[];
  excludedWallets?: string[];
  features?: Record<string, boolean>;
  manifest?: string | { wallets: WalletManifest[]; version: string };
  walletConnect?: {
    projectId: string;
    metadata?: {
      name?: string;
      description?: string;
      url?: string;
      icons?: string[];
    };
  };
  footerBranding?: {
    heading?: string;
    link?: string;
    linkText?: string;
    icon?: string;
  } | null;
}

/**
 * Convert a fastnear-style flat action to a @hot-labs/near-connect ConnectorAction.
 * Fastnear format: { type: "FunctionCall", methodName, args, gas, deposit }
 * Connector format: { type: "FunctionCall", params: { methodName, args, gas, deposit } }
 */
function toConnectorAction(action: any): ConnectorAction {
  const { type, ...rest } = action;
  switch (type) {
    case "FunctionCall":
      return { type: "FunctionCall", params: { methodName: rest.methodName, args: rest.args ?? {}, gas: rest.gas ?? "30000000000000", deposit: rest.deposit ?? "0" } };
    case "Transfer":
      return { type: "Transfer", params: { deposit: rest.deposit } };
    case "Stake":
      return { type: "Stake", params: { stake: rest.stake, publicKey: rest.publicKey } };
    case "AddKey":
      return { type: "AddKey", params: { publicKey: rest.publicKey, accessKey: rest.accessKey } };
    case "DeleteKey":
      return { type: "DeleteKey", params: { publicKey: rest.publicKey } };
    case "DeleteAccount":
      return { type: "DeleteAccount", params: { beneficiaryId: rest.beneficiaryId } };
    case "CreateAccount":
      return { type: "CreateAccount" } as ConnectorAction;
    case "DeployContract":
      return { type: "DeployContract", params: { code: rest.code ?? rest.codeBase64 } } as ConnectorAction;
    default:
      // Pass through if already in connector format (has params)
      return action;
  }
}

function toConnectorActions(actions: any[]): ConnectorAction[] {
  return actions.map(toConnectorAction);
}

/**
 * Detect whether an action is in fastnear flat format (no params wrapper).
 */
function isFastnearAction(action: any): boolean {
  return action.type && !action.params && action.type !== "CreateAccount";
}

export interface ConnectResult {
  accountId: string;
  publicKey?: string;
}

type ConnectCallback = (result: ConnectResult) => void;
type DisconnectCallback = () => void;

// Module-level state
let connector: NearConnector | null = null;
let connectedWallet: NearWalletBase | null = null;
let currentAccountId: string | null = null;
let currentNetwork: Network = "mainnet";

const connectListeners: ConnectCallback[] = [];
const disconnectListeners: DisconnectCallback[] = [];

function getOrCreateConnector(options?: ConnectOptions): NearConnector {
  if (connector) return connector;

  const opts: Record<string, any> = {
    network: options?.network ?? currentNetwork,
    footerBranding: options?.footerBranding !== undefined
      ? options.footerBranding
      : {
          heading: "Powered by FastNear",
          link: "https://fastnear.com",
          linkText: "fastnear.com",
        },
  };

  if (options?.contractId) {
    opts.signIn = {
      contractId: options.contractId,
      methodNames: options.methodNames ?? [],
    };
  }

  if (options?.excludedWallets) {
    opts.excludedWallets = options.excludedWallets;
  }

  if (options?.features) {
    opts.features = options.features;
  }

  if (options?.manifest) {
    opts.manifest = options.manifest;
  }

  connector = new NearConnector(opts);

  connector.on("wallet:signIn", (event: any) => {
    const acct = event?.accounts?.[0];
    if (acct) {
      currentAccountId = acct.accountId;
      const result: ConnectResult = {
        accountId: acct.accountId,
        publicKey: acct.publicKey,
      };
      for (const cb of connectListeners) {
        try { cb(result); } catch (_) { /* listener error */ }
      }
    }
  });

  connector.on("wallet:signOut", () => {
    connectedWallet = null;
    currentAccountId = null;
    for (const cb of disconnectListeners) {
      try { cb(); } catch (_) { /* listener error */ }
    }
  });

  return connector;
}

/**
 * Restore a previously connected wallet session.
 * Call this on page load to re-hydrate state from storage.
 */
export async function restore(options?: ConnectOptions): Promise<ConnectResult | null> {
  const c = getOrCreateConnector(options);
  try {
    const result = await c.getConnectedWallet();
    if (result?.wallet && result?.accounts?.length) {
      connectedWallet = result.wallet;
      currentAccountId = result.accounts[0].accountId;
      const connectResult: ConnectResult = {
        accountId: currentAccountId || '',
        publicKey: result.accounts[0].publicKey,
      };
      for (const cb of connectListeners) {
        try { cb(connectResult); } catch (_) { /* listener error */ }
      }
      return connectResult;
    }
  } catch (_) {
    // No previous session
  }
  return null;
}

/**
 * Show the wallet picker popup without signing in.
 * Returns the selected wallet ID string.
 */
export async function selectWallet(
  options?: ConnectOptions & { features?: Partial<Record<string, boolean>> }
): Promise<string> {
  const c = getOrCreateConnector(options);
  return c.selectWallet({ features: options?.features });
}

/**
 * Return the list of available wallet manifests so apps can build custom UI.
 */
export async function availableWallets(options?: ConnectOptions): Promise<WalletManifest[]> {
  const c = getOrCreateConnector(options);
  await c.whenManifestLoaded.catch(() => {});
  return c.availableWallets.map((w: any) => w.manifest);
}

/**
 * Register a debug wallet for developer tooling.
 */
export async function registerDebugWallet(
  manifest: string | WalletManifest,
  options?: ConnectOptions
): Promise<WalletManifest> {
  const c = getOrCreateConnector(options);
  return c.registerDebugWallet(manifest);
}

/**
 * Remove a previously registered debug wallet.
 */
export async function removeDebugWallet(
  id: string,
  options?: ConnectOptions
): Promise<void> {
  const c = getOrCreateConnector(options);
  return c.removeDebugWallet(id);
}

/**
 * Switch the connector to a different network.
 * Requires an existing connector (call connect() or restore() first).
 */
export async function switchNetwork(
  network: Network,
  signInData?: { contractId?: string; methodNames?: string[] }
): Promise<void> {
  if (!connector) throw new Error("No connector initialized. Call connect() or restore() first.");
  return connector.switchNetwork(network, signInData);
}

/**
 * Show the wallet picker popup and connect.
 * Returns the connected account info.
 * If walletId is provided, connects directly to that wallet without showing the picker.
 */
export async function connect(
  options?: ConnectOptions & { walletId?: string }
): Promise<ConnectResult | null> {
  const c = getOrCreateConnector(options);
  let wallet;
  try {
    wallet = await c.connect({ walletId: options?.walletId });
  } catch (_) {
    // User closed the modal or wallet rejected
    return null;
  }
  connectedWallet = wallet;

  // Account info is set by the wallet:signIn event handler,
  // but if it hasn't fired yet, try to get it from the connector.
  if (!currentAccountId) {
    try {
      const info = await c.getConnectedWallet();
      if (info?.accounts?.length) {
        currentAccountId = info.accounts[0].accountId;
      }
    } catch (_) {
      // ignore
    }
  }

  return {
    accountId: currentAccountId ?? "",
    publicKey: undefined,
  };
}

/**
 * Disconnect the current wallet session.
 */
export async function disconnect(): Promise<void> {
  if (connector) {
    await connector.disconnect(connectedWallet ?? undefined);
  }
  connectedWallet = null;
  currentAccountId = null;
}

/**
 * Sign and send a single transaction via the connected wallet.
 * Accepts both fastnear-style flat actions and @hot-labs/near-connect ConnectorActions.
 */
export async function sendTransaction(params: SignAndSendTransactionParams | { receiverId: string; actions: any[]; signerId?: string }): Promise<any> {
  if (!connectedWallet) {
    throw new Error("No wallet connected. Call connect() first.");
  }
  const actions = params.actions.some(isFastnearAction)
    ? toConnectorActions(params.actions)
    : params.actions;
  return connectedWallet.signAndSendTransaction({
    receiverId: params.receiverId,
    actions,
    signerId: params.signerId ?? currentAccountId ?? undefined,
  });
}

/**
 * Sign and send multiple transactions via the connected wallet.
 * Accepts both fastnear-style flat actions and @hot-labs/near-connect ConnectorActions.
 */
export async function sendTransactions(params: SignAndSendTransactionsParams | { transactions: Array<{ receiverId: string; actions: any[] }>; signerId?: string }): Promise<any> {
  if (!connectedWallet) {
    throw new Error("No wallet connected. Call connect() first.");
  }
  const transactions = (params as any).transactions.map((tx: any) => ({
    receiverId: tx.receiverId,
    actions: tx.actions.some(isFastnearAction)
      ? toConnectorActions(tx.actions)
      : tx.actions,
  }));
  return connectedWallet.signAndSendTransactions({
    transactions,
    signerId: params.signerId ?? currentAccountId ?? undefined,
  });
}

/**
 * Sign a message (NEP-413) via the connected wallet.
 */
export async function signMessage(params: SignMessageParams): Promise<any> {
  if (!connectedWallet) {
    throw new Error("No wallet connected. Call connect() first.");
  }
  return connectedWallet.signMessage(params);
}

/**
 * Get the current connected account ID, or null if not connected.
 */
export function accountId(): string | null {
  return currentAccountId;
}

/**
 * Check whether a wallet is currently connected.
 */
export function isConnected(): boolean {
  return currentAccountId !== null && connectedWallet !== null;
}

/**
 * Get the name of the connected wallet (e.g. "MyNearWallet").
 */
export function walletName(): string | null {
  if (!connectedWallet) return null;
  return (connectedWallet as any).metadata?.name ?? null;
}

/**
 * Destroy the current connector so the next connect() or restore() creates a new one
 * with fresh options (e.g. different excludedWallets or features).
 */
export function reset(): void {
  connector = null;
  connectedWallet = null;
  currentAccountId = null;
}

/**
 * Register a callback for when a wallet connects.
 */
export function onConnect(cb: ConnectCallback): void {
  connectListeners.push(cb);
}

/**
 * Register a callback for when a wallet disconnects.
 */
export function onDisconnect(cb: DisconnectCallback): void {
  disconnectListeners.push(cb);
}
