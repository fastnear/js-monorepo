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

## Part of the FastNear JS monorepo

See the [project-level README](https://github.com/fastnear/js-monorepo) for more info.
