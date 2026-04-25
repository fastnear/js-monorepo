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
