import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FASTNEAR_AGENT_ENTRY,
  FASTNEAR_RECIPE_CATALOG_ENTRY,
  generatedArtifact,
  recipeCatalog,
  explainSurface,
  supportSurface,
} from "../recipes/source.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const checkOnly = process.argv.includes("--check");

const filesToWrite = new Map();

const requiredRecipeFields = [
  "service",
  "returns",
  "outputKeys",
  "responseNotes",
  "chooseWhen",
  "followUps",
  "pagination",
  "relatedRecipes",
];

function renderList(items, prefix = "- ") {
  return items.map((item) => `${prefix}${item}`).join("\n");
}

function renderPagination(pagination) {
  return `${pagination.kind}; request fields: ${pagination.requestFields.join(", ") || "none"}; response fields: ${pagination.responseFields.join(", ") || "none"}; filters must stay stable: ${pagination.filtersMustStayStable ? "yes" : "no"}`;
}

function assertCatalogContract() {
  if (generatedArtifact.version !== 4) {
    throw new Error(`Expected generated artifact version 4, received ${generatedArtifact.version}`);
  }

  if (!Array.isArray(generatedArtifact.families) || generatedArtifact.families.length < 6) {
    throw new Error("Expected generated artifact to expose top-level family metadata");
  }

  for (const family of generatedArtifact.families) {
    for (const key of ["id", "summary", "authStyle", "defaultBaseUrls", "bestFor", "pagination", "entrypoints"]) {
      if (!(key in family)) {
        throw new Error(`Family ${family.id ?? "<unknown>"} is missing required field ${key}`);
      }
    }
  }

  for (const recipe of recipeCatalog) {
    for (const field of requiredRecipeFields) {
      if (!(field in recipe)) {
        throw new Error(`Recipe ${recipe.id} is missing required field ${field}`);
      }
    }
  }
}

function renderSnippet(snippet) {
  return `### ${snippet.label}

\`\`\`${snippet.language}
${snippet.code}
\`\`\``;
}

function renderRecipe(recipe) {
  const example = JSON.stringify(recipe.example, null, 2);
  return `## ${recipe.title}

- ID: \`${recipe.id}\`
- API: \`${recipe.api}\`
- Service: \`${recipe.service}\`
- Returns: \`${recipe.returns}\`
- Network: \`${recipe.network}\`
- Auth: \`${recipe.auth}\`
- Summary: ${recipe.summary}
- Output keys: ${recipe.outputKeys.map((key) => `\`${key}\``).join(", ")}
- Pagination: ${renderPagination(recipe.pagination)}

Choose this when:

${renderList(recipe.chooseWhen)}

Response notes:

${renderList(recipe.responseNotes)}

Follow-ups:

${renderList(recipe.followUps)}

Related recipes:

${renderList(recipe.relatedRecipes.map((id) => `\`${id}\``))}

Example inputs:

\`\`\`json
${example}
\`\`\`

${recipe.snippets.map(renderSnippet).join("\n\n")}`;
}

function renderSupportSection() {
  return `### Access and chaining

- API key env var: ` + "`" + supportSurface.apiKeyEnvVar + "`" + `
- Hosted recipe catalog: ` + "`" + supportSurface.hostedCatalogUrl + "`" + `
- Hosted terminal wrapper: ` + "`" + supportSurface.hostedAgentEntry + "`" + `
- Free trial credits: ` + "`" + supportSurface.trialCreditsUrl + "`" + `

Set ` + "`" + supportSurface.apiKeyEnvVar + "`" + ` before running the authenticated snippets.

#### Discovery order

${supportSurface.discoveryOrder.map((entry) => `${entry.step}. ${entry.label} — ${entry.detail}`).join("\n")}

#### ${supportSurface.captureExample.title}

${supportSurface.captureExample.summary}

\`\`\`${supportSurface.captureExample.language}
${supportSurface.captureExample.code}
\`\`\``;
}

function renderFamilySection() {
  return `### Family chooser

${generatedArtifact.families.map((family) => `#### ${family.id}

${family.summary}

- Auth style: \`${family.authStyle}\`
- Default base URLs: mainnet \`${family.defaultBaseUrls.mainnet}\`, testnet \`${family.defaultBaseUrls.testnet}\`
- Pagination: ${renderPagination(family.pagination)}
- Best for:
${renderList(family.bestFor)}
- Entrypoints:
${renderList(family.entrypoints.map((entrypoint) => `\`${entrypoint}\``))}
`).join("\n")}`;
}

