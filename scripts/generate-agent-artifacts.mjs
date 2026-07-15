import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FASTNEAR_AGENT_ENTRY,
  FASTNEAR_RECIPE_CATALOG_ENTRY,
  generatedArtifact,
  recipeCatalog,
  explainSurface,
  mlDsa65Surface,
  x402Surface,
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
  if (generatedArtifact.version !== 5) {
    throw new Error(`Expected generated artifact version 5, received ${generatedArtifact.version}`);
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

  if (mlDsa65Surface.protocolVersion !== 85) {
    throw new Error(`Expected ML-DSA-65 protocol version 85, received ${mlDsa65Surface.protocolVersion}`);
  }
  if (mlDsa65Surface.quickstarts.length !== 4) {
    throw new Error("Expected four ML-DSA-65 quickstarts");
  }
  for (const quickstart of mlDsa65Surface.quickstarts) {
    for (const field of ["id", "title", "summary", "language", "code"]) {
      if (!(field in quickstart)) {
        throw new Error(`ML-DSA-65 quickstart ${quickstart.id ?? "<unknown>"} is missing required field ${field}`);
      }
    }
  }

  if (x402Surface.package !== "@fastnear/x402" || x402Surface.browserGlobal !== "nearX402") {
    throw new Error("Expected canonical @fastnear/x402 package and browser global metadata");
  }
  if (x402Surface.entrypoints.length !== 4) {
    throw new Error("Expected four focused @fastnear/x402 entrypoints");
  }
  if (x402Surface.chooseByTask.length !== 5 || x402Surface.quickstarts.length !== 2) {
    throw new Error("Expected the x402 task chooser and two focused quickstarts");
  }

  const expectedX402Entrypoints = new Map([
    [
      "@fastnear/x402",
      ["createFastNearWalletSigner", "createNearX402Client", "createNearPaymentFetch"],
    ],
    ["@fastnear/x402/node", ["createLocalNearSigner"]],
    ["@fastnear/x402/server", ["createNearResourceServer"]],
    ["@fastnear/x402/facilitator", ["createNearFacilitator"]],
  ]);
  for (const [subpath, expectedExports] of expectedX402Entrypoints) {
    const entrypoint = x402Surface.entrypoints.find(entry => entry.subpath === subpath);
    if (!entrypoint || JSON.stringify(entrypoint.exports) !== JSON.stringify(expectedExports)) {
      throw new Error(`Expected canonical x402 exports for ${subpath}`);
    }
  }

  const expectedX402Tasks = new Map([
    ["Pay an x402 URL from Node.js", ["createLocalNearSigner", "createNearPaymentFetch"]],
    ["Pay an x402 URL from a browser wallet", ["createFastNearWalletSigner", "createNearPaymentFetch"]],
    ["Protect a seller resource", ["createNearResourceServer"]],
    ["Operate a NEAR facilitator", ["createNearFacilitator"]],
    ["Integrate below the paid-fetch helper", ["createNearX402Client"]],
  ]);
  for (const [task, expectedFactories] of expectedX402Tasks) {
    const choice = x402Surface.chooseByTask.find(item => item.task === task);
    if (!choice || JSON.stringify(choice.use) !== JSON.stringify(expectedFactories)) {
      throw new Error(`Expected canonical x402 task mapping for ${task}`);
    }
  }

  const quickstartIds = new Set(x402Surface.quickstarts.map(quickstart => quickstart.id));
  for (const id of ["x402-node-paid-fetch", "x402-remote-facilitator-seller"]) {
    if (!quickstartIds.has(id)) {
      throw new Error(`Expected x402 quickstart ${id}`);
    }
  }
  for (const phrase of ["Only x402 v2 exact", "NEP-141", "explicit facilitator"]) {
    if (!x402Surface.constraints.some(constraint => constraint.includes(phrase))) {
      throw new Error(`Expected x402 constraint containing ${phrase}`);
    }
  }
  if (!/^https:\/\/.+/.test(x402Surface.guideUrl)) {
    throw new Error("Expected an absolute x402 package guide URL");
  }
  for (const feature of ["signDelegateActions", "signDelegateActionsWithTtl"]) {
    if (!x402Surface.walletFeatures.includes(feature)) {
      throw new Error(`Expected x402 wallet feature ${feature}`);
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

function renderMlDsa65Section({ headingLevel = 3 } = {}) {
  const heading = "#".repeat(headingLevel);
  const subheading = "#".repeat(headingLevel + 1);

  return `${heading} ML-DSA-65 account-key quickstarts

The opt-in \`${mlDsa65Surface.package}\` package provides protocol-v${mlDsa65Surface.protocolVersion} account access keys and transaction signatures without pulling the post-quantum backend into \`@fastnear/api\` or \`@fastnear/utils\`.

- Runtime: ${mlDsa65Surface.runtime}.
- Scope: ${mlDsa65Surface.scope}
- Exact byte lengths: seed ${mlDsa65Surface.sizes.seed}, public key ${mlDsa65Surface.sizes.publicKey}, expanded secret key ${mlDsa65Surface.sizes.expandedSecretKey}, signature ${mlDsa65Surface.sizes.signature}.
- Verification charge: ${mlDsa65Surface.verificationCharge.display} (${mlDsa65Surface.verificationCharge.gas} gas) for ${mlDsa65Surface.verificationCharge.appliesTo}.
- Full key: \`${mlDsa65Surface.keyForms.full}\`; list handle: \`${mlDsa65Surface.keyForms.handle}\`.
- Handle derivation: ${mlDsa65Surface.keyForms.derivation}; domain tag \`${mlDsa65Surface.keyForms.domainTag}\`.

${mlDsa65Surface.keyForms.rule}

${subheading} Safety constraints

${renderList(mlDsa65Surface.safety)}

${mlDsa65Surface.quickstarts.map((quickstart) => `${subheading} ${quickstart.title}

Recipe ID: \`${quickstart.id}\`

${quickstart.summary}

\`\`\`${quickstart.language}
${quickstart.code}
\`\`\``).join("\n\n")}`;
}

function renderX402Section({ headingLevel = 3 } = {}) {
  const heading = "#".repeat(headingLevel);
  const subheading = "#".repeat(headingLevel + 1);

  return `${heading} x402 payments on NEAR

\`${x402Surface.package}\` adapts the official x402 Foundation NEAR mechanism without introducing another wire format.

- Protocol: x402 v${x402Surface.protocol.version} \`${x402Surface.protocol.scheme}\` on ${x402Surface.protocol.networks.map(network => `\`${network}\``).join(" and ")}.
- Authorization: ${x402Surface.protocol.authorization}; asset: ${x402Surface.protocol.paymentAsset}.
- Browser global: \`${x402Surface.browserGlobal}\`.
- Runtime: ${x402Surface.runtime}
- Browser status: ${x402Surface.browserStatus}
- Required wallet features: ${x402Surface.walletFeatures.map(feature => `\`${feature}\``).join(" and ")}.
- Package guide: [${x402Surface.guideUrl}](${x402Surface.guideUrl}).

