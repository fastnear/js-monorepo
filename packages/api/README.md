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
- `near.config({ retry })` tunes or disables automatic 429/transient retry (see below).
- `near.config({ batch })` sets the bulk-read concurrency cap (see below).

### Resilience and bulk reads

`@fastnear/api` retries transient RPC failures (HTTP 408/429/500/502/503/504 and JSON-RPC `-429`/`-32000`) with full-jitter backoff, and exposes an explicit bulk read API. Both are configurable through `near.config` and are on by default.

**Retry** — `near.config({ retry })`:

- `enabled` (default `true`) — set `false` to restore single-attempt behavior.
- `maxAttempts` (`5`) — total attempts including the first.
- `baseBackoffMs` (`250`) / `maxBackoffMs` (`30000`) — full-jitter exponential backoff bounds.
- `timeoutMs` (`15000`) — per-attempt AbortController timeout (`0` disables it).
- `respectRetryAfter` (`true`) — honor a `Retry-After` header, capped at `maxBackoffMs`.
- `writePolicy` (`"transport-only"`) — how writes (`send_tx` / `broadcast_tx_*`) retry: `"never"`, `"transport-only"` (only pre-response transport/timeout errors, resending identical signed bytes — safe against double-apply), or `"all"`.

**Bulk reads** — concurrency-limited fan-out (NEAR RPC has no array batching, so calls are not merged into one request):

- `near.batch(requests)` — each `{ method, params, useArchival?, network? }` runs as its own retried call, at most `batch.maxConcurrency` (default `30`) in flight. Write methods are rejected per-item.
- `near.view.many(specs)` — the same fan-out for `{ contractId, methodName, args?, argsBase64?, blockId? }` view specs, decoding each ok result like `near.view`.
- `near.config({ batch: { maxConcurrency: 30 } })` tunes the in-flight cap.

Both return **settled** results in input order — one failing call never rejects the set:

```js
const results = await near.view.many([
  { contractId: "token.near", methodName: "ft_balance_of", args: { account_id: "a.near" } },
  { contractId: "token.near", methodName: "ft_balance_of", args: { account_id: "b.near" } },
]);

for (const r of results) {
  if (r.status === "ok") near.print(r.result);
  else if (r.kind === "contract") console.warn("contract reverted:", r.error);
  else console.warn("infra error:", r.kind, r.error);
}
```

Each error item carries a `kind` — `"contract"` (the contract method reverted or failed), `"transport"` (no HTTP response: network or timeout), `"http"` (non-2xx), or `"rpc"` (JSON-RPC error) — so application failures stay distinguishable from infrastructure ones without re-parsing. Thrown errors are `FastNearRpcError` instances exposing the same `kind`, plus `status`, `code`, `data`, and `retryable`.

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
- Hosted topic explainers: `https://js.fastnear.com/transactions.html` (Constructing a transaction), `https://js.fastnear.com/x402.html` (x402 payments on NEAR), `https://js.fastnear.com/post-quantum.html` (Post-quantum ML-DSA-65 keys), `https://js.fastnear.com/retries.html` (Retries and bulk reads), `https://js.fastnear.com/intents.html` (NEAR Intents)
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
- `near.queryAccessKeyList`
- `near.queryProtocolVersion`
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


### ML-DSA-65 account-key quickstarts

The opt-in `@fastnear/ml-dsa-65` package provides protocol-v85 account access keys and transaction signatures without pulling the post-quantum backend into `@fastnear/api` or `@fastnear/utils`.

- Runtime: Node.js 20.19+ or a modern browser.
- Scope: NEAR account access keys and transaction signatures only; validator and staking keys remain Ed25519.
- Exact byte lengths: seed 32, public key 1952, expanded secret key 4032, signature 3309.
- Verification charge: 100 Ggas (100000000000 gas) for each outer or delegated ML-DSA-65 signature verification.
- Full key: `ml-dsa-65:<base58 public key>`; list handle: `ml-dsa-65-hash:<base58 SHA3-256 digest>`.
- Handle derivation: SHA3-256 of the ASCII domain tag followed by the raw 1,952-byte public key; domain tag `near:ml-dsa-65-pubkey-hash:v1`.

Use the full public key for AddKey, direct access-key lookup, signing, and DeleteKey. Access-key list responses expose the compact handle; derive it with publicKeyToHandle() before comparing.

#### Safety constraints

- Check the selected RPC's active protocol_version and require 85 or later before adding or using an ML-DSA-65 key; do not use node software versions or latest_protocol_version as activation signals.
- Never print or persist generated seeds or expanded secret keys. Keep a temporary recovery record public-only: network, account ID, full public key, and hash handle.
- After an AddKey attempt, do not trust a single absence read: submit a finalized classical DeleteKey nonce barrier, confirm absence at finality, and only then remove the public recovery record.
- ML-DSA-65 public keys are 1,952 bytes and signatures are 3,309 bytes, so transactions and key-management actions are substantially larger than classical equivalents.
- NEAR charges 100 Ggas (100,000,000,000 gas) for each outer or delegated ML-DSA-65 signature verification.
- The selected @noble/post-quantum backend describes itself as self-audited and does not claim constant-time side-channel protection. Prefer a native, WASM, HSM, or hardware TransactionSigner when that threat model requires one.
- destroy() provides best-effort zeroization of package-owned JavaScript buffers, not a hard memory-erasure guarantee. Constrained QuickJS and MCU runtimes are not a v1 compatibility target.