function renderRootReadmeSection() {
  const primaryRecipes = recipeCatalog.filter((recipe) =>
    ["view-contract", "inspect-transaction", "account-full", "kv-latest-key"].includes(recipe.id)
  );

  return `## Agent Quickstart

The monorepo now ships a low-level-first runtime plus a compact task catalog for humans and agents:

- ` + "`recipes/index.json`" + ` is the canonical machine-readable task catalog.
- ` + "`llms.txt`" + ` is the concise repo map for agents.
- ` + "`llms-full.txt`" + ` expands the same map with copy-paste snippets.
- ` + "`recipes/near-node.mjs`" + ` is the source file for the hosted ` + "`agents.js`" + ` terminal wrapper.
- ` + "`" + FASTNEAR_RECIPE_CATALOG_ENTRY + "`" + ` is the canonical hosted recipe catalog.

### Runtime surfaces

- ` + "`near.config({ apiKey })`" + ` is the terse auth and base-url switch for the runtime.
- Start with the low-level surfaces when you already know the family and want exact response shapes: ` + "`near.view`" + `, ` + "`near.queryAccount`" + `, ` + "`near.tx.*`" + `, ` + "`near.api.v1.*`" + `, ` + "`near.transfers.*`" + `, ` + "`near.neardata.*`" + `, and ` + "`near.fastdata.kv.*`" + `.
- ` + "`near.recipes.*`" + ` stays available for the shortest task-oriented helpers layered on top of those low-level surfaces.
- ` + "`near.recipes.list()`" + ` and ` + "`near.recipes.toJSON()`" + ` expose compact task discovery at runtime.
- ` + "`near.api.v1.*`" + `, ` + "`near.tx.*`" + `, ` + "`near.transfers.*`" + `, ` + "`near.neardata.*`" + `, and ` + "`near.fastdata.kv.*`" + ` expose endpoint-shaped service namespaces that return raw parsed JSON.
- Named exported response types are available from ` + "`@fastnear/api`" + `, for example ` + "`FastNearTxTransactionsResponse`" + ` and ` + "`FastNearKvGetLatestKeyResponse`" + `.
- ` + "`near.explain.*`" + ` turns actions, transactions, and thrown errors into stable JSON summaries.
- The original low-level entrypoints stay intact: ` + "`near.view`" + `, ` + "`near.queryAccount`" + `, ` + "`near.queryTx`" + `, ` + "`near.sendTx`" + `, ` + "`near.requestSignIn`" + `, and ` + "`near.signMessage`" + `.

### Hosted agent entrypoint

- Canonical terminal wrapper: ` + "`" + FASTNEAR_AGENT_ENTRY + "`" + `
- Canonical hosted recipe catalog: ` + "`" + FASTNEAR_RECIPE_CATALOG_ENTRY + "`" + `
- Backward-compatible alias: ` + "`https://js.fastnear.com/near-node.mjs`" + `
- Published CDN release gate: ` + "`yarn smoke:agent:published`" + `
- npm publish updates ` + "`https://js.fastnear.com/near.js`" + ` through the package-backed redirect path.
- Hosted site deploy updates ` + "`agents.js`" + `, ` + "`near-node.mjs`" + `, ` + "`recipes.json`" + `, ` + "`llms.txt`" + `, and ` + "`llms-full.txt`" + `.

${renderSupportSection()}

${renderFamilySection()}

### Representative tasks

${primaryRecipes.map((recipe) => {
    const terminal = recipe.snippets.find((snippet) => snippet.id === "terminal");
    return `#### ${recipe.title}

${recipe.summary}

\`\`\`${terminal.language}
${terminal.code}
\`\`\``;
  }).join("\n\n")}

### Structured explain helpers

${explainSurface.map((entry) => `- ` + "`" + entry.api + "`" + `: ${entry.summary}`).join("\n")}
`;
}

function renderApiReadmeSection() {
  const viewRecipe = recipeCatalog.find((recipe) => recipe.id === "view-contract");
  const inspectRecipe = recipeCatalog.find((recipe) => recipe.id === "inspect-transaction");
  const kvRecipe = recipeCatalog.find((recipe) => recipe.id === "kv-latest-key");
  const viewTerminalSnippet = viewRecipe.snippets.find((snippet) => snippet.id === "terminal");
  const viewCurlSnippet = viewRecipe.snippets.find((snippet) => snippet.id === "curl-jq");
  const inspectTerminalSnippet = inspectRecipe.snippets.find((snippet) => snippet.id === "terminal");
  const kvTerminalSnippet = kvRecipe.snippets.find((snippet) => snippet.id === "terminal");
  const explainEntry = explainSurface.find((entry) => entry.api === "near.explain.tx");

  return `## Low-level-first surface

