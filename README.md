# global `near` js

This project is a monorepo for various NPM packages scoped under `@fastnear/`. It's a TypeScript project that is a full rewrite, creating a new JavaScript library for building on NEAR Protocol.

The API itself (ergonomics, how you use it) will be changing more liberally until the release is out of alpha.

This repo also contains wallet-related packages, which provides an alternate path to the established wallet selector. While functional, the wallet side of this monorepo has seen less attention.

## Instructions

At this early stage, the best place to begin understanding this library is:

https://js.fastnear.com

It will load a demo backed by the same runtime surfaces that ship in this monorepo.

<!-- BEGIN GENERATED:agent-quickstart -->
## Agent Quickstart

The monorepo now ships a low-level-first runtime plus a compact task catalog for humans and agents:

- `recipes/index.json` is the canonical machine-readable task catalog.
- `llms.txt` is the concise repo map for agents.
- `llms-full.txt` expands the same map with copy-paste snippets.
- `recipes/near-node.mjs` is the source file for the hosted `agents.js` terminal wrapper.
- `https://js.fastnear.com/recipes.json` is the canonical hosted recipe catalog.

### Runtime surfaces

- `near.config({ apiKey })` is the terse auth and base-url switch for the runtime.
- Start with the low-level surfaces when you already know the family and want exact response shapes: `near.view`, `near.queryAccount`, `near.tx.*`, `near.api.v1.*`, `near.transfers.*`, `near.neardata.*`, and `near.fastdata.kv.*`.
- `near.recipes.*` stays available for the shortest task-oriented helpers layered on top of those low-level surfaces.
- `near.recipes.list()` and `near.recipes.toJSON()` expose compact task discovery at runtime.
- `near.api.v1.*`, `near.tx.*`, `near.transfers.*`, `near.neardata.*`, and `near.fastdata.kv.*` expose endpoint-shaped service namespaces that return raw parsed JSON.
- Named exported response types are available from `@fastnear/api`, for example `FastNearTxTransactionsResponse` and `FastNearKvGetLatestKeyResponse`.
- `near.explain.*` turns actions, transactions, and thrown errors into stable JSON summaries.
- The original low-level entrypoints stay intact: `near.view`, `near.queryAccount`, `near.queryTx`, `near.sendTx`, `near.requestSignIn`, and `near.signMessage`.

### Hosted agent entrypoint

- Canonical terminal wrapper: `https://js.fastnear.com/agents.js`
- Canonical hosted recipe catalog: `https://js.fastnear.com/recipes.json`
- Backward-compatible alias: `https://js.fastnear.com/near-node.mjs`
- Published CDN release gate: `yarn smoke:agent:published`
- npm publish updates `https://js.fastnear.com/near.js` through the package-backed redirect path.
- Hosted site deploy updates `agents.js`, `near-node.mjs`, `recipes.json`, `llms.txt`, and `llms-full.txt`.

### Access and chaining

- API key env var: `FASTNEAR_API_KEY`
- Hosted recipe catalog: `https://js.fastnear.com/recipes.json`
- Hosted terminal wrapper: `https://js.fastnear.com/agents.js`
- Free trial credits: `https://dashboard.fastnear.com`

Set `FASTNEAR_API_KEY` before running the authenticated snippets.

#### Discovery order

1. Read llms.txt — Start with the concise repo and runtime map.
2. Fetch recipes.json — Use the hosted machine-readable recipe catalog with stable IDs, families, auth, returns, and snippets.
3. Run agents.js — Use the hosted terminal wrapper when you want the FastNear JS surface.
4. Fall back to curl + jq — Use raw transport when survey scripting or HTTP-level inspection is more useful.

#### Capture and chain one result

Keep the object work in JS, then hand the emitted JSON back to shell tooling when you need one more filter step.

```bash
# Assumes FASTNEAR_API_KEY is already set in your shell.
ACCOUNT_SUMMARY="$(node -e "$(curl -fsSL https://js.fastnear.com/agents.js)" <<'EOF'
const account = await near.recipes.viewAccount("root.near");

const { block_hash, storage_usage } = account;

near.print({ block_hash, storage_usage });
EOF
)"
BLOCK_HASH="$(printf '%s\n' "$ACCOUNT_SUMMARY" | jq -r '.block_hash')"
STORAGE_USAGE="$(printf '%s\n' "$ACCOUNT_SUMMARY" | jq -r '.storage_usage')"

printf 'block_hash=%s\nstorage_usage=%s\n' "$BLOCK_HASH" "$STORAGE_USAGE"
```

