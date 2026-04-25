# 1.1.1

- Metadata-only release that lifts every workspace package to the same
  monorepo version. No `@fastnear/wallet` source changes — the published
  bundle is byte-identical to 1.1.0.
- Recipe catalog (hosted at `js.fastnear.com/recipes.json`) gained a
  `connect-testnet` recipe that demonstrates the 1.1.0 per-network
  `nearWallet.connect({ network })` surface and `connectedNetworks()`
  helper. Documented seam: `near.recipes.connect` (in `@fastnear/api`)
  still reads the network from `near.config().networkId` rather than
  forwarding a per-call override; closing this would be a small future
  `@fastnear/api` patch.

# 1.1.0

- **Parallel mainnet + testnet sessions.** Internal state (connector,
  connected wallet, current account id) is now keyed by network, so a page
  can hold simultaneous sessions on both networks. Signing in on testnet no
  longer evicts a mainnet session.
- **Optional `network` argument** on `accountId()`, `isConnected()`,
  `walletName()`, `sendTransaction()`, `sendTransactions()`, `signMessage()`,
  `disconnect()`, and `reset()`. Without the argument, calls operate on the
  *active* network — the most recent successful `connect()` / `restore()` —
  so existing single-session callers don't need to change.
- **`connect({ network })` / `restore({ network })`** route to the per-
  network slot. Calling `connect({ network: "testnet" })` while a mainnet
  session is already active just opens a new testnet session alongside it.
- **`ConnectResult.network`** added (non-breaking).
- New helpers `connectedNetworks()` (returns the networks with an active
  session) and `getActiveNetwork()`.
- Requires `@fastnear/near-connect@^0.12.0`. The underlying library handles
  per-network storage namespacing; legacy unscoped keys are migrated to the
  mainnet slot on first load.

# 1.0.2

- Initial public release of the rewritten connector.
