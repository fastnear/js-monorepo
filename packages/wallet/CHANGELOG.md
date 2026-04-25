# 1.1.2

- Metadata-only release for `@fastnear/wallet` itself — no source
  changes. The bundle is byte-identical to 1.1.0/1.1.1.
- Pairs with `@fastnear/api@1.1.2`, which closes both seams left
  documented in 1.1.1: api now keeps a per-network account map and
  threads `network` through `sendTx`, `signMessage`, `accountId`,
  `publicKey`, `authStatus`, `selected`, and the recipe wrappers
  (`functionCall`, `transfer`, `signMessage`). The transport layer
  (`sendRpc`, `sendServiceRequest`) and every helper built on top of it
  (`view`, `queryAccount`, `queryBlock`, `queryAccessKey`, `queryTx`,
  `tx.*`, `api.v1.*`, `transfers.*`, `neardata.*`, `fastdata.kv.*`,
  `ft.*`, `nft.*`) accept the same `network` override. All of those
  calls resolve through the wallet's per-network slot — and the per-
  network RPC URL — the same way direct
  `nearWallet.sendTransaction({ network })` /
  `nearWallet.signMessage({ network })` calls do today.
- Recipe catalog (hosted at `js.fastnear.com/recipes.json`) gains a
  `function-call-testnet` recipe that demonstrates the closed loop:
  `near.recipes.connect({ network: "testnet" })` followed by
  `near.recipes.functionCall({ network: "testnet" })` without
  disturbing an active mainnet session.

# 1.1.1

- Metadata-only release for `@fastnear/wallet` itself — no source
  changes. The bundle is byte-identical to 1.1.0.
- Pairs with `@fastnear/api@1.1.1`, which closed the
  `near.recipes.connect({ network })` seam by threading the per-network
  parameter through to the wallet provider's `connect` /
  `disconnect` / `isConnected` calls. Pages using `near.recipes.connect`
  now hit the wallet's per-network code paths the same way direct
  `nearWallet.connect({ network })` calls do.
- Recipe catalog (hosted at `js.fastnear.com/recipes.json`) gained a
  `connect-testnet` recipe that demonstrates the per-network connect
  parameter and `connectedNetworks()` helper.

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
