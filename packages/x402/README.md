# `@fastnear/x402`

Adapters for using the official [`@x402/near`](https://www.npmjs.com/package/@x402/near) exact-payment mechanism with FastNEAR wallets, paid HTTP clients, resource servers, and facilitators.

This package does not implement a second x402 wire format. It uses x402 v2, NEP-366 signed delegate actions, and the Foundation's NEAR verifier and settlement code.

> **Browser-wallet support:** the wallet path requires `@fastnear/near-connect@0.13.0` or later and a wallet that advertises both `signDelegateActions` and `signDelegateActionsWithTtl`. Meteor Wallet is the tested production wallet path for this release; additional wallets should pass the same guarded testnet harness before being documented as compatible.

## Install

For local-key, resource-server, or facilitator use:

```bash
npm install @fastnear/x402
```

For the browser-wallet client:

```bash
npm install @fastnear/x402 @fastnear/wallet
```

Choose the smallest entrypoint for the job:

| Task | Imports | Main factory | Status |
|---|---|---|---|
| Pay a URL from Node.js | `@fastnear/x402`, `@fastnear/x402/node` | `createNearPaymentFetch` | Stable |
| Pay from a browser wallet | `@fastnear/x402`, `@fastnear/wallet` | `createFastNearWalletSigner` + `createNearPaymentFetch` | Stable with a compatible timeout-aware wallet |
| Protect a seller resource | `@fastnear/x402/server` | `createNearResourceServer` | Explicit facilitator required |
| Operate a facilitator | `@fastnear/x402/facilitator` | `createNearFacilitator` | Bring your own HTTP framework |

`createNearX402Client` is the lower-level client factory for custom integrations. x402 is package-only: it is not exposed as `near.x402` or `near.recipes.x402` by `near.js` or `agents.js`.

Install the HTTP framework adapter separately on the resource-server or facilitator host, for example `@x402/express` and `express`. This package deliberately does not choose a web framework.

## Browser wallet and paid fetch

Wallet access is injected explicitly. Importing `@fastnear/x402` never opens a wallet, signs a payment, or performs a fetch.

```js
import * as nearWallet from "@fastnear/wallet";
import {
  createFastNearWalletSigner,
  createNearPaymentFetch,
} from "@fastnear/x402";

const connection = await nearWallet.connect({
  network: "testnet",
  features: {
    signDelegateActions: true,
    signDelegateActionsWithTtl: true,
  },
});

if (!connection) throw new Error("No compatible wallet was connected");

const signer = createFastNearWalletSigner({ wallet: nearWallet });
const paidFetch = createNearPaymentFetch({
  signer,
  network: "near:testnet",
});

// Call only in response to an explicit user action. A 402 challenge can open
// the wallet for approval and then retry with the signed payment header.
const response = await paidFetch("https://seller.example/protected");
if (!response.ok) throw new Error(`Request failed: ${response.status}`);
console.log(await response.json());
```

Use `network: "near:*"` (the default) when the client should accept either canonical NEAR network. Use a concrete network to refuse challenges from the other network.

### Browser script

The IIFE bundle exports `window.nearX402`. Pin exact released versions for production use.

```html
<script src="https://cdn.jsdelivr.net/npm/@fastnear/wallet@2.0.0/dist/umd/browser.global.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@fastnear/x402@2.0.0/dist/umd/browser.global.js"></script>
<script>
  async function payAfterClick(url) {
    const connection = await nearWallet.connect({
      network: "testnet",
      features: {
        signDelegateActions: true,
        signDelegateActionsWithTtl: true,
      },
    });
    if (!connection) throw new Error("No compatible wallet was connected");

    const signer = nearX402.createFastNearWalletSigner({ wallet: nearWallet });
    const paidFetch = nearX402.createNearPaymentFetch({
      signer,
      network: "near:testnet",
    });
    return paidFetch(url);
  }
</script>
```

## Node.js local-key client

`@fastnear/x402/node` reuses the official reference signer. The secret key must be a full-access key for `accountId`; function-call keys cannot authorize the delegated token transfer.

```js
import { createNearPaymentFetch } from "@fastnear/x402";
import { createLocalNearSigner } from "@fastnear/x402/node";

const signer = createLocalNearSigner({
  accountId: process.env.NEAR_PAYER_ACCOUNT_ID,
  secretKey: process.env.NEAR_PAYER_SECRET_KEY,
  rpcUrls: {
    "near:testnet": "https://rpc.testnet.fastnear.com",
  },
});

const paidFetch = createNearPaymentFetch({
  signer,
  network: "near:testnet",
});

const response = await paidFetch("https://seller.example/protected");
if (!response.ok) throw new Error(`Paid request failed: ${response.status}`);
console.log(await response.json());
```

Keep the payer key in server-side secret storage. Never embed it in browser JavaScript.

## Resource server with an explicit facilitator

`createNearResourceServer` requires at least one facilitator client or URL. There is no implicit x402.org or other default. Confirm that a remote facilitator advertises `exact` on the intended NEAR network before relying on it; the current provider list is maintained in the [x402 facilitator directory](https://docs.x402.org/dev-tools/facilitators).

```js
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { createNearResourceServer } from "@fastnear/x402/server";

const { X402_FACILITATOR_URL, NEAR_PAYMENT_ACCOUNT_ID } = process.env;
if (!X402_FACILITATOR_URL || !NEAR_PAYMENT_ACCOUNT_ID) {
  throw new Error("X402_FACILITATOR_URL and NEAR_PAYMENT_ACCOUNT_ID are required");
}

const resourceServer = createNearResourceServer({
  facilitators: { url: X402_FACILITATOR_URL },
});

const app = express();
app.use(paymentMiddleware({
  "GET /weather": {
    accepts: [{
      scheme: "exact",
      network: "near:testnet",
      price: "$0.01",
      payTo: NEAR_PAYMENT_ACCOUNT_ID,
    }],
    description: "Testnet weather report",
    mimeType: "application/json",
  },
}, resourceServer));

app.get("/weather", (_request, response) => {
  response.json({ weather: "sunny" });
});

app.listen(4021);
```

String/number money prices use the official Circle USDC contract for the selected network. To name another NEP-141 token explicitly, use `{ amount: "<smallest-unit amount>", asset: "<token account>" }` as the price. You can also pass `moneyParsers` to centralize custom denomination rules.

For example, price a route in wrapped NEAR by supplying the network's canonical wNEAR token account explicitly; `0.01` wNEAR is `10000000000000000000000` atomic units for a 24-decimal token:

```js
price: {
  amount: "10000000000000000000000",
  asset: process.env.WNEAR_TOKEN_ACCOUNT_ID,
}
```

Treat the token account as deployment configuration and verify it for the selected network rather than copying an unverified contract ID.

For an authenticated remote facilitator, pass `createAuthHeaders` beside `url`; it must return header objects for `verify`, `settle`, and `supported`.

## Self-hosted facilitator

The facilitator owns relayer accounts that pay transaction gas and the required yoctoNEAR deposit. Relayer keys are full-access secrets and must never be exposed to clients.

```js
import express from "express";
import { createNearFacilitator } from "@fastnear/x402/facilitator";

const { NEAR_RELAYER_ACCOUNT_ID, NEAR_RELAYER_SECRET_KEY } = process.env;
if (!NEAR_RELAYER_ACCOUNT_ID || !NEAR_RELAYER_SECRET_KEY) {
  throw new Error("NEAR relayer credentials are required");
}

const facilitator = createNearFacilitator({
  registrations: [{
    network: "near:testnet",
    signer: {
      relayers: [{
        accountId: NEAR_RELAYER_ACCOUNT_ID,
        secretKey: NEAR_RELAYER_SECRET_KEY,
      }],
      rpcUrls: {
        "near:testnet": "https://rpc.testnet.fastnear.com",
      },
    },
  }],
});

const app = express();
app.use(express.json());

app.post("/verify", async (request, response, next) => {
  try {
    const { paymentPayload, paymentRequirements } = request.body;
    response.json(await facilitator.verify(paymentPayload, paymentRequirements));
  } catch (error) {
    next(error);
  }
});

app.post("/settle", async (request, response, next) => {
  try {
    const { paymentPayload, paymentRequirements } = request.body;
    response.json(await facilitator.settle(paymentPayload, paymentRequirements));
  } catch (error) {
    next(error);
  }
});

app.get("/supported", (_request, response) => {
  response.json(facilitator.getSupported());
});

app.listen(4022);
```

This is the minimum transport wiring, not a production deployment recipe. Validate request bodies and add authentication, rate limits, observability, durable operational controls, and secret management appropriate to the service.

When the seller and facilitator deliberately run in the same trusted process, no HTTP adapter is needed. The two FastNEAR factories compose directly:

```js
import { createNearFacilitator } from "@fastnear/x402/facilitator";
import { createNearResourceServer } from "@fastnear/x402/server";

const { NEAR_RELAYER_ACCOUNT_ID, NEAR_RELAYER_SECRET_KEY } = process.env;
if (!NEAR_RELAYER_ACCOUNT_ID || !NEAR_RELAYER_SECRET_KEY) {
  throw new Error("NEAR relayer credentials are required");
}

const facilitator = createNearFacilitator({
  registrations: [{
    network: "near:testnet",
    signer: {
      relayers: [{
        accountId: NEAR_RELAYER_ACCOUNT_ID,
        secretKey: NEAR_RELAYER_SECRET_KEY,
      }],
    },
  }],
});

const resourceServer = createNearResourceServer({
  facilitators: facilitator,
});

await resourceServer.initialize();
```

This is an in-process trust boundary: isolate the facilitator behind authenticated HTTP instead when relayer ownership, scaling, or operations belong to a separate service.

## Payment constraints

- Only x402 v2 `exact` payments on `near:mainnet` and `near:testnet` are accepted.
- Payments transfer NEP-141 fungible tokens. Native NEAR is not a direct payment asset; use an explicit wrapped-NEAR token contract when appropriate.
- The payer must have enough token balance, and the recipient (`payTo`) must already be registered for storage with the selected token contract.
- Wallet and local-key signers require a full-access key. The facilitator rejects function-call keys.
- The payer does not need NEAR for gas. The selected facilitator relayer sponsors the outer transaction gas and 1 yoctoNEAR attached to `ft_transfer`.
- Browser targets must allow the calling origin through CORS and expose the x402 payment response headers when the client needs to read them.

## Entrypoints

| Import | Purpose |
|---|---|
| `@fastnear/x402` | Wallet signer adapter, x402 client, and paid fetch |
| `@fastnear/x402/node` | Official RPC-backed local-key signer |
| `@fastnear/x402/server` | NEAR resource server with explicit facilitator configuration |
| `@fastnear/x402/facilitator` | Self-hostable NEAR facilitator registration |

## Release gate

The browser path was released in dependency order. FastNEAR `1.4.0` shipped the timeout-aware wallet prerequisite without `@fastnear/x402`; `@fastnear/near-connect@0.13.0` carries shared delegate-signing capability types and the Meteor bridge; FastNEAR `1.5.0` adds the stable `@fastnear/x402` package.

Stable release requires an automated local-key testnet flow, one real Meteor Wallet testnet settlement from `mike.testnet`, packed CJS/ESM subpath imports, bundle-budget checks, generated-agent consistency, and jsDelivr verification that the IIFE exposes the locked `nearX402` global. Other wallets are not release gates unless they are actively maintained, advertise `signDelegateActionsWithTtl`, and pass the same one-click settlement harness.

Repository maintainers should use the [guarded testnet QA guide](https://github.com/fastnear/js-monorepo/blob/main/packages/x402/TESTNET_QA.md) for the shared local-key and browser-wallet release harness.

## Upstream

- [`@x402/near` on npm](https://www.npmjs.com/package/@x402/near)
- [Merged NEAR mechanism contribution](https://github.com/x402-foundation/x402/pull/2663)
- [NEAR exact-scheme specification](https://github.com/x402-foundation/x402/blob/2aa22d3e6a38547a8232737599d9f519c9ac5533/specs/schemes/exact/scheme_exact_near.md)