Use the low-level APIs when you already know the FastNear family and want exact control over request and response shapes. Use ` + "`near.recipes`" + ` when you want the shortest task-oriented helper layered on top of those lower-level surfaces.

### ` + "`near.config`" + `

- ` + "`near.config({ networkId })`" + ` switches the family defaults together.
- ` + "`near.config({ apiKey })`" + ` applies auth in the right style for each family.
- ` + "`near.config({ nodeUrl })`" + ` keeps the RPC override path backward compatible.

### Named endpoint types

- ` + "`FastNearRecipeDiscoveryEntry`" + `
- ` + "`FastNearApiV1AccountFullResponse`" + ` / ` + "`FastNearApiV1PublicKeyResponse`" + `
- ` + "`FastNearTxTransactionsResponse`" + ` / ` + "`FastNearTxReceiptResponse`" + ` / ` + "`FastNearTxBlocksResponse`" + `
- ` + "`FastNearTransfersQueryResponse`" + `
- ` + "`FastNearNeardataLastBlockFinalResponse`" + ` / ` + "`FastNearNeardataBlockChunkResponse`" + `
- ` + "`FastNearKvGetLatestKeyResponse`" + ` / ` + "`FastNearKvHistoryByAccountResponse`" + ` / ` + "`FastNearKvMultiResponse`" + `

### Low-level-first mental model

- ` + "`near.view(...)`" + ` is the direct RPC primitive for one contract view call.
- ` + "`near.queryAccount(...)`" + ` is the raw RPC account-state envelope.
- ` + "`near.tx.*`" + `, ` + "`near.api.v1.*`" + `, ` + "`near.transfers.*`" + `, ` + "`near.neardata.*`" + `, and ` + "`near.fastdata.kv.*`" + ` are the exact-control family namespaces.
- Reach for ` + "`near.recipes.*`" + ` when you want the smallest task helper instead of the raw family method.

### ` + "`near.recipes`" + `

- ` + "`near.recipes.viewContract`" + `
- ` + "`near.recipes.viewAccount`" + `
- ` + "`near.recipes.inspectTransaction`" + `
- ` + "`near.recipes.functionCall`" + `
- ` + "`near.recipes.transfer`" + `
- ` + "`near.recipes.connect`" + `
- ` + "`near.recipes.signMessage`" + `
- ` + "`near.recipes.list()`" + ` / ` + "`near.recipes.toJSON()`" + `

Recipe helper equivalence:

- ` + "`near.recipes.viewContract(...)`" + ` is the task helper over ` + "`near.view(...)`" + `.
- ` + "`near.recipes.viewAccount(...)`" + ` is the task helper over ` + "`near.queryAccount(...)`" + `.
- ` + "`near.recipes.inspectTransaction(...)`" + ` is the task helper over ` + "`near.tx.transactions(...)`" + `.

### Service namespaces

- ` + "`near.api.v1.accountFull`" + `, ` + "`near.api.v1.accountFt`" + `, ` + "`near.api.v1.accountNft`" + `, ` + "`near.api.v1.accountStaking`" + `, ` + "`near.api.v1.publicKey`" + `, ` + "`near.api.v1.publicKeyAll`" + `, ` + "`near.api.v1.ftTop`" + `
- ` + "`near.tx.transactions`" + `, ` + "`near.tx.receipt`" + `, ` + "`near.tx.account`" + `, ` + "`near.tx.block`" + `, ` + "`near.tx.blocks`" + `
- ` + "`near.transfers.query`" + `
- ` + "`near.neardata.lastBlockFinal`" + `, ` + "`near.neardata.lastBlockOptimistic`" + `, ` + "`near.neardata.block`" + `, ` + "`near.neardata.blockHeaders`" + `, ` + "`near.neardata.blockShard`" + `, ` + "`near.neardata.blockChunk`" + `, ` + "`near.neardata.blockOptimistic`" + `, ` + "`near.neardata.firstBlock`" + `, ` + "`near.neardata.health`" + `
- ` + "`near.fastdata.kv.getLatestKey`" + `, ` + "`near.fastdata.kv.getHistoryKey`" + `, ` + "`near.fastdata.kv.latestByAccount`" + `, ` + "`near.fastdata.kv.historyByAccount`" + `, ` + "`near.fastdata.kv.latestByPredecessor`" + `, ` + "`near.fastdata.kv.historyByPredecessor`" + `, ` + "`near.fastdata.kv.allByPredecessor`" + `, ` + "`near.fastdata.kv.multi`" + `

