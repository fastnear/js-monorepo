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
- `near.batch(...)` and `near.view.many(...)` fan out many reads with settled, concurrency-capped results, and `near.config({ retry, batch })` tunes automatic 429/transient retry — both on by default. See the API package README for details.
- `@fastnear/x402` provides opt-in x402 v2 NEAR payment clients plus focused `/node`, `/server`, and `/facilitator` entrypoints; browser-wallet payments require a timeout-aware wallet, with Meteor Wallet tested for this release.

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
- Hosted topic explainers: `https://js.fastnear.com/transactions.html` (Constructing a transaction), `https://js.fastnear.com/meta-transactions.html` (Gasless meta-transactions), `https://js.fastnear.com/gas-keys.html` (Gas keys), `https://js.fastnear.com/accounts.html` (Keys and accounts), `https://js.fastnear.com/x402.html` (x402 payments on NEAR), `https://js.fastnear.com/post-quantum.html` (Post-quantum ML-DSA-65 keys), `https://js.fastnear.com/retries.html` (Retries and bulk reads), `https://js.fastnear.com/intents.html` (NEAR Intents)
- Free trial credits: `https://dashboard.fastnear.com`

Set `FASTNEAR_API_KEY` before running the authenticated snippets.

#### Discovery order

1. Read llms.txt — Start with the concise repo and runtime map.
2. Fetch recipes.json — Use the hosted machine-readable recipe catalog with stable IDs, families, auth, returns, and snippets.
3. Run agents.js — Use the hosted terminal wrapper when you want the FastNear JS surface.
4. Read llms-full.txt — Go here for the complete reference when the concise map is not enough.
5. Fall back to curl + jq — Use raw transport when survey scripting or HTTP-level inspection is more useful.

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
- `near.gasPrice`
- `near.status`
- `near.validators`
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

#### wallet

Browser wallet session and signing surface from @fastnear/wallet: connect, send transactions, sign NEP-413 messages, and sign NEP-366 delegate actions.

- Auth style: `wallet-session`
- Default base URLs: none — browser wallet session, not an HTTP service
- Pagination: none; request fields: none; response fields: none; filters must stay stable: no
- Best for:
- Anything that needs a user to approve a signature in their own wallet.
- Browser dApps where the key never leaves the wallet.
- Sign-in plus proof-of-ownership in a single prompt via signMessageParams.
- Entrypoints:
- `near.recipes.connect`
- `near.recipes.functionCall`
- `near.recipes.transfer`
- `near.recipes.signMessage`
- `nearWallet.connect`
- `nearWallet.disconnect`
- `nearWallet.restore`
- `nearWallet.sendTransaction`
- `nearWallet.sendTransactions`
- `nearWallet.signMessage`
- `nearWallet.signDelegateActions`
- `nearWallet.addFunctionCallKey`


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
- Public keys, secret keys, and signatures all use the same ml-dsa-65: string prefix, so signer.exportSecretKey() is indistinguishable by shape from signer.publicKey. Distinguish them by decoded byte length (1,952 vs 4,032), never by prefix, and never let a secret reach a log line or a recovery record.
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

#### Enroll an ML-DSA-65 public key with a classical AddKey

Recipe ID: `ml-dsa-65-enroll`

Add the signer's full public key to the account using an existing classical full-access key. Enrollment always starts from a classical signer; an ML-DSA-65 key cannot add itself.