#### Generate an in-memory ML-DSA-65 signer

Recipe ID: `ml-dsa-65-generate`

Generate the opt-in signer, retain only public recovery metadata, and always destroy the signer when its lifecycle ends.

```js
import { generateSigner } from "@fastnear/ml-dsa-65";

const signer = generateSigner();

try {
  // Public values are safe to retain for enrollment and cleanup.
  const recovery = {
    network: "testnet",
    accountId: "device.testnet",
    publicKey: signer.publicKey,
    publicKeyHandle: signer.publicKeyHandle,
  };

  console.log(recovery);
  // Never log or persist signer.exportSeed() or signer.exportSecretKey().
} finally {
  signer.destroy();
}
```

#### Send with an enrolled ML-DSA-65 signer

Recipe ID: `ml-dsa-65-explicit-send`

Use the explicit-signer branch of sendTx after the signer's full public key has been enrolled on the account.

```js
import {
  actions,
  queryProtocolVersion,
  sendTx,
} from "@fastnear/api";

export async function sendOneYoctoWithMlDsa65({ accountId, signer }) {
  const protocolVersion = await queryProtocolVersion({ network: "testnet" });
  if (protocolVersion < 85) {
    throw new Error(`testnet protocol ${protocolVersion} does not support ML-DSA-65`);
  }

  return sendTx({
    signerId: accountId,
    signer,
    receiverId: accountId,
    actions: [actions.transfer("1")],
    waitUntil: "FINAL",
    network: "testnet",
  });
}
```

#### Enroll and delete a temporary testnet key

Recipe ID: `ml-dsa-65-enroll-delete`

Persist public-only recovery metadata, use an authorized classical full-access signer for both mutations, and establish finalized deletion before removing the record.

```js
import {
  actions,
  queryAccessKeyList,
  queryProtocolVersion,
  sendTx,
} from "@fastnear/api";
import {
  generateSigner,
} from "@fastnear/ml-dsa-65";

export async function withTemporaryMlDsa65Key({
  accountId,
  classicalSigner,
  run,
  saveRecovery,
  removeRecovery,
}) {
  if (!accountId.endsWith(".testnet")) {
    throw new Error("This safety-oriented recipe is testnet-only");
  }

  const protocolVersion = await queryProtocolVersion({ network: "testnet" });
  if (protocolVersion < 85) {
    throw new Error(`testnet protocol ${protocolVersion} does not support ML-DSA-65`);
  }

  const signer = generateSigner();
  const publicRecovery = {
    network: "testnet",
    accountId,
    publicKey: signer.publicKey,
    publicKeyHandle: signer.publicKeyHandle,
  };
  let addAttempted = false;

  async function deleteWithFinalizedBarrier() {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        // Submit even when one read says the key is absent. A finalized
        // classical transaction prevents an ambiguous earlier AddKey from
        // landing later with the same or a lower nonce.
        await sendTx({
          signerId: accountId,
          signer: classicalSigner,
          receiverId: accountId,
          actions: [actions.deleteKey({ publicKey: signer.publicKey })],
          waitUntil: "FINAL",
          network: "testnet",
        });
        const list = await queryAccessKeyList({
          accountId,
          blockId: "final",
          network: "testnet",
        });
        const stillPresent = list.result.keys.some(
          (entry) => entry.public_key === publicRecovery.publicKeyHandle,
        );
        if (!stillPresent) return;
        lastError = new Error("ML-DSA-65 key remains after finalized deletion");
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("Could not establish ML-DSA-65 key absence");
  }

  try {
    // Implement these callbacks with durable application storage. On Node,
    // create the public-only file with mode 0600. Never include secret bytes.
    await saveRecovery(publicRecovery);
    addAttempted = true;
    await sendTx({
      signerId: accountId,
      signer: classicalSigner,
      receiverId: accountId,
      actions: [actions.addFullAccessKey({ publicKey: signer.publicKey })],
      waitUntil: "FINAL",
      network: "testnet",
    });

    return await run(signer);
  } finally {
    try {
      if (addAttempted) {
        await deleteWithFinalizedBarrier();
        await removeRecovery(publicRecovery);
      }
    } finally {
      signer.destroy();
    }
  }
}
```

#### Reconcile a full key with its access-key-list handle

Recipe ID: `ml-dsa-65-reconcile`

Query the full key directly, then match its locally derived hash handle against the compact list response.

```js
import {
  queryAccessKey,
  queryAccessKeyList,
} from "@fastnear/api";
import { publicKeyToHandle } from "@fastnear/ml-dsa-65";

export async function findMlDsa65AccessKey({ accountId, publicKey }) {
  const [direct, list] = await Promise.all([
    queryAccessKey({ accountId, publicKey, network: "testnet" }),
    queryAccessKeyList({ accountId, network: "testnet" }),
  ]);
  const publicKeyHandle = publicKeyToHandle(publicKey);
  const listed = list.result.keys.find(
    (entry) => entry.public_key === publicKeyHandle,
  );

  return { direct: direct.result, publicKeyHandle, listed };
}
```

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