### ` + "`near.explain`" + `

- ` + "`near.explain.action`" + ` normalizes one action.
- ` + "`near.explain.tx`" + ` summarizes a signer, receiver, and action list.
- ` + "`near.explain.error`" + ` turns thrown RPC or wallet errors into stable JSON.

### Example: terminal-first view call

\`\`\`${viewTerminalSnippet.language}
${viewTerminalSnippet.code}
\`\`\`

${viewCurlSnippet ? `### Same question with curl + jq

\`\`\`${viewCurlSnippet.language}
${viewCurlSnippet.code}
\`\`\`
` : ""}

### Example: indexed transaction lookup with ` + "`near.tx`" + `

\`\`\`${inspectTerminalSnippet.language}
${inspectTerminalSnippet.code}
\`\`\`

### Example: exact-key lookup with ` + "`near.fastdata.kv`" + `

\`\`\`${kvTerminalSnippet.language}
${kvTerminalSnippet.code}
\`\`\`

### Access and chaining

- API key env var: ` + "`" + supportSurface.apiKeyEnvVar + "`" + `
- Hosted recipe catalog: ` + "`" + supportSurface.hostedCatalogUrl + "`" + `
- Hosted terminal wrapper: ` + "`" + supportSurface.hostedAgentEntry + "`" + `
- Free trial credits: ` + "`" + supportSurface.trialCreditsUrl + "`" + `

Release contract:

- npm publish updates ` + "`https://js.fastnear.com/near.js`" + ` through the package-backed redirect path.
- Hosted site deploy updates ` + "`agents.js`" + `, ` + "`near-node.mjs`" + `, ` + "`recipes.json`" + `, ` + "`llms.txt`" + `, and ` + "`llms-full.txt`" + `.

Set ` + "`" + supportSurface.apiKeyEnvVar + "`" + ` before running the authenticated snippets.

#### Discovery order

${supportSurface.discoveryOrder.map((entry) => `${entry.step}. ${entry.label} — ${entry.detail}`).join("\n")}

#### ${supportSurface.captureExample.title}

${supportSurface.captureExample.summary}

\`\`\`${supportSurface.captureExample.language}
${supportSurface.captureExample.code}
\`\`\`

${renderFamilySection()}

### Example: explain a transaction before signing

\`\`\`js
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
\`\`\`

Example output shape:

\`\`\`json
${explainEntry.example}
\`\`\`
`;
}

function renderWalletReadmeSection() {
  const connectRecipe = recipeCatalog.find((recipe) => recipe.id === "connect-wallet");
  const functionCallRecipe = recipeCatalog.find((recipe) => recipe.id === "function-call");
  const transferRecipe = recipeCatalog.find((recipe) => recipe.id === "transfer");
  const signMessageRecipe = recipeCatalog.find((recipe) => recipe.id === "sign-message");

  return `## Agent-first tasks

When you pair ` + "`@fastnear/wallet`" + ` with ` + "`@fastnear/api`" + `, the shortest task-oriented entrypoints are the wallet-backed recipes:

- ` + "`near.recipes.connect`" + `
- ` + "`near.recipes.functionCall`" + `
- ` + "`near.recipes.transfer`" + `
- ` + "`near.recipes.signMessage`" + `

### Connect a wallet

\`\`\`${connectRecipe.snippets[1].language}
${connectRecipe.snippets[1].code}
\`\`\`

### Send a function call

\`\`\`${functionCallRecipe.snippets[1].language}
${functionCallRecipe.snippets[1].code}
\`\`\`

### Transfer NEAR

\`\`\`${transferRecipe.snippets[1].language}
${transferRecipe.snippets[1].code}
\`\`\`

### Sign a message

\`\`\`${signMessageRecipe.snippets[1].language}
${signMessageRecipe.snippets[1].code}
\`\`\`
`;
}

