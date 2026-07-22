# @fastnear/intents mainnet QA runbook

NEAR Intents has no meaningful public testnet deployment — the verifier,
1Click API, solver relay, and bridges run on mainnet. QA therefore has two
tiers: a free tier that runs everywhere, and a funded tier that moves a small
amount of real tokens and is run manually before releases.

## Tier 1 — free (run always)

```sh
yarn build
node scripts/smoke-intents-dry.mjs
```

Covers, with zero credentials and zero funds:

- local NEP-413 signing round-trip — the assembled MultiPayload verifies
  against `@fastnear/utils` `verifyNep413Signature` (the same bytes
  `intents.near` checks)
- live `GET /v0/tokens` — asset list non-empty, `nep141:wrap.near` present
- live `POST /v0/quote` with `dry: true` — real pricing, no deposit address,
  no commitment
- solver relay reachability (keyless quotes may be empty — expected; the
  relay wants a partner API key)

`--offline` skips the network probes (unit-test-only environments).

## Tier 2 — funded micro swap (manual, pre-release)

Spends real tokens (default 0.05 wNEAR → USDC on NEAR, plus gas and the
0.2% keyless 1Click fee). Requires a funded mainnet account whose
full-access key you are willing to use from a shell.

```sh
export NEAR_INTENTS_SMOKE_ACCOUNT_ID=you.near
export NEAR_INTENTS_SMOKE_PRIVATE_KEY=ed25519:...
# optional: NEAR_INTENTS_SMOKE_AMOUNT (yocto-wNEAR), NEAR_INTENTS_SMOKE_ONE_CLICK_KEY

node scripts/smoke-intents-mainnet.mjs            # read-only preflight
node scripts/smoke-intents-mainnet.mjs --execute  # the real swap
```

The preflight (default) verifies on-chain that the key is FullAccess, reads
the wNEAR balance, and prices the swap with a dry quote — nothing moves.
`--execute` wraps NEAR if the wNEAR balance is short, commits the quote,
sends the deposit (`ft_transfer` of wNEAR to the quoted deposit address),
reports the tx hash to 1Click, and polls `/v0/status` to a terminal state.
Exit 0 requires `SUCCESS`; `REFUNDED`/`FAILED` exit 1 with the swap details.

Record each release-gating run here:

| Date | Package version | Account | Amount | Result | Notes |
|------|-----------------|---------|--------|--------|-------|
| 2026-07-22 | 1.6.0 | mike.near | 0.05 wNEAR → 0.093389 USDC | SUCCESS | intent `DBcSo8Cx7wqUF6QoeK4HpFXADX9V7M9RpbvDj2iG8Qoy`; deposit tx `8fWAQiaTKhRSx5fMhuUcGf8ZLs9t53fknNhVziTLKcY4`; settlement `6ZKK34vbT9gbbKr1ugYyQj9Qv7pmTpuVwHZW7P78rU8a`; keyless (0.2% fee); required storage-registering the deposit address on wrap.near first |

## Known live-surface caveats

- Keyless 1Click quotes carry a 0.2% platform fee; a partner API key
  (https://partners.near-intents.org/) waives it.
- The solver relay returns no quotes without an API key (verified
  2026-07-22 by the dry smoke); relay-path QA needs partner credentials.
- Deposit addresses expire (`timeWhenInactive`) — the funded smoke commits
  its quote immediately before depositing.
- NEAR-chain deposit addresses are fresh implicit accounts with NO storage
  registration on the token contract — an unregistered `ft_transfer` reverts
  on-chain (verified 2026-07-22). The smoke storage-registers the address
  (~0.00125 NEAR) before transferring; integrators sending NEP-141 deposits
  from NEAR must do the same.
