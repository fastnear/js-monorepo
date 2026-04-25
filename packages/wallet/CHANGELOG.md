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
