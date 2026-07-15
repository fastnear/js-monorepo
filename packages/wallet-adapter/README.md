# @fastnear/wallet-adapter

Low-level wallet adapter implementations for [Meteor Wallet](https://meteorwallet.app/) and [NEAR Mobile](https://nearmobile.app/). Used internally by [`@fastnear/wallet`](https://www.npmjs.com/package/@fastnear/wallet) and [`@fastnear/near-connect`](https://www.npmjs.com/package/@fastnear/near-connect).

Most apps should use `@fastnear/wallet` directly rather than this package.

## Install

```bash
npm install @fastnear/wallet-adapter
```

## Usage

```js
import { createMeteorAdapter, createNearMobileAdapter } from "@fastnear/wallet-adapter";

const meteor = createMeteorAdapter({ network: "mainnet" });
const nearMobile = createNearMobileAdapter({ network: "mainnet" });
```

## Meteor delegate signing

The Meteor adapter exposes its wallet-backed `sign_delegate_actions` transport.
It never signs locally: Meteor replaces the placeholder access key and nonce,
shows the request to the user, and returns the signed NEP-366 delegate.

```js
const result = await meteor.signDelegateActions({
  network: "testnet",
  signerId: "payer.testnet",
  delegateActions: [{
    receiverId: "usdc.fakes.testnet",
    blockHeightTtl: 300,
    actions: [{
      type: "FunctionCall",
      params: {
        methodName: "ft_transfer",
        args: { receiver_id: "merchant.testnet", amount: "10000" },
        gas: "30000000000000",
        deposit: "1",
      },
    }],
  }],
});
```

`blockHeightTtl` is measured from the final RPC block and must be a positive
safe integer. Omitting it retains Meteor's legacy 200-block default. The
near-connect Meteor executor and manifest must expose the corresponding
delegate-signing capability before applications can reach this through
`@fastnear/wallet`.

## Part of the FastNear JS monorepo

See the [project-level README](https://github.com/fastnear/js-monorepo) for more info.