### Family chooser

#### rpc

Canonical NEAR JSON-RPC defaults for direct contract views, account state, and transaction status checks.

- Auth style: `query`
- Default base URLs: mainnet `https://rpc.mainnet.fastnear.com/`, testnet `https://rpc.testnet.fastnear.com/`
- Pagination: none; request fields: none; response fields: none; filters must stay stable: no
- Best for:
- Direct contract view calls with exact method names and args.
- Canonical account state and access key reads.
- Low-level RPC questions before you need indexed or aggregated surfaces.
- Entrypoints:
- `near.view`
- `near.queryAccount`
- `near.queryAccessKey`
- `near.queryBlock`
- `near.queryTx`
- `near.sendTx`

#### api

FastNear REST aggregations for account holdings, staking, and public-key oriented lookups.

- Auth style: `bearer`
- Default base URLs: mainnet `https://api.fastnear.com`, testnet `https://test.api.fastnear.com`
- Pagination: page_token; request fields: page_token; response fields: page_token; filters must stay stable: yes
- Best for:
- Combined account snapshots with fungible tokens, NFTs, and staking.
- Public-key-to-account discovery.
- Questions where one aggregated response is better than stitching multiple RPC calls.
- Entrypoints:
- `near.api.v1.accountFull`
- `near.api.v1.accountFt`
- `near.api.v1.accountNft`
- `near.api.v1.accountStaking`
- `near.api.v1.publicKey`
- `near.api.v1.publicKeyAll`
- `near.api.v1.ftTop`

#### tx

Indexed transaction and receipt lookups for readable execution history by hash, account, or block.

- Auth style: `bearer`
- Default base URLs: mainnet `https://tx.main.fastnear.com`, testnet `https://tx.test.fastnear.com`
- Pagination: resume_token; request fields: resume_token; response fields: resume_token; filters must stay stable: yes
- Best for:
- Starting from one transaction hash or receipt id.
- Readable execution stories with receipts already joined in.
- Recent account or block-centered transaction history queries.
- Entrypoints:
- `near.tx.transactions`
- `near.tx.receipt`
- `near.tx.account`
- `near.tx.block`
- `near.tx.blocks`

#### transfers

Asset-movement-focused history for accounts when the question is specifically about transfers, not full execution.

- Auth style: `bearer`
- Default base URLs: mainnet `https://transfers.main.fastnear.com`, testnet `null`
- Pagination: resume_token; request fields: resume_token; response fields: resume_token; filters must stay stable: yes
- Best for:
- Recent transfer feeds for one account.
- Asset movement summaries across FT, NFT, and native transfers.
- Survey scripting where transfer rows matter more than transaction internals.
- Entrypoints:
- `near.transfers.query`

#### neardata

Block and shard documents for recent chain-state inspection without reconstructing shard layouts yourself.

- Auth style: `query`
- Default base URLs: mainnet `https://mainnet.neardata.xyz`, testnet `https://testnet.neardata.xyz`
- Pagination: range; request fields: blockHeight, from_block_height, to_block_height; response fields: none; filters must stay stable: no
- Best for:
- Recent block inspection and shard-aware exploration.
- Questions about network recency or recent transaction volume.
- Walking block-height ranges and chunk layouts.
- Entrypoints:
- `near.neardata.lastBlockFinal`
- `near.neardata.lastBlockOptimistic`
- `near.neardata.block`
- `near.neardata.blockHeaders`
- `near.neardata.blockShard`
- `near.neardata.blockChunk`
- `near.neardata.blockOptimistic`
- `near.neardata.firstBlock`
- `near.neardata.health`

#### fastdata.kv

Indexed key-value history for exact keys, predecessor scans, and account-scoped storage exploration.

