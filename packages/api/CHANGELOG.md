# 1.1.3

- Metadata-only release for `@fastnear/api` itself — no source changes.
  The bundle is byte-identical to 1.1.2.
- Released alongside `@fastnear/wallet@1.1.3`, which ships a fixed
  IIFE bundle that pins `@fastnear/near-connect@^0.12.0` (was `*` and
  was resolving to 0.11.2, missing the 1.1.x legacy localStorage
  migration). Versions across the monorepo are kept in lockstep.

# 1.1.2

## Per-network account state

- Internal account state is now keyed by network. `_state.accountId`,
  `_state.privateKey`, `_state.publicKey`, `_state.lastWalletId`, and
  `_state.accessKeyContractId` move from a single global slot into a
  `Record<"mainnet" | "testnet", AccountSlot>` map. This finishes the
  per-network alignment with `@fastnear/wallet@1.1.0+` that started in
  1.1.1 — the wallet had parallel sessions, but api still read account
  state from a single global. `sendTx`/`signMessage` on a non-active
  network now resolve through the right slot.
- Public API surfaces gain optional `{ network }` arguments —
  `accountId({ network })`, `publicKey({ network })`,
  `authStatus({ network })`, `selected({ network })`,
  `sendTx({ ..., network })`, `signMessage(msg, { network })`. Without
  the argument, calls operate on the active network (most-recent
  successful `requestSignIn` / `near.config({ networkId })`).
- `recipes.functionCall` and `recipes.transfer` accept `network`
  (forwarded to `sendTx`). `recipes.signMessage(message, { network })`
  accepts an optional second argument for the same purpose. The hosted
  recipe catalog at `js.fastnear.com/recipes.json` gains a
  `function-call-testnet` entry that demonstrates the closed loop:
  `near.recipes.connect({ network: "testnet" })` followed by
  `near.recipes.functionCall({ network: "testnet" })` without
  disturbing an active mainnet session.
- `signOut({ network })` now clears only that network's slot — parallel
  sessions on other networks survive untouched. `signOut()` (no arg)
  keeps the legacy reset-to-default shape so single-session callers
  are unaffected.
- `config({ networkId })` keeps per-network slots intact across
  switches (each network's account state survives) and pins the
  active-network cursor to the supplied id, even when `config.networkId`
  already matched. Block cache and tx history still clear on actual
  networkId flips because both are per-config rather than per-account.
- New helpers in the `state` namespace: `getActiveNetwork()`,
  `setActiveNetwork(network)`, `getAccountState({ network })`,
  `updateAccountState(partial, { network })`. The `state._state`
  namespace export is now a getter resolving to the active slot
  (previously a value-copy frozen at module load — could go stale once
  the active network changed).
- Legacy localStorage `state` blob is migrated to the mainnet slot on
  first load and the unscoped key cleared. Mirrors the wallet's 1.1.0
  legacy migration. New per-network keys are `state.mainnet` and
  `state.testnet`.

## Per-network RPC routing

- `sendRpc(method, params, { network })` now routes to the override
  network's `services.rpc.baseUrl` (or `services.archival.baseUrl` when
  `useArchival` is also set). `view`, `queryAccount`, `queryBlock`,
  `queryAccessKey`, `queryTx`, and `sendTxToRpc` all forward `network`.
- `tx.*`, `api.v1.*`, `transfers.*`, `neardata.*`, `fastdata.kv.*`,
  `ft.*`, and `nft.*` accept an optional `network`. The override's
  service URL is used for the request; the active config's `apiKey`
  still flows through unchanged.
- `sendTx`'s local-signing path is now fully per-network. The
  `nonce`/`block` localStorage caches move to `nonce.${network}` /
  `block.${network}` keys, and `queryAccessKey` / `queryBlock` /
  `sendTxToRpc` are called with the same network. The mismatch guard
  added earlier in 1.1.2 development is removed — `sendTx({ network })`
  now signs and broadcasts on the requested network without requiring
  `near.config({ networkId })` to match.
- Legacy unscoped `nonce` and `block` localStorage keys are migrated
  into the mainnet slot on first load and the unscoped keys cleared.
  Mirrors the `state` blob migration.

## Recipe discovery sync

- `near.recipes.list()` (and `.toJSON()`) now include the eight catalog
  entries that landed in 1.1.1 plus the new `function-call-testnet`
  recipe. The runtime list had drifted from `recipes/index.json` since
  1.1.1; the smoke at `scripts/smoke-agent-snippets.mjs` now flags any
  future drift.

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