```js
import {
  actions,
  queryAccessKey,
  queryProtocolVersion,
  sendTx,
} from "@fastnear/api";
import { signerFromPrivateKey } from "@fastnear/utils";

export async function enrollMlDsa65Key({ accountId, classicalPrivateKey, signer }) {
  const protocolVersion = await queryProtocolVersion({ network: "testnet" });
  if (protocolVersion < 85) {
    throw new Error(`testnet protocol ${protocolVersion} does not support ML-DSA-65`);
  }

  // The AddKey itself is signed by an existing classical full-access key.
  const classicalSigner = signerFromPrivateKey(classicalPrivateKey);

  await sendTx({
    signerId: accountId,
    signer: classicalSigner,
    receiverId: accountId,
    // Pass the full ml-dsa-65:<base58> key. Never the ml-dsa-65-hash: handle.
    actions: [actions.addFullAccessKey({ publicKey: signer.publicKey })],
    waitUntil: "FINAL",
    network: "testnet",
  });

  // Read back with the full key: direct access-key lookup accepts it, while
  // access-key list responses expose only signer.publicKeyHandle.
  return queryAccessKey({
    accountId,
    publicKey: signer.publicKey,
    blockId: "final",
    network: "testnet",
  });
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

### Gas-key quickstarts

Gas keys (protocol v85+) are access keys with a prepaid balance that pays their own gas, plus independent nonce lanes for parallel sends. `@fastnear/api` adds them with the ordinary AddKey action, funds and drains them with the `TransferToGasKey` / `WithdrawFromGasKey` actions, and signs with them via `sendTx({ signer, signerId, nonceIndex })`, which builds a TransactionV1.

- Runtime: Node.js 20.19+ or a modern browser. Signing WITH a gas key (nonceIndex, TransactionV1) is local-key signing via sendTx({ signer, signerId }). Adding, funding and draining one through a wallet works with @fastnear/wallet 2.5.0+ (near-connect 0.14.1+), and only for wallets whose manifest sets features.gasKeys — Meteor Wallet, verified on testnet on 2026-09-24; the connector refuses the actions for wallets without the flag rather than risk a downgraded key.
- Scope: Prepaid-gas access keys: gas is charged to the key's own balance, deposits still come from the account, and gas refunds return to the key.
- Nonce lanes: 1..1024 per key; DeleteKey burns up to 1 NEAR of remaining balance and refuses above it.
- Access-key views: `{ GasKeyFullAccess: { balance, num_nonces } }` and `{ GasKeyFunctionCall: { balance, num_nonces, allowance: null, receiver_id, method_names } }`.
- Lane nonces: `query { request_type: "view_gas_key_nonces", account_id, public_key } -> { nonces: [...] }` (`near.queryGasKeyNonces`); a non-gas key fails with `UNKNOWN_GAS_KEY`.
- Builders: `actions.addFullAccessGasKey({ publicKey, numNonces })`, `actions.addLimitedAccessGasKey({ publicKey, numNonces, accountId, methodNames })`, `actions.transferToGasKey({ publicKey, deposit })`, `actions.withdrawFromGasKey({ publicKey, amount })`, `actions.deleteKey({ publicKey })`.

#### Rules

- AddKey creates the gas key with balance 0 and 1..1024 nonce lanes; the AddKey fee grows with numNonces, and a non-null allowance on GasKeyFunctionCall is rejected.
- TransferToGasKey may be sent by any account and the deposit leaves the sender; WithdrawFromGasKey must be signed by the owning account (signerId === receiverId).
- sendTx({ signer, signerId, nonceIndex, nonceMode }) detects a GasKey* permission and signs a TransactionV1 whose nonce is scoped to that lane: sequential sends on one lane, parallel sends across lanes.
- A gas key's view_access_key nonce is always 0; read lane nonces with queryGasKeyNonces.
- DeleteKey fails if the key holds more than 1 NEAR and burns whatever remains below that, so withdraw first.
- Gas keys cannot sign NEP-366 delegate actions, and WithdrawFromGasKey is not allowed inside a delegate.

#### Safety constraints

- Check the selected RPC's active protocol_version and require 85 or later before adding or using a gas key.
- Treat the gas key's private key like any signing secret; keep recovery records public-only (network, account, public key).
- Read balances and lane nonces at finality (blockId: "final") after a waitUntil: "FINAL" send before asserting on them; the default query finality is optimistic.
- Drain with WithdrawFromGasKey before DeleteKey; a gas refund that lands after your read is burnt on deletion (bounded by 1 NEAR).

#### Add a full-access gas key

Recipe ID: `gas-key-add`

Generate an ordinary ed25519 key pair and enroll it as a gas key with an existing full-access key. Only the permission differs from a classical key; the balance starts at 0.

```js
import { actions, queryAccessKey, queryProtocolVersion, sendTx } from "@fastnear/api";
import { privateKeyFromRandom, signerFromPrivateKey } from "@fastnear/utils";