- Auth style: `bearer`
- Default base URLs: mainnet `https://kv.main.fastnear.com`, testnet `https://kv.test.fastnear.com`
- Pagination: resume_token; request fields: resume_token; response fields: resume_token; filters must stay stable: yes
- Best for:
- Exact-key lookups when you already know the contract, predecessor, and key.
- Storage history scans keyed by predecessor or current account.
- Questions about SocialDB-style writes and indexed storage history.
- Entrypoints:
- `near.fastdata.kv.getLatestKey`
- `near.fastdata.kv.getHistoryKey`
- `near.fastdata.kv.latestByAccount`
- `near.fastdata.kv.historyByAccount`
- `near.fastdata.kv.latestByPredecessor`
- `near.fastdata.kv.historyByPredecessor`
- `near.fastdata.kv.allByPredecessor`
- `near.fastdata.kv.multi`


### Representative tasks

#### What does this contract method return?

Start with one view call when you already know the contract, method, and arguments.

```bash
# Assumes FASTNEAR_API_KEY is already set in your shell.
node -e "$(curl -fsSL https://js.fastnear.com/agents.js)" <<'EOF'
const result = await near.recipes.viewContract({
  contractId: "berryclub.ek.near",
  methodName: "get_account",
  args: { account_id: "root.near" },
});

near.print({
  account_id: result.account_id,
  avocado_balance: result.avocado_balance,
  num_pixels: result.num_pixels,
});
EOF
```

#### What happened in this transaction?

Start with the indexed transaction family when all you have is the hash and you want the readable story.

```bash
# Assumes FASTNEAR_API_KEY is already set in your shell.
node -e "$(curl -fsSL https://js.fastnear.com/agents.js)" <<'EOF'
const tx = await near.recipes.inspectTransaction(
  "7ZKnhzt2MqMNmsk13dV8GAjGu3Db8aHzSBHeNeu9MJCq"
);

near.print(
  tx
    ? {
        hash: tx.transaction.hash,
        signer_id: tx.transaction.signer_id,
        receiver_id: tx.transaction.receiver_id,
        included_block_height: tx.execution_outcome.block_height,
        receipt_count: tx.receipts.length,
      }
    : null
);
EOF
```

#### What does this account own?

Use the FastNear account aggregator when the question is about holdings, NFTs, or staking in one response.

```bash
# Assumes FASTNEAR_API_KEY is already set in your shell.
node -e "$(curl -fsSL https://js.fastnear.com/agents.js)" <<'EOF'
const account = await near.api.v1.accountFull({
  accountId: "root.near",
});

near.print({
  account_id: account.account_id,
  near_balance_yocto: account.state.balance,
  ft_contracts: account.tokens.length,
  nft_contracts: account.nfts.length,
  staking_pool_contracts: account.pools.length,
});
EOF
```

#### What is the latest indexed value for this exact key?

Start narrow with KV FastData when you already know the contract, predecessor, and exact storage key.

```bash
# Assumes FASTNEAR_API_KEY is already set in your shell.
node -e "$(curl -fsSL https://js.fastnear.com/agents.js)" <<'EOF'
const result = await near.fastdata.kv.getLatestKey({
  currentAccountId: "social.near",
  predecessorId: "james.near",
  key: "graph/follow/sleet.near",
});

const latest = result.entries?.[0] || null;

near.print({
  latest: latest
    ? {
        current_account_id: latest.current_account_id,
        predecessor_id: latest.predecessor_id,
        block_height: latest.block_height,
        key: latest.key,
        value: latest.value,
      }
    : null,
});
EOF
```

### Structured explain helpers

- `near.explain.action`: Normalize one action into a stable JSON summary.
- `near.explain.tx`: Summarize a signer, receiver, and action list into stable JSON.
- `near.explain.error`: Turn thrown RPC, wallet, or transport failures into a predictable JSON object.
<!-- END GENERATED:agent-quickstart -->

## Testing and CI

The repo keeps the confidence ladder intentionally small:

- `yarn test` is the fast local and PR path. It runs Vitest plus the local generated-snippet smoke.
- `yarn smoke:services:live` is the live infrastructure check. It does one read-only call per FastNear family, including a pinned archival RPC read.
- `yarn smoke:agent:published` is the manual published-surface gate. Use it after publish when you want to verify the public `agents.js`, `recipes.json`, and `llms.txt` assets.

