# CLAUDE.md

## Project overview

This is a Yarn Berry (v4) monorepo for `@fastnear/*` NPM packages — a TypeScript library for building on NEAR Protocol. Packages are in `packages/*`.

## Dependency management

- **Sibling workspace packages** must use `"workspace:*"` references, never pinned versions. Yarn resolves these at publish time.
- **Shared third-party dependencies** (e.g. `@noble/curves`, `@noble/hashes`, `base58-js`, `borsh`, `big.js`) should use `"*"` in workspace package manifests. The root `package.json` defines the actual version range, so it's managed in one place.
- After changing dependencies, run `yarn install` to update the lockfile, then `yarn build` to verify.

## Build

- `yarn build` builds all packages (CJS, ESM, IIFE/UMD, and DTS) via tsup/esbuild.
- `yarn type-check` runs tsc without emitting — use `yarn type-check && yarn build` during development.
- The IIFE build bundles all dependencies (unlike CJS/ESM which leave them external), so import resolution issues often surface only in the IIFE build.

## Publishing

- Bump the version in the root `package.json`, then run `yarn constraints --fix` to propagate to all workspace packages.
- Run `yarn build` after bumping (artifacts include version in comments).
- Publish all packages: `yarn workspaces foreach --all -ptv run publish --access public --tolerate-republish --otp <OTP>`
- OTP (2FA) is required for the `@fastnear` npm scope.

## Noble crypto libraries (@noble/curves, @noble/hashes)

- This project uses v2 of the noble libraries.
- v2 requires `.js` extensions on subpath imports: `@noble/curves/ed25519.js`, `@noble/hashes/sha2.js`.
- v2 removed `@noble/curves/abstract/utils` — the `Hex` type no longer exists.

## Package dependency graph

```
borsh-schema  (leaf — no workspace deps)
    │
    ├──▶ utils
    │       │
    │       └──▶ api ──▶ repl (CLI)
    │
    └──▶ wallet-adapter

wallet ──▶ @fastnear/near-connect (external, not in this repo)
```

`yarn build` uses topological order (`-t` flag in `yarn workspaces foreach`) so dependencies build first automatically.

## Package descriptions

| Package | IIFE Global | Role |
|---|---|---|
| `borsh-schema` | `NearBorshSchema` | Borsh schemas for NEAR transaction types |
| `utils` | `NearUtils` | Crypto (ed25519, sha256), encoding (base58/64/hex), unit conversion, storage abstraction (`lsGet`/`lsSet`), transaction serialization |
| `api` | `near` | User-facing API: RPC queries, transaction signing/sending, state management, event system, action builders |
| `wallet` | `nearWallet` | Multi-wallet connector wrapping `@fastnear/near-connect` |
| `wallet-adapter` | `nearWalletAdapters` | Low-level wallet implementations (Meteor, Near Mobile) |
| `repl` | _(CLI only)_ | Interactive REPL for exploring NEAR objects (`bin/repl.cjs`) |

## Build system details

Each buildable package has a `tsup.config.ts` producing three targets:

- **CJS** (`dist/cjs/`): `bundle: false`, dependencies stay as imports, resolved at runtime. Generates `.d.cts` types.
- **ESM** (`dist/esm/`): `bundle: false`, same as CJS but ES modules. Generates `.d.ts` types.
- **IIFE** (`dist/umd/`): `bundle: true`, all dependencies inlined into a single self-contained file. No types. Exposes a `globalName`. Entry is `src/index.ts` → output `dist/umd/browser.global.js`.

All builds: `sourcemap: true`, `minify: false`, `keepNames: true`. Banners include package name/version as comments.

Import resolution issues (e.g. package exports map mismatches) typically surface only in the IIFE build since it's the only one that resolves dependencies at build time.

`repl` has no tsup config — it's a pure Node.js CLI with `bin/repl.cjs`.

## IIFE globals and auto-wiring

Each IIFE footer uses `Object.defineProperty(globalThis, ...)` with `configurable: false` to lock the global.

**`@fastnear/api`** additionally:
- Sets `window.$$ = near.utils.convertUnit` as a convenience shorthand.
- Auto-calls `near.useWallet(globalThis.nearWallet)` if `nearWallet` is already loaded.

**`@fastnear/wallet`** additionally:
- Auto-calls `globalThis.near.useWallet(nearWallet)` if `near` is already loaded.

This means script load order doesn't matter — whichever loads second wires them together.

## Browser / static HTML consumption

Load via `<script>` tag (CDN or local path):
```html
<script src="https://cdn.jsdelivr.net/npm/@fastnear/api@VERSION/dist/umd/browser.global.js"></script>
```

After loading, `window.near` is available globally. Typical usage:
- `near.config(...)` — set network/RPC
- `near.view(...)` — read-only contract calls
- `near.sendTx(...)` — sign and send transactions
- `near.actions.functionCall(...)` — build action objects
- `near.event.onTx(...)` — listen for tx events

Examples live in `examples/static/` and `examples/dynamic/`.

## State management (api package)

- Centralized localStorage-backed state via `lsGet`/`lsSet` from `@fastnear/utils`.
- All keys prefixed with `__fastnear_` (defined as `LsPrefix` in `packages/utils/src/storage.ts`).
- Stored keys: `config`, `state` (accountId, keys, etc.), `txHistory`, `nonce`.
- Event system: `near.event.onAccount(cb)`, `near.event.onTx(cb)`.
- Unbroadcasted events are queued and replayed when the first listener subscribes.

## Yarn constraints (`yarn.config.cjs`)

- Reads the root `package.json` version and sets all workspace package versions to match.
- Run `yarn constraints --fix` after bumping the root version to automatically update all workspace `package.json` files.

## Custom type declarations

- `types/base58-js.d.ts` provides type declarations for `base58-js` (which lacks built-in types).
- The root `tsconfig.base.json` includes `"types": ["node", "./types/*.d.ts"]`; some workspace tsconfigs also explicitly include `../../types/*.d.ts`.

## Project-level `.yarnrc.yml`

- Contains only `nodeLinker: node-modules` (traditional `node_modules` layout, not Yarn PnP).
