# @fastnear/wallet

Multi-wallet connector for NEAR dApps. Supports MyNearWallet, HOT Wallet, Meteor, NEAR Mobile, WalletConnect, and more via [`@fastnear/near-connect`](https://www.npmjs.com/package/@fastnear/near-connect).

## Install

```bash
npm install @fastnear/wallet
```

## Usage

```js
import { connect, disconnect, sendTransaction, accountId } from "@fastnear/wallet";

// Show wallet picker and connect
const result = await connect({ network: "mainnet" });
console.log("Connected:", result.accountId);

// Send a transaction
await sendTransaction({
  receiverId: "wrap.near",
  actions: [
    { type: "FunctionCall", methodName: "near_deposit", args: {}, gas: "30000000000000", deposit: "1000000000000000000000000" }
  ],
});

// Disconnect
await disconnect();
```

## Restore session

```js
import { restore } from "@fastnear/wallet";

// On page load, restore a previously connected wallet session
const result = await restore();
if (result) {
  console.log("Restored session:", result.accountId);
}
```

## Browser (IIFE)

```html
<script src="https://cdn.jsdelivr.net/npm/@fastnear/wallet/dist/umd/browser.global.js"></script>
<script>
  // Available as window.nearWallet
  // Auto-wires with @fastnear/api if loaded
  nearWallet.connect({ network: "mainnet" });
</script>
```

WalletConnect support is excluded from the IIFE bundle to keep it small (~100 KB). Load `@walletconnect/sign-client` separately if needed.

## Part of the FastNear JS monorepo

See the [project-level README](https://github.com/fastnear/js-monorepo) for more info.