export async function addGasKey({ accountId, ownerSigner, numNonces = 4 }) {
  const protocolVersion = await queryProtocolVersion({ network: "testnet" });
  if (protocolVersion < 85) {
    throw new Error(`testnet protocol ${protocolVersion} does not support gas keys`);
  }

  // A gas key is an ordinary ed25519 key pair; only its permission differs.
  const gasKeyPrivateKey = privateKeyFromRandom("ed25519");
  const gasSigner = signerFromPrivateKey(gasKeyPrivateKey);

  await sendTx({
    signerId: accountId,
    signer: ownerSigner,
    receiverId: accountId,
    // numNonces = independent transaction lanes (1..1024); the AddKey fee grows with it.
    actions: [actions.addFullAccessGasKey({ publicKey: gasSigner.publicKey, numNonces })],
    waitUntil: "FINAL",
    network: "testnet",
  });

  const view = await queryAccessKey({
    accountId,
    publicKey: gasSigner.publicKey,
    blockId: "final",
    network: "testnet",
  });
  // view.result.permission -> { GasKeyFullAccess: { balance: "0", num_nonces: 4 } }
  return { gasKeyPrivateKey, publicKey: gasSigner.publicKey, permission: view.result.permission };
}
```

#### Fund a gas key with TransferToGasKey

Recipe ID: `gas-key-fund`

Move NEAR from any account into the gas key's balance. The transaction's receiver is the key's owner; the funder may be a different account.

```js
import { actions, gasKeyInfoFromPermission, queryAccessKey, sendTx } from "@fastnear/api";

export async function fundGasKey({ funderId, funderSigner, accountId, publicKey, amount = "0.05 NEAR" }) {
  await sendTx({
    signerId: funderId,
    signer: funderSigner,
    receiverId: accountId,
    actions: [actions.transferToGasKey({ publicKey, deposit: amount })],
    waitUntil: "FINAL",
    network: "testnet",
  });

  const view = await queryAccessKey({ accountId, publicKey, blockId: "final", network: "testnet" });
  const info = gasKeyInfoFromPermission(view.result.permission);
  if (!info) throw new Error(`${publicKey} is not a gas key on ${accountId}`);
  return info.balance; // yoctoNEAR decimal string
}
```

#### Send a transaction signed by the gas key

Recipe ID: `gas-key-send`

sendTx reads the GasKey* permission, fetches the chosen lane's nonce, and signs a TransactionV1. Gas comes from the key balance; different lanes do not wait on each other.

```js
import { actions, queryGasKeyNonces, sendTx } from "@fastnear/api";

export async function sendWithGasKey({ accountId, gasSigner, receiverId, nonceIndex = 0 }) {
  const result = await sendTx({
    signerId: accountId,
    signer: gasSigner,
    receiverId,
    actions: [actions.functionCall({ methodName: "ping", args: {}, gas: "30 Tgas", deposit: "0" })],
    nonceIndex,
    waitUntil: "FINAL",
    network: "testnet",
  });

  const nonces = await queryGasKeyNonces({
    accountId,
    publicKey: gasSigner.publicKey,
    blockId: "final",
    network: "testnet",
  });
  return { txHash: result.transaction?.hash ?? null, nonces: nonces.result.nonces };
}

// Lanes are independent nonce sequences, so these do not serialize behind each other.
export const sendOnTwoLanes = (params) =>
  Promise.all([0, 1].map((nonceIndex) => sendWithGasKey({ ...params, nonceIndex })));
```

#### Inspect a gas key's balance and lane nonces

Recipe ID: `gas-key-inspect`

Combine view_access_key (balance, lane count, function-call scope) with view_gas_key_nonces (one nonce per lane) and the account's key list.

```js
import {
  gasKeyInfoFromPermission,
  queryAccessKey,
  queryAccessKeyList,
  queryGasKeyNonces,
} from "@fastnear/api";