function renderLlmsTxt() {
  return `# FastNear JS monorepo

Homepage: https://js.fastnear.com

Primary packages:
- @fastnear/api
- @fastnear/wallet
- @fastnear/utils

Low-level-first runtime surfaces:
- near.config({ apiKey })
- near.view
- near.queryAccount
- near.tx.transactions
- near.api.v1.accountFull
- near.transfers.query
- near.neardata.lastBlockFinal
- near.fastdata.kv.getLatestKey
- near.recipes.viewContract
- near.recipes.viewAccount
- near.recipes.inspectTransaction
- near.recipes.functionCall
- near.recipes.transfer
- near.recipes.connect
- near.recipes.signMessage
- near.recipes.list
- near.recipes.toJSON
- near.explain.action
- near.explain.tx
- near.explain.error

Named endpoint response types:
- FastNearRecipeDiscoveryEntry
- FastNearApiV1AccountFullResponse
- FastNearTxTransactionsResponse
- FastNearTransfersQueryResponse
- FastNearNeardataLastBlockFinalResponse
- FastNearKvGetLatestKeyResponse

Canonical machine-readable catalog:
- recipes/index.json
- ${FASTNEAR_RECIPE_CATALOG_ENTRY}

Canonical hosted agent wrapper:
- ${FASTNEAR_AGENT_ENTRY}

Wrapper source in repo:
- recipes/near-node.mjs

Mental model:
- Start with the low-level APIs when you know the exact FastNear family you want.
- Use near.recipes.* as compact task helpers layered on top of those lower-level APIs.
- Use near.recipes.list() or near.recipes.toJSON() when you want to discover the task helpers at runtime.

Trial credits / API keys:
- ${supportSurface.trialCreditsUrl}

Discovery order:
${supportSurface.discoveryOrder.map((entry) => `- ${entry.step}. ${entry.label}: ${entry.detail}`).join("\n")}

Families:
${generatedArtifact.families.map((family) => `- ${family.id}: ${family.summary} Best for ${family.bestFor.join(" / ")}.`).join("\n")}

Recipe index:
${recipeCatalog.map((recipe) => `- ${recipe.id}: ${recipe.title} (${recipe.service}, ${recipe.returns}, ${recipe.auth}, ${recipe.network})`).join("\n")}
`;
}

function renderLlmsFull() {
  return `# FastNear JS monorepo (full)

Prefer ` + "`recipes/index.json`" + ` when you need structured task data.

## Packages

- ` + "`@fastnear/api`" + `: low-level NEAR RPC and FastNear family APIs, plus ` + "`near.recipes`" + ` task helpers and ` + "`near.explain`" + `
- ` + "`@fastnear/wallet`" + `: wallet connection and transaction/signing provider
- ` + "`@fastnear/utils`" + `: units, crypto, serialization, storage helpers

## Unified config

- ` + "`near.config({ networkId })`" + `
- ` + "`near.config({ apiKey })`" + `
- ` + "`near.config({ nodeUrl })`" + `

## Named endpoint types

${renderList(generatedArtifact.runtimes.api.types.map((typeName) => `\`${typeName}\``))}

## Mental model

- Start with ` + "`near.view`" + `, ` + "`near.queryAccount`" + `, ` + "`near.tx.*`" + `, ` + "`near.api.v1.*`" + `, ` + "`near.transfers.*`" + `, ` + "`near.neardata.*`" + `, and ` + "`near.fastdata.kv.*`" + ` when you want exact control and raw family response shapes.
- Use ` + "`near.recipes.*`" + ` when you want the smallest task helper on top of those lower-level surfaces.
- Use ` + "`near.recipes.list()`" + ` or ` + "`near.recipes.toJSON()`" + ` when you want to discover the available task helpers at runtime.

## Family chooser

