# fastintear

> [!WARNING]
> This package is an experimental fork of [@fastnear/js-monorepo](https://github.com/fastnear/js-monorepo) that has some minor package improvements (will make their way upstream) and exclusively uses [INTEAR Wallet](https://github.com/INTEARnear/wallet).

```typescript
import * as near from "fastintear";

near.config({ networkId: "mainnet" });

near.requestSignIn();

near.signMessage(...);

near.sendTx(...);

near.signOut();
```

## general

This is a workspace package from the [@fastnear/js-monorepo](https://github.com/fastnear/js-monorepo) that has the primary responsibility. It's what creates the global `near` object.

## technical

### Node.js decoupling

This library surgically removed ties to Node.js, replacing them with CommonJS and/or modern APIs available in browsers.

For instance `Buffer.from()` is an example of a Node.js feature that is commonly used in libraries doing binary encoding, cryptographic operations, and so on. There exists alternative with `Uint8Array` and `TextEncoder` to fill in pieces. This subject could be quite lengthy, and I mention a couple examples just to set the scene.

So it *is* possible to have a web3 library that's decoupled from Node.js

### what this means

Some emergent behavior comes as a result of this.

  - ability to run code in browser's dev console
  - ability to create web3 projects entirely with static html

### `near` global

In `tsup.config.ts`, you find TypeScript compilations targets. We feel preferential towards the IIFE version. ([MDN docs on IIFE](https://developer.mozilla.org/en-US/docs/Glossary/IIFE)) That file utilizes `esbuild`'s `banner` and `footer` to inject JavaScript that utilizes `Object.defineProperty` in a way to make it "not [configurable](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty#configurable)."

If you look in the `dist` directory under `umd` (Universal Module Definition, but it seems IIFE fits better as a term) there is one file. At the bottom of the file you'll see how the global `near` object can undergo some modifications, potentially hardening it further as this library develops.

## alpha version

The focus thus far has been of a highly technical nature, and after releasing this alpha version the devs will let their minds gestate. then this file will fill out with more meaningful info and snippets. 🙏🏼

Make sure to visit the [project-level README](https://github.com/fastnear/js-monorepo#global-near-js)