export async function inspectGasKey({ accountId, publicKey }) {
  const [direct, lanes, list] = await Promise.all([
    queryAccessKey({ accountId, publicKey, blockId: "final", network: "testnet" }),
    queryGasKeyNonces({ accountId, publicKey, blockId: "final", network: "testnet" }),
    queryAccessKeyList({ accountId, blockId: "final", network: "testnet" }),
  ]);
  const info = gasKeyInfoFromPermission(direct.result.permission);
  if (!info) throw new Error(`${publicKey} is not a gas key on ${accountId}`);
  return {
    balance: info.balance,
    numNonces: info.num_nonces,
    nonces: lanes.result.nonces,
    // Set only for GasKeyFunctionCall keys.
    receiverId: info.functionCall?.receiver_id ?? null,
    listed: list.result.keys.some((key) => key.public_key === publicKey),
  };
}
```

#### Drain a gas key and delete it

Recipe ID: `gas-key-withdraw-delete`

Withdraw the remaining balance to the account, then delete the key, in one batched transaction signed by the owning account. DeleteKey burns any balance left and refuses above 1 NEAR.

```js
import { actions, gasKeyInfoFromPermission, queryAccessKey, sendTx } from "@fastnear/api";

export async function withdrawAndDeleteGasKey({ accountId, ownerSigner, publicKey }) {
  const view = await queryAccessKey({ accountId, publicKey, blockId: "final", network: "testnet" });
  const info = gasKeyInfoFromPermission(view.result.permission);
  if (!info) throw new Error(`${publicKey} is not a gas key on ${accountId}`);

  // DeleteKey fails above 1 NEAR and burns anything below it, so withdraw first.
  // WithdrawFromGasKey must be signed by the owning account itself.
  const drain = BigInt(info.balance) > 0n
    ? [actions.withdrawFromGasKey({ publicKey, amount: info.balance })]
    : [];
  await sendTx({
    signerId: accountId,
    signer: ownerSigner,
    receiverId: accountId,
    actions: [...drain, actions.deleteKey({ publicKey })],
    waitUntil: "FINAL",
    network: "testnet",
  });

  const after = await queryAccessKey({ accountId, publicKey, blockId: "final", network: "testnet" });
  if (!/UnknownAccessKey|does not exist/i.test(after.result.error ?? "")) {
    throw new Error("gas key still present");
  }
}
```

### x402 payments on NEAR

`@fastnear/x402` adapts the official x402 Foundation NEAR mechanism without introducing another wire format.

- Protocol: x402 v2 `exact` on `near:mainnet` and `near:testnet`.
- Authorization: NEP-366 SignedDelegate; asset: NEP-141 fungible tokens.
- Browser global: `nearX402`.
- Runtime: Package-only; not included in agents.js or near.js.
- Browser status: Stable with tested Meteor Wallet support; other wallets must advertise both timeout-aware delegate-signing capabilities and pass the x402 testnet harness before being documented as compatible.
- Required wallet features: `signDelegateActions` and `signDelegateActionsWithTtl`.
- Package guide: [https://github.com/fastnear/js-monorepo/blob/main/packages/x402/README.md](https://github.com/fastnear/js-monorepo/blob/main/packages/x402/README.md).

#### Choose by task

- Pay an x402 URL from Node.js: `createLocalNearSigner` + `createNearPaymentFetch` from `@fastnear/x402/node` and `@fastnear/x402` — stable.
- Pay an x402 URL from a browser wallet: `createFastNearWalletSigner` + `createNearPaymentFetch` from `@fastnear/wallet` and `@fastnear/x402` — stable with a compatible timeout-aware wallet; Meteor Wallet is the tested production path.
- Protect a seller resource: `createNearResourceServer` from `@fastnear/x402/server` — requires an explicit facilitator; the reference instances also need a per-instance API key for verify and settle.
- Operate a NEAR facilitator: `createNearFacilitator` from `@fastnear/x402/facilitator` — HTTP framework and secret storage are operator choices.
- Integrate below the paid-fetch helper: `createNearX402Client` from `@fastnear/x402` — lower-level client path.

#### Entrypoints

- `@fastnear/x402`: `createFastNearWalletSigner`, `createNearX402Client`, `createNearPaymentFetch` — injected FastNEAR wallet signer, NEAR-only x402 client, and paid fetch.
- `@fastnear/x402/node`: `createLocalNearSigner` — official RPC-backed local full-access-key signer.
- `@fastnear/x402/server`: `createNearResourceServer` — resource server with one or more explicitly configured facilitators.
- `@fastnear/x402/facilitator`: `createNearFacilitator` — self-hosted facilitator registration for concrete NEAR networks.

#### Reference facilitators

Public instances of [fastnear/x402-facilitator](https://github.com/fastnear/x402-facilitator) (open source), verified 2026-09-24: x402 v2 exact only, zero facilitator fee, payment-identifier extension, gas sponsorship bounded by per-client policy. Public routes: `GET /supported`, `GET /llms.txt`, `GET /openapi.yaml`, `GET /discovery/resources`, `GET /healthz`, `GET /readyz`. Authenticated routes: `POST /verify`, `POST /settle` — credential: X-API-Key header (an identical Bearer token is also accepted): one manually approved key per resource-server instance and environment, held server-side; payers never need one. Request a key through the [access guide](https://github.com/fastnear/x402-facilitator/blob/main/docs/reference-access.md) ([request form](https://github.com/fastnear/x402-facilitator/issues/new?template=access_request.yml)); other providers are listed in the [x402 facilitator directory](https://docs.x402.org/dev-tools/facilitators).

- `near:mainnet`: https://x402.mikedotexe.com — Circle USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, relayer `x402-relayer2.mike.near`.
- `near:testnet`: https://test.x402.mikedotexe.com — Circle USDC `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`, relayer `x402-relayer.mike.testnet`.

#### Constraints

- Only x402 v2 exact payments on near:mainnet and near:testnet are supported.
- Payments use NEP-141 tokens; native NEAR is not a direct payment asset.
- Wallet and local-key payers require full-access keys, and recipients need token storage registration.
- Resource servers require an explicit facilitator; no x402.org or other default is selected.
- Browser wallet access is injected explicitly and payment occurs only when the application calls the paid fetch function.

#### Safe defaults

- Pin near:testnet during development and a concrete NEAR network in production; use near:* only for an intentionally cross-network client.
- Keep payer keys, relayer keys, and facilitator API keys in server-side secret storage, never browser code.
- String and number seller prices use the official USDC contract; wNEAR and custom tokens require an explicit { amount, asset } price.
- Always configure a facilitator explicitly.

#### Pay an x402 URL from Node.js

Quickstart ID: `x402-node-paid-fetch`

Use the upstream local full-access-key signer with the high-level paid-fetch helper.

```js
import { createNearPaymentFetch } from "@fastnear/x402";
import { createLocalNearSigner } from "@fastnear/x402/node";