${subheading} Choose by task

${renderList(x402Surface.chooseByTask.map(choice => `${choice.task}: ${choice.use.map(name => `\`${name}\``).join(" + ")} from ${choice.imports.map(name => `\`${name}\``).join(" and ")} — ${choice.status}.`))}

${subheading} Entrypoints

${renderList(x402Surface.entrypoints.map(entry => `\`${entry.subpath}\`: ${entry.exports.map(name => `\`${name}\``).join(", ")} — ${entry.purpose}.`))}

${subheading} Constraints

${renderList(x402Surface.constraints)}

${subheading} Safe defaults

${renderList(x402Surface.safeDefaults)}

${x402Surface.quickstarts.map(quickstart => `${subheading} ${quickstart.title}

Quickstart ID: \`${quickstart.id}\`

${quickstart.summary}

\`\`\`${quickstart.language}
${quickstart.code}
\`\`\``).join("\n\n")}`;
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

function renderResilienceSection(headingPrefix = "###") {
  const h = headingPrefix;
  return `${h} Resilience and bulk reads

\`@fastnear/api\` retries transient RPC failures (HTTP 408/429/500/502/503/504 and JSON-RPC \`-429\`/\`-32000\`) with full-jitter backoff, and exposes an explicit bulk read API. Both are configurable through \`near.config\` and are on by default.

**Retry** — \`near.config({ retry })\`:

- \`enabled\` (default \`true\`) — set \`false\` to restore single-attempt behavior.
- \`maxAttempts\` (\`5\`) — total attempts including the first.
- \`baseBackoffMs\` (\`250\`) / \`maxBackoffMs\` (\`30000\`) — full-jitter exponential backoff bounds.
- \`timeoutMs\` (\`15000\`) — per-attempt AbortController timeout (\`0\` disables it).
- \`respectRetryAfter\` (\`true\`) — honor a \`Retry-After\` header, capped at \`maxBackoffMs\`.
- \`writePolicy\` (\`"transport-only"\`) — how writes (\`send_tx\` / \`broadcast_tx_*\`) retry: \`"never"\`, \`"transport-only"\` (only pre-response transport/timeout errors, resending identical signed bytes — safe against double-apply), or \`"all"\`.

**Bulk reads** — concurrency-limited fan-out (NEAR RPC has no array batching, so calls are not merged into one request):

- \`near.batch(requests)\` — each \`{ method, params, useArchival?, network? }\` runs as its own retried call, at most \`batch.maxConcurrency\` (default \`30\`) in flight. Write methods are rejected per-item.
- \`near.view.many(specs)\` — the same fan-out for \`{ contractId, methodName, args?, argsBase64?, blockId? }\` view specs, decoding each ok result like \`near.view\`.
- \`near.config({ batch: { maxConcurrency: 30 } })\` tunes the in-flight cap.

Both return **settled** results in input order — one failing call never rejects the set:

\`\`\`js
const results = await near.view.many([
  { contractId: "token.near", methodName: "ft_balance_of", args: { account_id: "a.near" } },
  { contractId: "token.near", methodName: "ft_balance_of", args: { account_id: "b.near" } },
]);

for (const r of results) {
  if (r.status === "ok") near.print(r.result);
  else if (r.kind === "contract") console.warn("contract reverted:", r.error);
  else console.warn("infra error:", r.kind, r.error);
}
\`\`\`

Each error item carries a \`kind\` — \`"contract"\` (the contract method reverted or failed), \`"transport"\` (no HTTP response: network or timeout), \`"http"\` (non-2xx), or \`"rpc"\` (JSON-RPC error) — so application failures stay distinguishable from infrastructure ones without re-parsing. Thrown errors are \`FastNearRpcError\` instances exposing the same \`kind\`, plus \`status\`, \`code\`, \`data\`, and \`retryable\`.`;
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
- ` + "`near.batch(...)`" + ` and ` + "`near.view.many(...)`" + ` fan out many reads with settled, concurrency-capped results, and ` + "`near.config({ retry, batch })`" + ` tunes automatic 429/transient retry — both on by default. See the API package README for details.
- ` + "`@fastnear/x402`" + ` provides opt-in x402 v2 NEAR payment clients plus focused ` + "`/node`" + `, ` + "`/server`" + `, and ` + "`/facilitator`" + ` entrypoints; its browser-wallet path is a preview pending the timeout-aware wallet bridge.

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