${generatedArtifact.families.map((family) => `### ${family.id}

${family.summary}

- Auth style: \`${family.authStyle}\`
- Default base URLs: mainnet \`${family.defaultBaseUrls.mainnet}\`, testnet \`${family.defaultBaseUrls.testnet}\`
- Pagination: ${renderPagination(family.pagination)}
- Best for:
${renderList(family.bestFor)}
- Entrypoints:
${renderList(family.entrypoints.map((entrypoint) => `\`${entrypoint}\``))}
`).join("\n\n")}

## Low-level API entrypoints

- ` + "`near.view`" + `
- ` + "`near.queryAccount`" + `
- ` + "`near.queryTx`" + `
- ` + "`near.sendTx`" + `
- ` + "`near.requestSignIn`" + `
- ` + "`near.signMessage`" + `
- ` + "`near.api.v1.accountFull`" + ` / ` + "`accountFt`" + ` / ` + "`accountNft`" + ` / ` + "`accountStaking`" + ` / ` + "`publicKey`" + ` / ` + "`publicKeyAll`" + ` / ` + "`ftTop`" + `
- ` + "`near.tx.transactions`" + ` / ` + "`receipt`" + ` / ` + "`account`" + ` / ` + "`block`" + ` / ` + "`blocks`" + `
- ` + "`near.transfers.query`" + `
- ` + "`near.neardata.lastBlockFinal`" + ` / ` + "`lastBlockOptimistic`" + ` / ` + "`block`" + ` / ` + "`blockHeaders`" + ` / ` + "`blockShard`" + ` / ` + "`blockChunk`" + ` / ` + "`blockOptimistic`" + ` / ` + "`firstBlock`" + ` / ` + "`health`" + `
- ` + "`near.fastdata.kv.getLatestKey`" + ` / ` + "`getHistoryKey`" + ` / ` + "`latestByAccount`" + ` / ` + "`historyByAccount`" + ` / ` + "`latestByPredecessor`" + ` / ` + "`historyByPredecessor`" + ` / ` + "`allByPredecessor`" + ` / ` + "`multi`" + `

## Access and chaining

- API key env var: ` + "`" + supportSurface.apiKeyEnvVar + "`" + `
- Hosted recipe catalog: ` + "`" + supportSurface.hostedCatalogUrl + "`" + `
- Hosted terminal wrapper: ` + "`" + supportSurface.hostedAgentEntry + "`" + `
- Free trial credits: ` + "`" + supportSurface.trialCreditsUrl + "`" + `

Set ` + "`" + supportSurface.apiKeyEnvVar + "`" + ` before running the authenticated snippets.

### Discovery order

${supportSurface.discoveryOrder.map((entry) => `${entry.step}. ${entry.label} — ${entry.detail}`).join("\n")}

### ${supportSurface.captureExample.title}

${supportSurface.captureExample.summary}

\`\`\`${supportSurface.captureExample.language}
${supportSurface.captureExample.code}
\`\`\`

## Recipe catalog

${recipeCatalog.map(renderRecipe).join("\n\n")}

## Explain surface

${explainSurface.map((entry) => `### ${entry.api}

${entry.summary}

\`\`\`json
${entry.example}
\`\`\``).join("\n\n")}
`;
}

function replaceBetweenMarkers(source, markerId, replacement) {
  const startMarker = `<!-- BEGIN GENERATED:${markerId} -->`;
  const endMarker = `<!-- END GENERATED:${markerId} -->`;

  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Missing markers for ${markerId}`);
  }

  const before = source.slice(0, startIndex + startMarker.length);
  const after = source.slice(endIndex);
  return `${before}\n${replacement.trim()}\n${after}`;
}

function queueWrite(relativePath, content) {
  filesToWrite.set(path.resolve(repoRoot, relativePath), content);
}

function queueGeneratedReadme(relativePath, markerId, renderer) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const source = readFileSync(absolutePath, "utf8");
  queueWrite(relativePath, replaceBetweenMarkers(source, markerId, renderer()));
}

assertCatalogContract();

queueWrite("recipes/index.json", `${JSON.stringify(generatedArtifact, null, 2)}\n`);
queueWrite("llms.txt", `${renderLlmsTxt()}\n`);
queueWrite("llms-full.txt", `${renderLlmsFull()}\n`);

queueGeneratedReadme("README.md", "agent-quickstart", renderRootReadmeSection);
queueGeneratedReadme("packages/api/README.md", "agent-api-surface", renderApiReadmeSection);
queueGeneratedReadme("packages/wallet/README.md", "agent-wallet-surface", renderWalletReadmeSection);

let hasDiff = false;

for (const [absolutePath, nextContent] of filesToWrite) {
  let currentContent = null;
  try {
    currentContent = readFileSync(absolutePath, "utf8");
  } catch {
    currentContent = null;
  }
  if (currentContent !== nextContent) {
    hasDiff = true;
    if (!checkOnly) {
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, nextContent);
    }
  }
}

if (checkOnly && hasDiff) {
  console.error("Generated agent artifacts are out of date. Run: node scripts/generate-agent-artifacts.mjs");
  process.exit(1);
}