const { NEAR_PAYER_ACCOUNT_ID, NEAR_PAYER_SECRET_KEY, X402_RESOURCE_URL } = process.env;
if (!NEAR_PAYER_ACCOUNT_ID || !NEAR_PAYER_SECRET_KEY || !X402_RESOURCE_URL) {
  throw new Error("NEAR_PAYER_ACCOUNT_ID, NEAR_PAYER_SECRET_KEY, and X402_RESOURCE_URL are required");
}

const signer = createLocalNearSigner({
  accountId: NEAR_PAYER_ACCOUNT_ID,
  secretKey: NEAR_PAYER_SECRET_KEY,
  rpcUrls: { "near:testnet": "https://rpc.testnet.fastnear.com" },
});
const paidFetch = createNearPaymentFetch({ signer, network: "near:testnet" });
const response = await paidFetch(X402_RESOURCE_URL);
if (!response.ok) throw new Error(`Paid request failed: ${response.status}`);
console.log(await response.json());
```

#### Configure a seller with an explicit remote facilitator

Quickstart ID: `x402-remote-facilitator-seller`

Create the NEAR resource-server core with the facilitator URL and its per-instance API key, then pass it to the x402 HTTP framework adapter you choose.

```js
import { createNearResourceServer } from "@fastnear/x402/server";

const { X402_FACILITATOR_URL, X402_FACILITATOR_API_KEY } = process.env;
if (!X402_FACILITATOR_URL) throw new Error("X402_FACILITATOR_URL is required");

// The reference facilitators gate POST /verify and /settle behind a per-instance
// X-API-Key (GET /supported is public); a self-hosted one may need no key.
const authHeaders = X402_FACILITATOR_API_KEY ? { "X-API-Key": X402_FACILITATOR_API_KEY } : {};