${renderMlDsa65Section()}

${renderX402Section()}

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
- ` + "`near.config({ retry })`" + ` tunes or disables automatic 429/transient retry (see below).
- ` + "`near.config({ batch })`" + ` sets the bulk-read concurrency cap (see below).

${renderResilienceSection("###")}

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

${renderMlDsa65Section()}

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
- @fastnear/ml-dsa-65
- @fastnear/x402

Low-level-first runtime surfaces:
- near.config({ apiKey })
- near.config({ retry, batch }) — auto 429/transient retry + bulk-read concurrency cap, both on by default
- near.view
- near.view.many — bulk views, settled results, concurrency-capped
- near.batch — bulk RPC, settled results, per-item error kind (transport/http/rpc/contract)
- near.queryAccount
- near.queryAccessKey
- near.queryAccessKeyList
- near.queryProtocolVersion
- near.sendTx({ signer, signerId, ... })
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

ML-DSA-65 account-key surface:
- @fastnear/ml-dsa-65 generateSigner / signerFromSeed / signerFromSecretKey
- Protocol activation: active RPC protocol_version >= ${mlDsa65Surface.protocolVersion}
- Exact wire sizes: ${mlDsa65Surface.sizes.publicKey}-byte public key; ${mlDsa65Surface.sizes.signature}-byte signature
- Verification charge: ${mlDsa65Surface.verificationCharge.display} per outer or delegated verification
- Full access-key form: ${mlDsa65Surface.keyForms.full}
- Access-key-list form: ${mlDsa65Surface.keyForms.handle}
- Handle domain tag: ${mlDsa65Surface.keyForms.domainTag}
- Quickstarts: ${mlDsa65Surface.quickstarts.map(({ id }) => id).join(", ")}

