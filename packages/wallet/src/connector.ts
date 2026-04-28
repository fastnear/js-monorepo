import {
  NearConnector,
  type NearWalletBase,
  type SignAndSendTransactionParams,
  type SignAndSendTransactionsParams,
  type SignMessageParams,
  type SignDelegateActionsParams,
  type ConnectorAction,
  type WalletManifest,
} from "@fastnear/near-connect";
export type { WalletManifest };

export type { SignDelegateActionsParams } from "@fastnear/near-connect";

export interface SignDelegateActionResult {
  delegateHash: Uint8Array;
  signedDelegate: any;
}

export interface SignDelegateActionsResponse {
  signedDelegateActions: SignDelegateActionResult[];
}

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
  network?: Network;
}

type ConnectCallback = (result: ConnectResult) => void;
type DisconnectCallback = (info?: { network: Network }) => void;

const NETWORKS: ReadonlyArray<Network> = ["mainnet", "testnet"];

interface NetworkState {
  connector: NearConnector | null;
  connectedWallet: NearWalletBase | null;
  currentAccountId: string | null;
}

// Per-network state. Each network can hold its own active session, so signing
// into mainnet and testnet on the same page no longer collide. Backwards-
// compatible callers (no `network` argument) are routed to `activeNetwork`,
// which tracks the most recent successful connect/restore.
const networkStates: Record<Network, NetworkState> = {
  mainnet: { connector: null, connectedWallet: null, currentAccountId: null },
  testnet: { connector: null, connectedWallet: null, currentAccountId: null },
};
let activeNetwork: Network = "mainnet";

const connectListeners: ConnectCallback[] = [];
const disconnectListeners: DisconnectCallback[] = [];

function stateFor(network?: Network): NetworkState {
  return networkStates[network ?? activeNetwork];
}

function resolveNetwork(options?: ConnectOptions): Network {
  return options?.network ?? activeNetwork;
}