export const resourceServer = createNearResourceServer({
  facilitators: {
    url: X402_FACILITATOR_URL,
    createAuthHeaders: async () => ({ verify: authHeaders, settle: authHeaders, supported: {} }),
  },
});
await resourceServer.initialize();
```

### NEAR Intents

`@fastnear/intents` integrates the NEAR Intents protocol: the intents.near verifier, the hosted 1Click swap API, and the solver relay.

- Verifier: `intents.near` (mainnet); ledger: NEP-245 multi-token; token ids nep141:<contract>, nep171:<contract>:<id>, nep245:<contract>:<id>.
- Signing: NEP-413 signed messages (full-access keys only); the verifier also accepts erc191, tip191, raw_ed25519, webauthn, ton_connect, and sep53 payloads.
- 1Click API: `https://1click.chaindefuser.com`; solver relay: `https://solver-relay-v2.chaindefuser.com/rpc`.
- Browser global: `nearIntents`.
- Runtime: Package-only; not included in agents.js or near.js.
- Wallet status: The wallet signing path uses nearWallet.signMessage (NEP-413), which every near-connect executor implements; the funded end-to-end swap path is verified by the mainnet smoke runbook before being documented further.
- Package guide: [https://github.com/fastnear/js-monorepo/blob/main/packages/intents/README.md](https://github.com/fastnear/js-monorepo/blob/main/packages/intents/README.md).

#### Choose by task

- Quote and track a swap: `createOneClickClient` from `@fastnear/intents` — stable; keyless use adds a 0.2% platform fee to quotes.
- Sign intents from a browser wallet: `createWalletIntentSigner` from `@fastnear/wallet` and `@fastnear/intents` — NEP-413 via the connected wallet's full-access key; FunctionCall session keys cannot sign intents.
- Sign intents from Node.js or an agent: `createLocalIntentSigner` from `@fastnear/intents/node` — raw full-access key, server-side only.
- Deposit, check balances, withdraw on the verifier: `ftDepositAction` + `wrapNearAction` + `mtBatchBalances` + `ftWithdrawAction` from `@fastnear/intents` and `@fastnear/api` — action builders for near.sendTx plus NEP-245 views over injected near.view.
- Talk to the solver relay directly: `createSolverRelayClient` from `@fastnear/intents/relay` — quotes require a partner API key in practice; the 1Click path is the default.

#### Entrypoints

- `@fastnear/intents`: `createOneClickClient`, `createWalletIntentSigner`, `createSolverRelayClient`, `ftDepositAction`, `wrapNearAction`, `ftWithdrawAction`, `mtBalance`, `mtBatchBalances`, `toSignedIntent`, `randomNonce` — browser-safe 1Click client, wallet intent signer, verifier helpers, and relay client.
- `@fastnear/intents/relay`: `createSolverRelayClient` — solver-relay JSON-RPC client (quote, publish_intent, publish_intents, get_status).
- `@fastnear/intents/node`: `createLocalIntentSigner` — local full-access-key NEP-413 intent signer for servers and agents.

#### Constraints

- The verifier is intents.near on NEAR mainnet; there is no public testnet deployment of the intents stack.
- NEP-413 intent signatures require a full-access key, and the verifier checks the key is authorized for signer_id.
- Submitted signatures use ed25519:<base58> encoding — not the base64 NEAR wallets return; the signers own that conversion.
- Native NEAR is not a verifier asset: wrap to wNEAR before depositing, and exit native NEAR only via the native_withdraw intent.
- Amounts are base-unit strings, and token_diff diffs must net to zero per token across the executed batch.

#### Safe defaults

- Quote with dry:true first; commit with dry:false only when ready to fund the deposit address before it expires.
- Keep local signer private keys in server-side secret storage, never browser code.
- Use a partner API key from partners.near-intents.org to remove the 0.2% keyless platform fee.
- Poll /v0/status to a terminal state (SUCCESS, REFUNDED, FAILED) and surface swapDetails on non-success.
- Omit msg on ft_withdraw so failed withdrawals stay refundable.

#### Quote a swap and read live pricing

Quickstart ID: `intents-one-click-quote`

Discover assets and price a swap with a free dry-run quote — no auth, no funds, no commitment.

```js
import { createOneClickClient } from "@fastnear/intents";

const oneClick = createOneClickClient();

const tokens = await oneClick.tokens();
const quote = await oneClick.quote({
  dry: true,
  swapType: "EXACT_INPUT",
  slippageTolerance: 100,
  originAsset: "nep141:wrap.near",
  destinationAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  amount: "1000000000000000000000000",
  depositType: "ORIGIN_CHAIN",
  refundTo: "you.near",
  refundType: "ORIGIN_CHAIN",
  recipient: "you.near",
  recipientType: "DESTINATION_CHAIN",
  deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
});

console.log(quote.quote.amountOutFormatted);
```

#### Sign a token_diff intent with a browser wallet

Quickstart ID: `intents-wallet-sign`

NEP-413 through the connected wallet, re-encoded to the MultiPayload the verifier accepts.

```js
import { createWalletIntentSigner } from "@fastnear/intents";
// window.nearWallet from https://js.fastnear.com/wallet.js, already connected.

const signer = createWalletIntentSigner({ wallet: nearWallet });

const signed = await signer.signIntents({
  intents: [{
    intent: "token_diff",
    diff: {
      "nep141:usdc.near": "-1000000",
      "nep141:usdt.near": "1000000",
    },
  }],
});
// signed = { standard: "nep413", payload, public_key, signature } — submit via
// oneClick.submitIntent, relay.publishIntent, or intents.near execute_intents.
```

#### Swap intents.near balances from Node.js

Quickstart ID: `intents-node-swap`

The INTENTS deposit type: 1Click builds the payload, the local signer signs it verbatim, no deposit transaction needed.

```js
import { createOneClickClient } from "@fastnear/intents";
import { createLocalIntentSigner } from "@fastnear/intents/node";

const { NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY } = process.env;
const oneClick = createOneClickClient();
const signer = createLocalIntentSigner({
  accountId: NEAR_ACCOUNT_ID,
  privateKey: NEAR_PRIVATE_KEY, // full-access, server-side only
});

// Quote with depositType/refundType/recipientType "INTENTS" — the input
// funds already sit inside intents.near, so no deposit transaction is needed.
const quote = await oneClick.quote({
  dry: false,
  swapType: "EXACT_INPUT",
  slippageTolerance: 100,
  originAsset: "nep141:wrap.near",
  destinationAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  amount: "1000000000000000000000000",
  depositType: "INTENTS",
  refundTo: NEAR_ACCOUNT_ID,
  refundType: "INTENTS",
  recipient: NEAR_ACCOUNT_ID,
  recipientType: "INTENTS",
  deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
});
const { intent } = await oneClick.generateIntent({
  signerId: NEAR_ACCOUNT_ID,
  depositAddress: quote.quote.depositAddress,
});
// signPayload pins the recipient to intents.near and signs verbatim.
const signed = await signer.signPayload(intent);
const { intentHash } = await oneClick.submitIntent({ signedData: signed });
console.log(intentHash);
```

#### Deposit wNEAR and read verifier balances

Quickstart ID: `intents-deposit-balances`

Action builders for near.sendTx plus NEP-245 ledger views over the injected near.view.

```js
import { ftDepositAction, wrapNearAction, mtBatchBalances } from "@fastnear/intents";

await near.sendTx({
  receiverId: "wrap.near",
  actions: [wrapNearAction({ amountYocto: "1000000000000000000000000" })],
});
await near.sendTx({
  receiverId: "wrap.near",
  actions: [ftDepositAction({ amount: "1000000000000000000000000" })],
});

const balances = await mtBatchBalances({
  accountId: near.accountId(),
  tokenIds: ["nep141:wrap.near"],
  view: near.view,
});
near.print(balances);
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
- `yarn smoke:agent:published` is the manual published-surface gate. Use it after publish to verify `agents.js`, `near.js`, `recipes.json`, `llms.txt`, and `llms-full.txt`, including the package-only x402 metadata.

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

Use the workspace `release` script rather than raw `npm publish`. The release scripts publish a tarball produced by `yarn pack`, so workspace dependencies are packed with concrete versions while npm CLI auth and OTP handling still work normally.

## IN PROGRESS

### Wallets

Wallet QA runs against Meteor (web popup) and Intear through near-connect. MyNearWallet is no longer in the near-connect manifest (it sunsets 2026-10-31), so nothing here targets it.

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