Wallet runtime surfaces (@fastnear/wallet):
- nearWallet.connect({ network, contractId, manifest })
- nearWallet.disconnect({ network })
- nearWallet.restore({ network })
- nearWallet.sendTransaction({ receiverId, actions, network })
- nearWallet.sendTransactions({ transactions, network })
- nearWallet.signMessage({ message, recipient, nonce, network })
- nearWallet.signDelegateActions({ delegateActions: [{ ..., blockHeightTtl }], signerId, network }) — timeout-aware requests require signDelegateActionsWithTtl
- nearWallet.addFunctionCallKey({ contractId, methodNames, allowance, network })
- nearWallet.accountId({ network })
- nearWallet.isConnected({ network })
- nearWallet.connectedNetworks()
- nearWallet.switchNetwork(network)
- nearWallet.onConnect(handler)
- nearWallet.onDisconnect(handler)

x402 payment surface (@fastnear/x402):
- Runtime: ${x402Surface.runtime}
- Protocol: x402 v${x402Surface.protocol.version} ${x402Surface.protocol.scheme}; networks: ${x402Surface.protocol.networks.join(", ")}; asset: ${x402Surface.protocol.paymentAsset}
- Pay a URL in Node: ${x402Surface.chooseByTask[0].use.join(" + ")} (${x402Surface.chooseByTask[0].imports.join(" + ")})
- Protect a seller resource: ${x402Surface.chooseByTask[2].use.join(" + ")} (${x402Surface.chooseByTask[2].imports.join(" + ")}); explicit facilitator required
- Browser: ${x402Surface.entrypoints[0].exports.join(" / ")} (global ${x402Surface.browserGlobal})
- Node: @fastnear/x402/node ${x402Surface.entrypoints[1].exports.join(" / ")}
- Seller: @fastnear/x402/server ${x402Surface.entrypoints[2].exports.join(" / ")}; explicit facilitator required
- Self-hosted facilitator: @fastnear/x402/facilitator ${x402Surface.entrypoints[3].exports.join(" / ")}
- Wallet features: ${x402Surface.walletFeatures.join(" + ")}
- Status: ${x402Surface.browserStatus}
- Guide: ${x402Surface.guideUrl}

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

Result shapes:
- near.query* (queryAccount, queryBlock, queryAccessKey, queryTx) return the raw JSON-RPC envelope { jsonrpc, result, id } — read your data from the .result field.
- near.view, near.recipes.*, near.ft.*, near.nft.*, near.tx.*, near.api.v1.*, near.transfers.*, near.neardata.*, and near.fastdata.kv.* return the data shape directly (no envelope).

Trial credits / API keys:
- ${supportSurface.trialCreditsUrl}

Discovery order:
${supportSurface.discoveryOrder.map((entry) => `- ${entry.step}. ${entry.label}: ${entry.detail}`).join("\n")}

Families:
${generatedArtifact.families.map((family) => `- ${family.id}: ${family.summary} Best for ${family.bestFor.join(" / ")}.`).join("\n")}

Recipe index format: id: question (family, return type, auth style, default network)

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
- ` + "`@fastnear/ml-dsa-65`" + `: opt-in protocol-v85 ML-DSA-65 account-key generation, encoding, hashing, and transaction signing
- ` + "`@fastnear/x402`" + `: official x402 v2 NEAR adapters for paid fetch, local-key clients, resource servers, and facilitators

## Unified config

- ` + "`near.config({ networkId })`" + `
- ` + "`near.config({ apiKey })`" + `
- ` + "`near.config({ nodeUrl })`" + `
- ` + "`near.config({ retry })`" + `
- ` + "`near.config({ batch })`" + `

${renderResilienceSection("##")}

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

## Result shapes