## Using this repo

[Yarn](https://yarnpkg.com/getting-started/install) is used in this repo, and it's likely not the yarn commonly installed. You must run:

    yarn set version berry

    yarn build

Will go through all the workspaces packages (see `workspaces` key in `package.json`) and build them for ECMAScript, CommonJS, and a Universal Module Definition. This is achieved using [`esbuild`](https://esbuild.github.io).

## Hacking this repo

Remember that esbuild and similar systems separate the TypeScript evaluation, strict or not, and so we cannot assume that a successful `yarn build` means valid TypeScript.

    yarn type-check

During development, this was helpful:

    yarn type-check && yarn build

If the `tsc` call (that does not emit artifacts) finds an error, it'll stop before building.

Will run a command and catch TypeScript problems that should be fixed.

This repo has a `tsconfig.base.json` that is used in some packages during build. It currently has `strict: true` but it can be helpful to turn it off during particularly rapid development. It won't (shouldn't) harm your project to turn off strict mode. This library will seek to adhere to strict mode, but that does not cascade into demanding this from end developers.

## Compilations

Each workspace package (NPM module) has an `esbuild.config.mjs` file that's used to take the TypeScript files in the `src` directory and compile them to:

### 1. ESM (EcmaScript)

The modern JavaScript module system, primarily used for browser and server environments, and the default for most new packages.

### 2. CJS (CommonJS)

The older module system for NodeJS, ensuring backwards compatibility.

### 3. UMD (Universal Module Definition)

A universal module format that works in browsers (with or without a bundler) and in NodeJS, bridging the gap between different environments.

>Universal Module Definition (UMD) is a versatile module format that aims to provide compatibility across different environments, including both browsers and server-side applications. Unlike purely browser-centric solutions like AMD or server-specific formats like CommonJS, UMD offers a unified approach. It checks the environment and adapts accordingly, making it suitable for various scenarios without requiring major adjustments.
[source](https://www.devzery.com/post/your-guide-to-universal-module-definition)

## Contributing

All workspace packages publish a new version regardless of whether the package was modified.

Each package's `dist` folder is revisioned, so make sure to run build. Not intending to focus much on CI. 

## Bump the version

In the project root, open `package.json` and change the version that should be reflected in all packages.

    yarn constraints

The file `yarn.config.cjs` defines a Yarn constraint that takes the root manifest and updates all the workspace package versions based on that.

After you bump the version run `yarn build` again because the artifacts will be updated in the comments about the version.

## Publish to NPM

OTP is required and can be input into the command:

    yarn workspaces foreach --all -tv run release --access public --otp <OTP>

## IN PROGRESS

### Wallets

I've only been testing with MyNEARWallet for a wallet. There may be obvious issues in the other ones, I don't know :)

Generally, the most progress has been on the API. Expect to find more unaddressed wallet issues than API ones. And feel free to lean in, knowing it's alpha and greenfield. 

### Survey examples directory

Give extra attention to `examples/static/` and `examples/nextjs/`; they now represent the intended example surfaces for the repo.

## Attribution

Exports are coming from the `utils` package in this monorepo. Want to acknowledge the hard work that went into this, and show gratitude for their willingness to have open source licenses.

### `base58-js`

npm: [https://www.npmjs.com/package/base58-js](https://www.npmjs.com/package/base58-js)

MIT License:
https://github.com/pur3miish/base58-js/blob/9ae694c74f4556834ee7e88cd08ac686600eb7cf/LICENSE

### `borsh` (format)

The [Borsh](https://borsh.io) binary serialization format originated in the NEAR ecosystem. This monorepo includes `@fastnear/borsh`, a clean-room reimplementation that replaces the external `borsh` npm package (`borsh-js`). The implementation is not derived from `borsh-js` code.

### `@noble/curves`

npm: [https://www.npmjs.com/package/@noble/curves](https://www.npmjs.com/package/@noble/curves)

MIT License:
https://github.com/paulmillr/noble-curves/blob/e9eef8b76434ba9bc24f71189b05433d7c685a02/LICENSE

Note: we are currently exporting sha256 from this library, but I believe the Web API Crypto and Crypto.Subtle have this ability and that library export won't be needed.
