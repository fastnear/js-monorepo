# near api

## general

This is a workspace package from the [@fastnear/js-monorepo](https://github.com/fastnear/js-monorepo) that has the primary responsibility. It's what creates the global `near` object.

<!-- BEGIN GENERATED:agent-api-surface -->
## Low-level-first surface

Use the low-level APIs when you already know the FastNear family and want exact control over request and response shapes. Use `near.recipes` when you want the shortest task-oriented helper layered on top of those lower-level surfaces.

### `near.config`

- `near.config({ networkId })` switches the family defaults together.
- `near.config({ apiKey })` applies auth in the right style for each family.
- `near.config({ nodeUrl })` keeps the RPC override path backward compatible.

### Named endpoint types

- `FastNearRecipeDiscoveryEntry`
- `FastNearApiV1AccountFullResponse` / `FastNearApiV1PublicKeyResponse`
- `FastNearTxTransactionsResponse` / `FastNearTxReceiptResponse` / `FastNearTxBlocksResponse`
- `FastNearTransfersQueryResponse`
- `FastNearNeardataLastBlockFinalResponse` / `FastNearNeardataBlockChunkResponse`
- `FastNearKvGetLatestKeyResponse` / `FastNearKvHistoryByAccountResponse` / `FastNearKvMultiResponse`

### Low-level-first mental model

- `near.view(...)` is the direct RPC primitive for one contract view call.
- `near.queryAccount(...)` is the raw RPC account-state envelope.
- `near.tx.*`, `near.api.v1.*`, `near.transfers.*`, `near.neardata.*`, and `near.fastdata.kv.*` are the exact-control family namespaces.
- Reach for `near.recipes.*` when you want the smallest task helper instead of the raw family method.

### `near.recipes`

- `near.recipes.viewContract`
- `near.recipes.viewAccount`
- `near.recipes.inspectTransaction`
- `near.recipes.functionCall`
- `near.recipes.transfer`
- `near.recipes.connect`
- `near.recipes.signMessage`
- `near.recipes.list()` / `near.recipes.toJSON()`

Recipe helper equivalence:

- `near.recipes.viewContract(...)` is the task helper over `near.view(...)`.
- `near.recipes.viewAccount(...)` is the task helper over `near.queryAccount(...)`.
- `near.recipes.inspectTransaction(...)` is the task helper over `near.tx.transactions(...)`.

### Service namespaces

- `near.api.v1.accountFull`, `near.api.v1.accountFt`, `near.api.v1.accountNft`, `near.api.v1.accountStaking`, `near.api.v1.publicKey`, `near.api.v1.publicKeyAll`, `near.api.v1.ftTop`
- `near.tx.transactions`, `near.tx.receipt`, `near.tx.account`, `near.tx.block`, `near.tx.blocks`
- `near.transfers.query`
- `near.neardata.lastBlockFinal`, `near.neardata.lastBlockOptimistic`, `near.neardata.block`, `near.neardata.blockHeaders`, `near.neardata.blockShard`, `near.neardata.blockChunk`, `near.neardata.blockOptimistic`, `near.neardata.firstBlock`, `near.neardata.health`
- `near.fastdata.kv.getLatestKey`, `near.fastdata.kv.getHistoryKey`, `near.fastdata.kv.latestByAccount`, `near.fastdata.kv.historyByAccount`, `near.fastdata.kv.latestByPredecessor`, `near.fastdata.kv.historyByPredecessor`, `near.fastdata.kv.allByPredecessor`, `near.fastdata.kv.multi`

### `near.explain`

- `near.explain.action` normalizes one action.
- `near.explain.tx` summarizes a signer, receiver, and action list.
- `near.explain.error` turns thrown RPC or wallet errors into stable JSON.

### Example: terminal-first view call

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

### Same question with curl + jq

```bash
# Assumes FASTNEAR_API_KEY is already set in your shell.
ACCOUNT_ID=root.near
ARGS_BASE64="$(jq -nc --arg account_id "$ACCOUNT_ID" '{account_id: $account_id}' | base64 | tr -d '\n')"

curl -sS "https://rpc.mainnet.fastnear.com?apiKey=$FASTNEAR_API_KEY"   -H 'content-type: application/json'   --data "$(jq -nc --arg args "$ARGS_BASE64" '{
    jsonrpc:"2.0",id:"fastnear",method:"query",
    params:{
      request_type:"call_function",
      finality:"final",
      account_id:"berryclub.ek.near",
      method_name:"get_account",
      args_base64:$args
    }
  }')"   | jq '.result.result | implode | fromjson | {account_id, avocado_balance, num_pixels}'
```


### Example: indexed transaction lookup with `near.tx`

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

### Example: exact-key lookup with `near.fastdata.kv`

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

### Access and chaining

- API key env var: `FASTNEAR_API_KEY`
- Hosted recipe catalog: `https://js.fastnear.com/recipes.json`
- Hosted terminal wrapper: `https://js.fastnear.com/agents.js`
- Free trial credits: `https://dashboard.fastnear.com`

Release contract:

- npm publish updates `https://js.fastnear.com/near.js` through the package-backed redirect path.
- Hosted site deploy updates `agents.js`, `near-node.mjs`, `recipes.json`, `llms.txt`, and `llms-full.txt`.

Set `FASTNEAR_API_KEY` before running the authenticated snippets.

#### Discovery order

1. Read llms.txt — Start with the concise repo and runtime map.
2. Fetch recipes.json — Use the hosted machine-readable recipe catalog with stable IDs, families, auth, returns, and snippets.
3. Run agents.js — Use the hosted terminal wrapper when you want the FastNear JS surface.
4. Fall back to curl + jq — Use raw transport when survey scripting or HTTP-level inspection is more useful.

#### Capture and chain one result

Keep the object work in JS, then hand the emitted JSON back to shell tooling when you need one more filter step. Every `near.recipes.*`, `near.view`, `near.ft.*`, and `near.nft.*` accepts a per-call `{ network: "testnet" }` override; see the `connect-testnet` and `function-call-testnet` recipes for the end-to-end testnet flow.

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
- `near.ft.balance`
- `near.ft.metadata`
- `near.ft.totalSupply`
- `near.ft.storageBalance`
- `near.nft.metadata`
- `near.nft.token`
- `near.nft.forOwner`
- `near.nft.supplyForOwner`
- `near.nft.totalSupply`
- `near.nft.tokens`

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
- `near.ft.inventory`
- `near.nft.inventory`

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


### Example: explain a transaction before signing

```js
near.print(near.explain.tx({
  signerId: "root.near",
  receiverId: "berryclub.ek.near",
  actions: [
    near.actions.functionCall({
      methodName: "draw",
      args: { pixels: [{ x: 10, y: 20, color: 65280 }] },
      gas: "100000000000000",
      deposit: "0",
    }),
  ],
}));
```

Example output shape:

```json
{
  "kind": "transaction",
  "signerId": "root.near",
  "receiverId": "berryclub.ek.near",
  "actionCount": 1,
  "actions": [
    {
      "kind": "action",
      "type": "FunctionCall",
      "methodName": "draw",
      "gas": "100000000000000",
      "deposit": "0",
      "args": {
        "pixels": [
          {
            "x": 10,
            "y": 20,
            "color": 65280
          }
        ]
      },
      "argsBase64": null,
      "params": {
        "methodName": "draw",
        "gas": "100000000000000",
        "deposit": "0",
        "args": {
          "pixels": [
            {
              "x": 10,
              "y": 20,
              "color": 65280
            }
          ]
        },
        "argsBase64": null
      }
    }
  ]
}
```
<!-- END GENERATED:agent-api-surface -->

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