function getOrCreateConnector(options?: ConnectOptions): NearConnector {
  const network = resolveNetwork(options);
  const state = networkStates[network];
  if (state.connector) return state.connector;

  const opts: Record<string, any> = {
    network,
    footerBranding: options?.footerBranding ?? null,
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

  if (options?.walletConnect) {
    const wc = options.walletConnect;
    opts.walletConnect = {
      projectId: wc.projectId,
      metadata: {
        name: wc.metadata?.name ?? document.title ?? "NEAR dApp",
        description: wc.metadata?.description ?? "",
        url: wc.metadata?.url ?? window.location.origin,
        icons: wc.metadata?.icons ?? [],
      },
    };
  }

  state.connector = new NearConnector(opts);

  state.connector.on("wallet:signIn", (event: any) => {
    const acct = event?.accounts?.[0];
    if (!acct) return;
    state.currentAccountId = acct.accountId;
    activeNetwork = network;
    const result: ConnectResult = {
      accountId: acct.accountId,
      publicKey: acct.publicKey,
      network,
    };
    for (const cb of connectListeners) {
      try { cb(result); } catch (_) { /* listener error */ }
    }
  });

  state.connector.on("wallet:signOut", () => {
    state.connectedWallet = null;
    state.currentAccountId = null;
    for (const cb of disconnectListeners) {
      try { cb({ network }); } catch (_) { /* listener error */ }
    }
  });

  return state.connector;
}

/**
 * Restore a previously connected wallet session.
 * Call this on page load to re-hydrate state from storage.
 *
 * Pass `{ network }` to restore a specific network's session — useful for
 * pages that want to attempt parallel mainnet+testnet restores. Without it,
 * the active network (default `mainnet`) is used.
 */
export async function restore(options?: ConnectOptions): Promise<ConnectResult | null> {
  const network = resolveNetwork(options);
  const state = networkStates[network];
  const c = getOrCreateConnector(options);
  try {
    const result = await c.getConnectedWallet();
    if (result?.wallet && result?.accounts?.length) {
      state.connectedWallet = result.wallet;
      state.currentAccountId = result.accounts[0].accountId;
      activeNetwork = network;
      const connectResult: ConnectResult = {
        accountId: state.currentAccountId || '',
        publicKey: result.accounts[0].publicKey,
        network,
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
 * Add a per-contract function-call access key to the signed-in account.
 *
 * Generates a keypair locally inside the wallet executor, sends an `AddKey`
 * transaction through the wallet (one popup), and stores the private key
 * locally so subsequent zero-deposit function calls to `contractId` can be
 * signed silently.
 *
 * Use this to grant zero-popup signing to a contract that was *not* the one
 * passed to `connect({ contractId })` at sign-in time. For example, if your
 * page signs in for one contract but also wants silent draws on another,
 * call this after `onConnect` fires.
 *
 * Routes to the per-network session matching `params.network` (or the active
 * network when omitted). Requires a connected wallet on that network.
 */
export async function addFunctionCallKey(params: {
  contractId: string;
  methodNames?: string[];
  allowance?: string;
  network?: Network;
  signerId?: string;
}): Promise<{ publicKey: string; transactionOutcome: any }> {
  const network = params.network ?? activeNetwork;
  const state = networkStates[network];
  if (!state.connectedWallet) {
    throw new Error(`No wallet connected on ${network}. Call connect({ network: "${network}" }) first.`);
  }
  const wallet: any = state.connectedWallet;
  if (typeof wallet.addFunctionCallKey !== "function") {
    throw new Error("Connected wallet does not support addFunctionCallKey");
  }
  const signerId = params.signerId ?? state.currentAccountId ?? undefined;
  if (!signerId) throw new Error("No signer account id available");
  return wallet.addFunctionCallKey({
    contractId: params.contractId,
    methodNames: params.methodNames ?? [],
    allowance: params.allowance,
    network,
    signerId,
  });
}

/**
 * Switch the connector to a different network.
 *
 * Note: with per-network state this is no longer required for typical use —
 * just call `connect({ network })` / `restore({ network })` / `accountId({ network })`
 * directly. Kept for backwards compatibility; uses the connector for the
 * active network (or the network in `signInData.network` if provided).
 */
export async function switchNetwork(
  network: Network,
  signInData?: { contractId?: string; methodNames?: string[] }
): Promise<void> {
  const state = networkStates[activeNetwork];
  if (!state.connector) throw new Error("No connector initialized. Call connect() or restore() first.");
  return state.connector.switchNetwork(network, signInData);
}

/**
 * Show the wallet picker popup and connect.
 * Returns the connected account info.
 * If walletId is provided, connects directly to that wallet without showing the picker.
 *
 * Pass `{ network: "testnet" }` to connect on testnet without affecting an
 * existing mainnet session.
 */
export async function connect(
  options?: ConnectOptions & { walletId?: string }
): Promise<ConnectResult | null> {
  const network = resolveNetwork(options);
  const state = networkStates[network];
  const c = getOrCreateConnector(options);
  let wallet;
  try {
    wallet = await c.connect({ walletId: options?.walletId });
  } catch (_) {
    // User closed the modal or wallet rejected
    return null;
  }
  state.connectedWallet = wallet;
  activeNetwork = network;

  // Account info is set by the wallet:signIn event handler,
  // but if it hasn't fired yet, try to get it from the connector.
  if (!state.currentAccountId) {
    try {
      const info = await c.getConnectedWallet();
      if (info?.accounts?.length) {
        state.currentAccountId = info.accounts[0].accountId;
      }
    } catch (_) {
      // ignore
    }
  }

  return {
    accountId: state.currentAccountId ?? "",
    publicKey: undefined,
    network,
  };
}

/**
 * Disconnect a wallet session. Without arguments, disconnects the active
 * network's session. Pass `{ network }` to disconnect a specific network.
 */
export async function disconnect(options?: { network?: Network }): Promise<void> {
  const network = options?.network ?? activeNetwork;
  const state = networkStates[network];
  if (state.connector) {
    await state.connector.disconnect(state.connectedWallet ?? undefined);
  }
  state.connectedWallet = null;
  state.currentAccountId = null;
}

/**
 * Sign and send a single transaction via the connected wallet.
 * Accepts both fastnear-style flat actions and @hot-labs/near-connect ConnectorActions.
 *
 * Routes to the per-network session matching `params.network` if specified
 * (or `activeNetwork` otherwise).
 */
export async function sendTransaction(
  params: (SignAndSendTransactionParams | { receiverId: string; actions: any[]; signerId?: string }) & { network?: Network }
): Promise<any> {
  const network = params.network ?? activeNetwork;
  const state = networkStates[network];
  if (!state.connectedWallet) {
    throw new Error(`No wallet connected on ${network}. Call connect({ network: "${network}" }) first.`);
  }
  const actions = params.actions.some(isFastnearAction)
    ? toConnectorActions(params.actions)
    : params.actions;
  return state.connectedWallet.signAndSendTransaction({
    receiverId: params.receiverId,
    actions,
    signerId: params.signerId ?? state.currentAccountId ?? undefined,
    network,
  });
}

/**
 * Sign and send multiple transactions via the connected wallet.
 * Accepts both fastnear-style flat actions and @hot-labs/near-connect ConnectorActions.
 */
export async function sendTransactions(
  params: (SignAndSendTransactionsParams | { transactions: Array<{ receiverId: string; actions: any[] }>; signerId?: string }) & { network?: Network }
): Promise<any> {
  const network = params.network ?? activeNetwork;
  const state = networkStates[network];
  if (!state.connectedWallet) {
    throw new Error(`No wallet connected on ${network}. Call connect({ network: "${network}" }) first.`);
  }
  const transactions = ('transactions' in params ? params.transactions : []).map((tx: any) => ({
    receiverId: tx.receiverId,
    actions: tx.actions.some(isFastnearAction)
      ? toConnectorActions(tx.actions)
      : tx.actions,
  }));
  return state.connectedWallet.signAndSendTransactions({
    transactions,
    signerId: params.signerId ?? state.currentAccountId ?? undefined,
    network,
  });
}

/**
 * Sign a message (NEP-413) via the connected wallet.
 */
export async function signMessage(params: SignMessageParams & { network?: Network }): Promise<any> {
  const network = params.network ?? activeNetwork;
  const state = networkStates[network];
  if (!state.connectedWallet) {
    throw new Error(`No wallet connected on ${network}. Call connect({ network: "${network}" }) first.`);
  }
  return state.connectedWallet.signMessage({ ...params, network });
}

/**
 * Sign delegate actions (NEP-366) via the connected wallet.
 * Accepts both fastnear-style flat actions and ConnectorActions.
 */
export async function signDelegateActions(
  params: SignDelegateActionsParams & { network?: Network }
): Promise<SignDelegateActionsResponse> {
  const network = params.network ?? activeNetwork;
  const state = networkStates[network];
  if (!state.connectedWallet) {
    throw new Error(`No wallet connected on ${network}. Call connect({ network: "${network}" }) first.`);
  }
  const wallet: any = state.connectedWallet;
  if (typeof wallet.signDelegateActions !== "function") {
    throw new Error("Connected wallet does not support signDelegateActions");
  }
  const delegateActions = params.delegateActions.map((da: any) => ({
    receiverId: da.receiverId,
    actions: da.actions.some(isFastnearAction)
      ? toConnectorActions(da.actions)
      : da.actions,
  }));
  return wallet.signDelegateActions({
    delegateActions,
    signerId: params.signerId ?? state.currentAccountId ?? undefined,
    network,
  });
}

/**
 * Get the connected account id for a specific network (or the active one).
 */
export function accountId(opts?: { network?: Network }): string | null {
  return stateFor(opts?.network).currentAccountId;
}

/**
 * Check whether a wallet is currently connected for a specific network
 * (or the active one).
 */
export function isConnected(opts?: { network?: Network }): boolean {
  const s = stateFor(opts?.network);
  return s.currentAccountId !== null && s.connectedWallet !== null;
}

/**
 * Return whichever networks currently have an active session. Useful for UIs
 * that want to surface "signed in to mainnet AND testnet".
 */
export function connectedNetworks(): Network[] {
  return NETWORKS.filter((n) => isConnected({ network: n }));
}

/**
 * Network of the most recent connect/restore. Single-session callers can
 * treat this as "the network".
 */
export function getActiveNetwork(): Network {
  return activeNetwork;
}

/**
 * Get the name of the connected wallet (e.g. "MyNearWallet") for a given
 * network or the active one.
 */
export function walletName(opts?: { network?: Network }): string | null {
  const s = stateFor(opts?.network);
  if (!s.connectedWallet) return null;
  return (s.connectedWallet as NearWalletBase & { metadata?: { name?: string } }).metadata?.name ?? null;
}

/**
 * Destroy the connector(s) so the next connect()/restore() creates fresh ones
 * with fresh options. Pass `{ network }` to reset only one network's state;
 * without arguments, both networks are reset.
 */
export function reset(opts?: { network?: Network }): void {
  const targets: Network[] = opts?.network ? [opts.network] : Array.from(NETWORKS);
  for (const n of targets) {
    networkStates[n] = { connector: null, connectedWallet: null, currentAccountId: null };
  }
  if (!opts?.network) activeNetwork = "mainnet";
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
