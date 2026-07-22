# `@fastnear/intents`

NEAR Intents (the multichain intent protocol settled by the
[`intents.near`](https://docs.near-intents.org/integration/verifier-contract/introduction.md)
verifier) for end users and AI agents: a zero-dependency typed client for the
hosted [1Click swap API](https://docs.near-intents.org/integration/distribution-channels/1click-api),
NEP-413 intent signing with either a connected FastNEAR wallet or a raw
server-side key, deposit/withdraw/balance helpers for the verifier itself, and
a JSON-RPC client for the solver relay.

Ships as ESM + CJS + a browser IIFE global (`nearIntents`). The browser entry
never touches private keys — local-key signing lives in
`@fastnear/intents/node`.

## Install

```sh
npm install @fastnear/intents
```

Browser (IIFE globals):

```html
<script src="https://js.fastnear.com/wallet.js"></script>
<script src="https://js.fastnear.com/intents.js"></script>
```

## Quote and track a swap (1Click)

Works unauthenticated out of the box — quotes then carry a 0.2% platform fee.
An API key from [partners.near-intents.org](https://partners.near-intents.org/)
waives it.

```js
import { createOneClickClient } from "@fastnear/intents";

const oneClick = createOneClickClient({ apiKey: process.env.ONE_CLICK_API_KEY });

// 1. Discover assets — each entry's assetId is used everywhere else.
const tokens = await oneClick.tokens();

// 2. Preview pricing with dry:true (free, no commitment), then commit with
//    dry:false to receive the depositAddress that drives the swap.
const quote = await oneClick.quote({
  dry: false,
  swapType: "EXACT_INPUT",
  slippageTolerance: 100, // bps
  originAsset: "nep141:wrap.near",
  destinationAsset: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near",
  amount: "1000000000000000000000000",
  depositType: "ORIGIN_CHAIN",
  refundTo: "alice.near",
  refundType: "ORIGIN_CHAIN",
  recipient: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D",
  recipientType: "DESTINATION_CHAIN",
  deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
});

// 3. Send the input tokens to quote.quote.depositAddress (see deposits below),
//    then poll until SUCCESS | REFUNDED | FAILED.
const status = await oneClick.status({
  depositAddress: quote.quote.depositAddress,
});
```

## Sign intents with a wallet (browser)

NEP-413 requires a **full-access key**, so wallets sign with the account's own
key — FunctionCall-access session keys cannot authorize intents. Wallets
return the signature as base64; the signer re-encodes it to the
`ed25519:<base58>` form the verifier expects.

```js
import { createWalletIntentSigner } from "@fastnear/intents";
// window.nearWallet from https://js.fastnear.com/wallet.js, already connected.

const signer = createWalletIntentSigner({ wallet: nearWallet });

const signed = await signer.signIntents({
  intents: [
    {
      intent: "token_diff",
      diff: {
        "nep141:usdc.near": "-1000000",
        "nep141:usdt.near": "1000000",
      },
    },
  ],
});
// -> { standard: "nep413", payload: {...}, public_key, signature } — ready for
//    oneClick.submitIntent, relay.publishIntent, or intents.near execute_intents.
```

## Sign intents with a raw key (Node / agents)

```js
import { createOneClickClient } from "@fastnear/intents";
import { createLocalIntentSigner } from "@fastnear/intents/node";

const signer = createLocalIntentSigner({
  accountId: process.env.NEAR_ACCOUNT_ID,
  privateKey: process.env.NEAR_PRIVATE_KEY, // full-access, server-side only
});

// INTENTS deposit type: balances already inside intents.near swap without a
// new on-chain transaction — 1Click builds the payload, you sign and submit.
const oneClick = createOneClickClient();
const quote = await oneClick.quote({
  dry: false,
  swapType: "EXACT_INPUT",
  slippageTolerance: 100,
  originAsset: "nep141:wrap.near",
  destinationAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  amount: "1000000000000000000000000",
  depositType: "INTENTS", // input funds already sit inside intents.near
  refundTo: process.env.NEAR_ACCOUNT_ID,
  refundType: "INTENTS",
  recipient: process.env.NEAR_ACCOUNT_ID,
  recipientType: "INTENTS",
  deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
});
const { intent } = await oneClick.generateIntent({
  signerId: process.env.NEAR_ACCOUNT_ID,
  depositAddress: quote.quote.depositAddress,
});
// The server chose the message, nonce, and recipient. signPayload pins the
// recipient to intents.near and signs the payload verbatim.
const signed = await signer.signPayload(intent);
const { intentHash } = await oneClick.submitIntent({ signedData: signed });
```

## Deposits, balances, and withdrawals (verifier)

Helpers return plain FastNEAR action shapes — pass them to `near.sendTx` or
`nearWallet.sendTransaction`. Native NEAR must be wrapped first; balances
inside the verifier are NEP-245 multi-token entries keyed like
`nep141:<contract>`.

```js
import {
  ftDepositAction,
  wrapNearAction,
  ftWithdrawAction,
  mtBatchBalances,
} from "@fastnear/intents";

// Wrap native NEAR, then deposit the wNEAR into intents.near.
await near.sendTx({
  receiverId: "wrap.near",
  actions: [wrapNearAction({ amountYocto: "1000000000000000000000000" })],
});
await near.sendTx({
  receiverId: "wrap.near",
  actions: [ftDepositAction({ amount: "1000000000000000000000000" })],
});

// Internal balances (injected view keeps this package api-free).
const balances = await mtBatchBalances({
  accountId: "alice.near",
  tokenIds: ["nep141:wrap.near", "nep141:usdc.near"],
  view: near.view,
});

// Withdraw back out (plain token id, no nep141: prefix; refundable when msg
// is omitted).
await near.sendTx({
  receiverId: "intents.near",
  actions: [
    ftWithdrawAction({
      token: "wrap.near",
      receiverId: "alice.near",
      amount: balances["nep141:wrap.near"],
    }),
  ],
});
```

## Solver relay (direct flows)

The relay brokers quotes between users and solvers and submits matched intent
bundles to the verifier. It is the lower-level alternative to 1Click; relay
API keys come from the partner dashboard.

```js
import { createSolverRelayClient } from "@fastnear/intents/relay";

const relay = createSolverRelayClient({ apiKey: process.env.RELAY_API_KEY });

const quotes = await relay.quote({
  defuse_asset_identifier_in: "nep141:usdc.near",
  defuse_asset_identifier_out: "nep141:usdt.near",
  exact_amount_in: "1000000",
});

const best = quotes?.[0];
const signed = await signer.signIntents({
  intents: [
    {
      intent: "token_diff",
      diff: {
        "nep141:usdc.near": `-${best.amount_in}`,
        "nep141:usdt.near": best.amount_out,
      },
    },
  ],
  deadline: best.expiration_time,
});

const { intent_hash } = await relay.publishIntent({
  signedData: signed,
  quoteHashes: [best.quote_hash],
});
// Poll: PENDING -> TX_BROADCASTED -> SETTLED
const status = await relay.getStatus({ intentHash: intent_hash });
```

## Protocol constraints

- Only `intents.near` on NEAR mainnet; there is no meaningful public testnet
  deployment of the intents stack.
- NEP-413 signatures require a full-access key. The verifier additionally
  checks the key is authorized for the `signer_id` (registered with
  `add_public_key`, or matching an implicit account).
- Signature encoding is `ed25519:<base58>` — NOT the base64 wallets return.
  The signers in this package own that conversion.
- Native NEAR is not a verifier asset: wrap to wNEAR on deposit; the
  `native_withdraw` intent is the only native exit.
- Amounts are base-unit strings everywhere; `token_diff` diffs must net to
  zero per token across the executed batch (a solver signs the mirror diff).
- Unauthenticated 1Click use adds a 0.2% platform fee to quotes.

## Entrypoints

- `@fastnear/intents` — types, 1Click client, wallet signer, verifier
  helpers, solver relay re-export (browser-safe; global `nearIntents`)
- `@fastnear/intents/relay` — solver relay JSON-RPC client
- `@fastnear/intents/node` — local full-access-key signer (server-side only)

## Release gate

Run the [mainnet QA runbook](./MAINNET_QA.md) before releasing: the free
dry smoke (`node scripts/smoke-intents-dry.mjs`) always, and the env-gated
funded micro swap (`scripts/smoke-intents-mainnet.mjs`) per release.

## Upstream

- Docs: https://docs.near-intents.org
- Verifier source: https://github.com/near/intents
- 1Click OpenAPI: https://1click.chaindefuser.com/docs/v0/openapi.yaml