- ` + "`near.query*`" + ` (` + "`queryAccount`" + `, ` + "`queryBlock`" + `, ` + "`queryAccessKey`" + `, ` + "`queryTx`" + `) are JSON-RPC passthroughs and return the raw envelope ` + "`{ jsonrpc, result, id }`" + ` — read your data from the ` + "`.result`" + ` field.
- ` + "`near.view`" + `, ` + "`near.recipes.*`" + `, ` + "`near.ft.*`" + `, ` + "`near.nft.*`" + ` and the indexed REST families (` + "`near.tx.*`" + `, ` + "`near.api.v1.*`" + `, ` + "`near.transfers.*`" + `, ` + "`near.neardata.*`" + `, ` + "`near.fastdata.kv.*`" + `) return the flat data shape directly. The recipes layer in particular is what flattens ` + "`near.queryAccount`" + ` results into ` + "`{ amount, block_height, storage_usage, ... }`" + ` for ` + "`near.recipes.viewAccount`" + `.

## Low-level API entrypoints

- ` + "`near.view`" + `
- ` + "`near.view.many`" + ` (bulk views; settled results)
- ` + "`near.batch`" + ` (bulk RPC; settled results)
- ` + "`near.queryAccount`" + `
- ` + "`near.queryAccessKey`" + `
- ` + "`near.queryAccessKeyList`" + `
- ` + "`near.queryProtocolVersion`" + `
- ` + "`near.queryTx`" + `
- ` + "`near.sendTx`" + `
- ` + "`near.requestSignIn`" + `
- ` + "`near.signMessage`" + `
- ` + "`near.api.v1.accountFull`" + ` / ` + "`accountFt`" + ` / ` + "`accountNft`" + ` / ` + "`accountStaking`" + ` / ` + "`publicKey`" + ` / ` + "`publicKeyAll`" + ` / ` + "`ftTop`" + `
- ` + "`near.tx.transactions`" + ` / ` + "`receipt`" + ` / ` + "`account`" + ` / ` + "`block`" + ` / ` + "`blocks`" + `
- ` + "`near.transfers.query`" + `
- ` + "`near.neardata.lastBlockFinal`" + ` / ` + "`lastBlockOptimistic`" + ` / ` + "`block`" + ` / ` + "`blockHeaders`" + ` / ` + "`blockShard`" + ` / ` + "`blockChunk`" + ` / ` + "`blockOptimistic`" + ` / ` + "`firstBlock`" + ` / ` + "`health`" + `
- ` + "`near.fastdata.kv.getLatestKey`" + ` / ` + "`getHistoryKey`" + ` / ` + "`latestByAccount`" + ` / ` + "`historyByAccount`" + ` / ` + "`latestByPredecessor`" + ` / ` + "`historyByPredecessor`" + ` / ` + "`allByPredecessor`" + ` / ` + "`multi`" + `

## Wallet entrypoints (` + "`@fastnear/wallet`" + `)

- ` + "`nearWallet.connect`" + ` / ` + "`disconnect`" + ` / ` + "`restore`" + `: open, close, or rehydrate a session per network. ` + "`connect({ network, contractId, manifest })`" + ` is the canonical entrypoint; ` + "`contractId`" + ` mints a function-call key scoped to that contract so zero-deposit calls sign silently.
- ` + "`nearWallet.sendTransaction({ receiverId, actions, network })`" + ` / ` + "`sendTransactions`" + `: dispatch one or many transactions through the connected wallet on the chosen network.
- ` + "`nearWallet.signMessage({ message, recipient, nonce, network })`" + `: NEP-413 message signing.
- ` + "`nearWallet.signDelegateActions({ delegateActions, signerId?, network? })`" + `: sign NEP-366 delegate actions for gasless relay-based flows. Each request may include ` + "`blockHeightTtl`" + `; using it requires a wallet that advertises ` + "`signDelegateActionsWithTtl`" + `. The canonical transport result is ` + "`{ borshSerializedBase64: string }`" + `, while legacy structured and bare-base64 results remain accepted during the bridge transition.
- ` + "`nearWallet.addFunctionCallKey({ contractId, methodNames, allowance, network })`" + ` (` + "`@fastnear/wallet@1.1.4+`" + `): grant a second function-call key on another contract after sign-in, so a follow-on zero-deposit call to that contract also signs silently.
- ` + "`nearWallet.accountId`" + ` / ` + "`isConnected`" + ` / ` + "`connectedNetworks`" + ` / ` + "`switchNetwork`" + `: per-network session inspection and the active-network cursor.
- ` + "`nearWallet.onConnect`" + ` / ` + "`onDisconnect`" + `: subscribe to session lifecycle.

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

${renderX402Section({ headingLevel: 2 })}

${renderMlDsa65Section({ headingLevel: 2 })}

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
