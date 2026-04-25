# 1.1.1

## Per-network parameter on wallet wrappers

- `requestSignIn` and `signOut` now accept an optional
  `network: "mainnet" | "testnet"`. When set, the call routes to the
  underlying `provider.{ connect, disconnect, isConnected }` with the
  same network override, opening or tearing down a session on that
  network without disturbing the other. When omitted, behavior is
  unchanged — falls back to `near.config().networkId`.
- `RecipeConnectParams.network` added (matches the new
  `requestSignIn` parameter), so `near.recipes.connect({ network })`
  now does what it looks like it does. Previously the field was
  silently ignored.
- `requestSignIn` now returns the `{ accountId, network? }` result
  from the wallet provider (or `undefined` when the user rejects).
  Earlier versions returned `void`. Existing callers that don't read
  the return value are unaffected.
- `signOut({ network })` only resets api-level global state when the
  network being signed out is the *active* one (matches
  `near.config().networkId`). Signing out a non-active network now
  leaves `_state.accountId` and the active config intact, so a
  parallel mainnet session survives a testnet sign-out.
- `WalletProvider` interface in `state.ts` extended: `disconnect` and
  `isConnected` accept optional `{ network }`. Existing wallet
  implementations whose methods take no args still satisfy the
  interface (the args are optional and ignored if unused).

## Recipe catalog v4

- Recipe catalog at `js.fastnear.com/recipes.json` upgraded to v4 with
  seven new entries that exercise the 1.1.0 `near.ft.*`, `near.nft.*`,
  and `useArchival` surfaces (`ft-balance`, `ft-metadata`, `ft-inventory`,
  `nft-for-owner`, `nft-inventory`, `archival-snapshot`,
  `connect-testnet`). The catalog is hosted, not bundled, so it reaches
  consumers without needing a re-install.

## Out of scope (acknowledged)

- `sendTx` and `signMessage` still consult `_state.accountId` (a
  single global) rather than a per-network account map. Callers that
  need network-specific signing today should reach for
  `nearWallet.sendTransaction({ network })` and
  `nearWallet.signMessage({ network })` directly. Closing this needs a
  per-network state restructure in api and is queued for a later round.

# 1.1.0

## Archival opt-in

- New `services.archival` slot in `FastNearServicesConfig` and the per-network
  defaults in `NETWORKS` (`packages/api/src/state.ts`). Mainnet and testnet
  default to NEAR's official archival endpoints
  (`archival-rpc.{mainnet,testnet}.near.org`). Override via
  `near.config({ services: { archival: { baseUrl: "…" } } })`.
- `near.view`, `near.queryAccount`, `near.queryBlock`, `near.queryAccessKey`,
  `near.queryTx`, and the lower-level `sendRpc` all accept an optional
  `useArchival: true` to route a single call to the archival RPC. Falls
  back to the regular RPC if archival isn't configured for the network —
  callers don't need to feature-detect.

```js
// historical balance:
await near.queryAccount({ accountId: "mike.near", blockId: 100_000_000, useArchival: true });
```

## NEP-141 / NEP-171 helpers

- New `near.ft.*` namespace: `balance`, `metadata`, `totalSupply`,
  `storageBalance`, `inventory` (latter served by the FastNear indexer).
- New `near.nft.*` namespace: `metadata`, `token`, `forOwner`,
  `supplyForOwner`, `totalSupply`, `tokens`, `inventory`.
- Each helper is a one-line wrapper around `view` (or the indexer for
  `inventory`) with the standard NEP method name pre-filled. All forward
  `blockId` and `useArchival`.

```js
await near.ft.balance({ contractId: "berryclub.ek.near", accountId: "mike.near" });
await near.nft.forOwner({ contractId: "x.paras.near", accountId: "mike.near", limit: 20 });
```

## Notes

- No breaking changes. Existing call sites work unchanged.

# 1.0.2

- Initial public release.
