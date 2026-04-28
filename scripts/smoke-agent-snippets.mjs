import { readFileSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const recipeIndex = JSON.parse(
  readFileSync(path.join(repoRoot, "recipes/index.json"), "utf8")
);
const rootReadme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
const packageReadme = readFileSync(path.join(repoRoot, "packages/api/README.md"), "utf8");
const expectedRecipeDiscovery = recipeIndex.recipes.map(({ id, api, title }) => ({
  id,
  api,
  title,
}));
const nearBundlePath = path.join(repoRoot, "packages/api/dist/umd/browser.global.js");
const wrapperPath = path.join(repoRoot, "recipes/near-node.mjs");
const nearBundleSource = readFileSync(nearBundlePath, "utf8");
const wrapperSource = readFileSync(wrapperPath, "utf8");

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed:\n${output}`);
  }

  return result.stdout.trim();
}

function replaceCdnBase(code, localBase) {
  return code.replaceAll("https://js.fastnear.com", localBase);
}

function extractMarkdownFences(text, language) {
  return [...text.matchAll(/```([a-z0-9-]+)?\n([\s\S]*?)```/gi)]
    .filter((match) => (match[1] || "").toLowerCase() === language)
    .map((match) => match[2].trim());
}

function collectExecutableBashExamples(label, text) {
  return extractMarkdownFences(text, "bash")
    .filter((code) => /agents\.js|curl -sS "|curl -sSL "|ACCOUNT_SUMMARY="\$\(/.test(code))
    .map((code, index) => ({
      label: `${label} example ${index + 1}`,
      code,
    }));
}

function assertNoApiKeyReset(label, text) {
  if (/(^|\n)FASTNEAR_API_KEY=\n/.test(text)) {
    throw new Error(`${label} still contains a copy-paste snippet that clears FASTNEAR_API_KEY`);
  }
}

async function startAssetServer() {
  const serverScript = `
const fs = require("node:fs");
const http = require("node:http");
const nearSource = fs.readFileSync(${JSON.stringify(nearBundlePath)}, "utf8");
const wrapperSource = fs.readFileSync(${JSON.stringify(wrapperPath)}, "utf8");
const server = http.createServer((request, response) => {
  if (request.url === "/near.js") {
    response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    response.end(nearSource);
    return;
  }
  if (request.url === "/near-node.mjs" || request.url === "/agents.js") {
    response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    response.end(wrapperSource);
    return;
  }
  response.writeHead(404);
  response.end("not found");
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(String(address.port));
});
`;

  const child = spawn("node", ["-e", serverScript], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const port = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const trimmed = stdout.trim();
      if (trimmed) {
        resolve(Number(trimmed));
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      reject(new Error(`Asset server exited before startup (${code}): ${stderr}`));
    });
  });

  return {
    child,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

function browserHarness(scriptBody) {
  return `
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
  clear() {},
};
const vm = require("node:vm");
const fs = require("node:fs");
const nearSource = fs.readFileSync(${JSON.stringify(nearBundlePath)}, "utf8");
vm.runInThisContext(nearSource, { filename: "near.js" });
(async () => {
${scriptBody}
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
}

function stubHarness(scriptBody) {
  return `
const calls = [];
globalThis.window = { location: { host: "js.fastnear.com" } };
globalThis.near = {
  utils: {
    convertUnit(value) {
      return String(value);
    },
  },
  print(value) {
    if (value === undefined) {
      return;
    }
    if (typeof value === "string") {
      console.log(value);
      return;
    }
    console.log(JSON.stringify(value));
  },
  recipes: {
    connect: async (params) => {
      calls.push({ method: "connect", params });
      return { accountId: "root.near" };
    },
    functionCall: async (params) => {
      calls.push({ method: "functionCall", params });
      return { ok: true };
    },
    transfer: async (params) => {
      calls.push({ method: "transfer", params });
      return { ok: true };
    },
    signMessage: async (params) => {
      calls.push({ method: "signMessage", params: { ...params, nonce: Array.from(params.nonce) } });
      return { signature: "ed25519:test" };
    },
  },
  selected() {
    return { account: "root.near" };
  },
};
(async () => {
${scriptBody}
  console.log(JSON.stringify(calls));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
}

async function main() {
  const { child, baseUrl } = await startAssetServer();

  try {
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

    if (recipeIndex.version !== 4) {
      throw new Error(`Expected recipe catalog version 4, received ${recipeIndex.version}`);
    }

    if (!Array.isArray(recipeIndex.families) || recipeIndex.families.length < 6) {
      throw new Error("Expected recipe catalog to include rich top-level family metadata");
    }

    for (const recipe of recipeIndex.recipes) {
      for (const field of requiredRecipeFields) {
        if (!(field in recipe)) {
          throw new Error(`Recipe ${recipe.id} is missing required discovery field ${field}`);
        }
      }
    }

    const viewRecipe = recipeIndex.recipes.find((recipe) => recipe.id === "view-contract");
    const viewAccountRecipe = recipeIndex.recipes.find((recipe) => recipe.id === "view-account");
    const inspectRecipe = recipeIndex.recipes.find((recipe) => recipe.id === "inspect-transaction");
    const accountFullRecipe = recipeIndex.recipes.find((recipe) => recipe.id === "account-full");
    const transfersRecipe = recipeIndex.recipes.find((recipe) => recipe.id === "transfers-query");
    const neardataRecipe = recipeIndex.recipes.find((recipe) => recipe.id === "last-block-final");
    const kvRecipe = recipeIndex.recipes.find((recipe) => recipe.id === "kv-latest-key");
    const connectRecipe = recipeIndex.recipes.find((recipe) => recipe.id === "connect-wallet");
    const functionCallRecipe = recipeIndex.recipes.find((recipe) => recipe.id === "function-call");
    const transferRecipe = recipeIndex.recipes.find((recipe) => recipe.id === "transfer");
    const signMessageRecipe = recipeIndex.recipes.find((recipe) => recipe.id === "sign-message");

    const viewTerminalSnippet = replaceCdnBase(
      viewRecipe.snippets.find((snippet) => snippet.id === "terminal").code,
      baseUrl
    );
    const inspectTerminalSnippet = replaceCdnBase(
      inspectRecipe.snippets.find((snippet) => snippet.id === "terminal").code,
      baseUrl
    );
    const kvTerminalSnippet = replaceCdnBase(
      kvRecipe.snippets.find((snippet) => snippet.id === "terminal").code,
      baseUrl
    );
    const captureExampleSnippet = replaceCdnBase(recipeIndex.support.captureExample.code, baseUrl);
    const curlJqViewSnippet = viewRecipe.snippets.find((snippet) => snippet.id === "curl-jq").code;
    const curlJqInspectSnippet = inspectRecipe.snippets.find((snippet) => snippet.id === "curl-jq").code;
    const curlJqAccountFullSnippet = accountFullRecipe.snippets.find((snippet) => snippet.id === "curl-jq").code;
    const curlJqTransfersSnippet = transfersRecipe.snippets.find((snippet) => snippet.id === "curl-jq").code;
    const curlJqNeardataSnippet = neardataRecipe.snippets.find((snippet) => snippet.id === "curl-jq").code;
    const curlJqKvSnippet = kvRecipe.snippets.find((snippet) => snippet.id === "curl-jq").code;

    const terminalEnv = { ...process.env, FASTNEAR_CDN_BASE: baseUrl };
    const readmeExamples = [
      ...collectExecutableBashExamples("root README", rootReadme),
      ...collectExecutableBashExamples("package README", packageReadme),
    ];

    const readOnlyRecipes = [
      viewRecipe,
      viewAccountRecipe,
      inspectRecipe,
      accountFullRecipe,
      transfersRecipe,
      neardataRecipe,
      kvRecipe,
    ];

    if (readOnlyRecipes.some((recipe) => recipe.snippets.some((snippet) => snippet.language === "js" && /\bjq\b/.test(snippet.code)))) {
      throw new Error("JS recipe snippets must not depend on jq");
    }
    if (readOnlyRecipes.some((recipe) => recipe.snippets.some((snippet) => snippet.language === "js" && /https?:\/\/[^"\s]+/.test(snippet.code)))) {
      throw new Error("JS recipe snippets must not manually assemble base URLs");
    }
    if (readOnlyRecipes.some((recipe) => recipe.snippets.some((snippet) => snippet.language === "js" && !snippet.code.includes("near.print(")))) {
      throw new Error("JS recipe snippets should use near.print(...) for output");
    }
    if (readOnlyRecipes.some((recipe) => recipe.snippets.some((snippet) => snippet.environment === "terminal" && snippet.code.includes('near.config({ apiKey: process.env.FASTNEAR_API_KEY || undefined });')))) {
      throw new Error("Terminal snippets should rely on agents.js for FASTNEAR_API_KEY configuration");
    }
    if (viewAccountRecipe.snippets.find((snippet) => snippet.id === "terminal").code.includes(".result")) {
      throw new Error("Terminal viewAccount snippets must use the unwrapped recipe result");
    }
    if (!wrapperSource.includes("process.env.FASTNEAR_API_KEY") || !wrapperSource.includes("globalThis.near.config({ apiKey })")) {
      throw new Error("Terminal wrapper must auto-apply FASTNEAR_API_KEY when present");
    }
    assertNoApiKeyReset("recipes/index.json", JSON.stringify(recipeIndex));
    assertNoApiKeyReset("README.md", rootReadme);
    assertNoApiKeyReset("packages/api/README.md", packageReadme);

    const recipeDiscoveryOutput = runCommand("node", ["-e", browserHarness(`
const discovery = {
  list: near.recipes.list(),
  json: JSON.parse(JSON.stringify(near.recipes)),
  keys: Object.keys(near.recipes).sort(),
};
process.stdout.write(JSON.stringify(discovery));
`)]);
    const recipeDiscovery = JSON.parse(recipeDiscoveryOutput);

    if (typeof recipeDiscovery.list?.length !== "number") {
      throw new Error("Local near.js bundle should expose near.recipes.list()");
    }
    if (!recipeDiscovery.keys.includes("list") || !recipeDiscovery.keys.includes("toJSON")) {
      throw new Error(`Local near.js bundle is missing recipe discovery helpers: ${recipeDiscovery.keys.join(", ")}`);
    }
    if (JSON.stringify(recipeDiscovery.list) !== JSON.stringify(expectedRecipeDiscovery)) {
      throw new Error(
        `Runtime recipe discovery drifted from recipes/index.json.\nexpected=${JSON.stringify(expectedRecipeDiscovery)}\nactual=${JSON.stringify(recipeDiscovery.list)}`
      );
    }
    if (JSON.stringify(recipeDiscovery.json) !== JSON.stringify(expectedRecipeDiscovery)) {
      throw new Error(
        `near.recipes.toJSON() should match the compact recipe discovery list.\nexpected=${JSON.stringify(expectedRecipeDiscovery)}\nactual=${JSON.stringify(recipeDiscovery.json)}`
      );
    }

    const bashOutput = runCommand("bash", ["-lc", viewTerminalSnippet], {
      env: terminalEnv,
    });
    if (!bashOutput.includes('"account_id": "root.near"')) {
      throw new Error(`Terminal wrapper output missing expected account: ${bashOutput}`);
    }

    const wrapperApiKeyOutput = runCommand("bash", ["-lc", `node -e "$(curl -fsSL ${baseUrl}/agents.js)" <<'EOF'
near.print(near.config().apiKey);
EOF`], {
      env: { ...terminalEnv, FASTNEAR_API_KEY: "wrapper-key" },
    });
    if (wrapperApiKeyOutput.trim() !== "wrapper-key") {
      throw new Error(`Terminal wrapper did not auto-apply FASTNEAR_API_KEY: ${wrapperApiKeyOutput}`);
    }

    const wrapperOverrideOutput = runCommand("bash", ["-lc", `node -e "$(curl -fsSL ${baseUrl}/agents.js)" <<'EOF'
near.config({ apiKey: "manual-key" });
near.print(near.config().apiKey);
EOF`], {
      env: { ...terminalEnv, FASTNEAR_API_KEY: "wrapper-key" },
    });
    if (wrapperOverrideOutput.trim() !== "manual-key") {
      throw new Error(`Explicit near.config({ apiKey }) should override wrapper default: ${wrapperOverrideOutput}`);
    }

    const inspectOutput = runCommand("bash", ["-lc", inspectTerminalSnippet], {
      env: terminalEnv,
    });
    if (!inspectOutput.includes('"signer_id": "root.near"')) {
      throw new Error(`near.tx terminal snippet failed: ${inspectOutput}`);
    }

    const kvOutput = runCommand("bash", ["-lc", kvTerminalSnippet], {
      env: terminalEnv,
    });
    if (!kvOutput.includes('"current_account_id": "social.near"')) {
      throw new Error(`near.fastdata.kv terminal snippet failed: ${kvOutput}`);
    }

    const captureOutput = runCommand("bash", ["-lc", captureExampleSnippet], {
      env: terminalEnv,
    });
    if (!captureOutput.includes("block_hash=") || !captureOutput.includes("storage_usage=")) {
      throw new Error(`Capture example did not emit extracted fields: ${captureOutput}`);
    }

    const curlJqViewOutput = runCommand("bash", ["-lc", curlJqViewSnippet], {
      env: terminalEnv,
    });
    if (!curlJqViewOutput.includes('"account_id": "root.near"')) {
      throw new Error(`curl + jq view snippet failed: ${curlJqViewOutput}`);
    }

    const curlJqInspectOutput = runCommand("bash", ["-lc", curlJqInspectSnippet], {
      env: terminalEnv,
    });
    if (!curlJqInspectOutput.includes('"signer_id": "root.near"')) {
      throw new Error(`curl + jq inspect snippet failed: ${curlJqInspectOutput}`);
    }

    const curlJqAccountFullOutput = runCommand("bash", ["-lc", curlJqAccountFullSnippet], {
      env: terminalEnv,
    });
    if (!curlJqAccountFullOutput.includes('"account_id": "root.near"')) {
      throw new Error(`curl + jq account-full snippet failed: ${curlJqAccountFullOutput}`);
    }

    const curlJqTransfersOutput = runCommand("bash", ["-lc", curlJqTransfersSnippet], {
      env: terminalEnv,
    });
    if (!curlJqTransfersOutput.includes('"recent"')) {
      throw new Error(`curl + jq transfers snippet failed: ${curlJqTransfersOutput}`);
    }

    const curlJqNeardataOutput = runCommand("bash", ["-lc", curlJqNeardataSnippet], {
      env: terminalEnv,
    });
    if (!curlJqNeardataOutput.includes('"height"')) {
      throw new Error(`curl + jq neardata snippet failed: ${curlJqNeardataOutput}`);
    }

    const curlJqKvOutput = runCommand("bash", ["-lc", curlJqKvSnippet], {
      env: terminalEnv,
    });
    if (!curlJqKvOutput.includes('"current_account_id": "social.near"')) {
      throw new Error(`curl + jq kv snippet failed: ${curlJqKvOutput}`);
    }

    const browserViewOutput = runCommand("node", ["-e", browserHarness(viewRecipe.snippets.find((snippet) => snippet.id === "browser-global").code)]);
    if (!browserViewOutput.includes('"account_id": "root.near"')) {
      throw new Error(`Browser-global view snippet failed: ${browserViewOutput}`);
    }

    const browserInspectOutput = runCommand("node", ["-e", browserHarness(inspectRecipe.snippets.find((snippet) => snippet.id === "browser-global").code)]);
    if (!browserInspectOutput.includes('"signer_id": "root.near"')) {
      throw new Error(`Browser-global inspect snippet failed: ${browserInspectOutput}`);
    }

    const browserKvOutput = runCommand("node", ["-e", browserHarness(kvRecipe.snippets.find((snippet) => snippet.id === "browser-global").code)]);
    if (!browserKvOutput.includes('"current_account_id": "social.near"')) {
      throw new Error(`Browser-global kv snippet failed: ${browserKvOutput}`);
    }

    const stubConnectOutput = runCommand("node", ["-e", stubHarness(connectRecipe.snippets.find((snippet) => snippet.id === "browser-global").code)]);
    if (!stubConnectOutput.includes('"method":"connect"')) {
      throw new Error(`Browser-global connect snippet did not exercise connect: ${stubConnectOutput}`);
    }

    const stubFunctionCallOutput = runCommand("node", ["-e", stubHarness(functionCallRecipe.snippets.find((snippet) => snippet.id === "browser-global").code)]);
    if (!stubFunctionCallOutput.includes('"method":"functionCall"')) {
      throw new Error(`Browser-global functionCall snippet did not exercise functionCall: ${stubFunctionCallOutput}`);
    }

    const stubTransferOutput = runCommand("node", ["-e", stubHarness(transferRecipe.snippets.find((snippet) => snippet.id === "browser-global").code)]);
    if (!stubTransferOutput.includes('"method":"transfer"')) {
      throw new Error(`Browser-global transfer snippet did not exercise transfer: ${stubTransferOutput}`);
    }

    const stubSignMessageOutput = runCommand("node", ["-e", stubHarness(signMessageRecipe.snippets.find((snippet) => snippet.id === "browser-global").code)]);
    if (!stubSignMessageOutput.includes('"method":"signMessage"')) {
      throw new Error(`Browser-global signMessage snippet did not exercise signMessage: ${stubSignMessageOutput}`);
    }

    const uniqueReadmeExamples = [...new Map(
      readmeExamples.map((example) => [example.code, example])
    ).values()];

    for (const example of uniqueReadmeExamples) {
      const output = runCommand("bash", ["-lc", replaceCdnBase(example.code, baseUrl)], {
        env: terminalEnv,
      });
      if (!output.trim()) {
        throw new Error(`${example.label} did not produce any output`);
      }
    }

    const failureSnippet = `node -e "$(curl -fsSL ${baseUrl}/near-node.mjs)" <<'EOF'
await near.recipes.viewContract({
  contractId: "does-not-exist.near",
  methodName: "get_account",
});
EOF`;
    const failureResult = spawnSync("bash", ["-lc", failureSnippet], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, FASTNEAR_CDN_BASE: baseUrl },
    });

    if (failureResult.status === 0) {
      throw new Error("Expected failing terminal wrapper snippet to exit non-zero");
    }
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
