import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const localCatalog = JSON.parse(
  readFileSync(path.join(repoRoot, "recipes/index.json"), "utf8")
);

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

async function fetchAsset(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return {
    url,
    contentType: response.headers.get("content-type") ?? "",
    text: await response.text(),
  };
}

function assertNotHtmlAsset(label, asset) {
  const trimmed = asset.text.trimStart();

  if (
    asset.contentType.toLowerCase().includes("text/html") ||
    /^<!doctype html/i.test(trimmed) ||
    /^<html/i.test(trimmed)
  ) {
    throw new Error(
      `${label} returned HTML instead of an asset. Check the hosted-site deploy for ${asset.url}. Content-Type: ${asset.contentType || "unknown"}`
    );
  }
}

function assertEqualArrays(label, localValues, publicValues) {
  const localJoined = JSON.stringify(localValues);
  const publicJoined = JSON.stringify(publicValues);

  if (localJoined !== publicJoined) {
    throw new Error(`${label} drifted between local and public assets.\nlocal=${localJoined}\npublic=${publicJoined}`);
  }
}

function inspectNearBundle(bundleSource) {
  const sandbox = {
    console,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
      clear() {},
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  vm.runInNewContext(bundleSource, sandbox, { filename: "near.js" });

  return {
    hasRecipes: !!sandbox.near?.recipes,
    hasRecipeList: typeof sandbox.near?.recipes?.list === "function",
    recipeDiscovery: JSON.parse(JSON.stringify(sandbox.near?.recipes ?? null)),
  };
}

function runPublicTerminalSmoke() {
  const script = `node -e "$(curl -fsSL https://js.fastnear.com/agents.js)" <<'EOF'
const result = await near.recipes.viewContract({
  contractId: "berryclub.ek.near",
  methodName: "get_account",
  args: { account_id: "root.near" },
});

near.print({
  account_id: result.account_id,
  num_pixels: result.num_pixels,
});
EOF`;

  const result = spawnSync("bash", ["-lc", script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`Public terminal smoke failed:\n${output}`);
  }

  const output = result.stdout.trim();
  if (!output.includes('"account_id": "root.near"') || !output.includes('"num_pixels"')) {
    throw new Error(`Public terminal smoke returned an unexpected shape:\n${output}`);
  }
}

async function main() {
  const [nearAsset, agentsAsset, recipesAsset, llmsAsset] = await Promise.all([
    fetchAsset("https://js.fastnear.com/near.js"),
    fetchAsset("https://js.fastnear.com/agents.js"),
    fetchAsset("https://js.fastnear.com/recipes.json"),
    fetchAsset("https://js.fastnear.com/llms.txt"),
  ]);

  assertNotHtmlAsset("Public near.js", nearAsset);
  assertNotHtmlAsset("Public agents.js", agentsAsset);
  assertNotHtmlAsset("Public recipes.json", recipesAsset);
  assertNotHtmlAsset("Public llms.txt", llmsAsset);

  const nearSource = nearAsset.text;
  const agentsSource = agentsAsset.text;
  const recipesText = recipesAsset.text;
  const llmsText = llmsAsset.text;

  if (!agentsSource.includes("process.env.FASTNEAR_API_KEY") || !agentsSource.includes("globalThis.near.config({ apiKey })")) {
    throw new Error("Public agents.js is missing the FASTNEAR_API_KEY auto-config behavior");
  }

  if (!llmsText.includes("https://js.fastnear.com/recipes.json") || !llmsText.includes("https://js.fastnear.com/agents.js")) {
    throw new Error("Public llms.txt is missing the expected hosted discovery entries");
  }

  const publicNearBundle = inspectNearBundle(nearSource);
  if (!publicNearBundle.hasRecipes || !publicNearBundle.hasRecipeList) {
    throw new Error("Public near.js is missing near.recipes.list(); publish the latest @fastnear/api bundle before relying on hosted discovery");
  }

  const expectedRecipeDiscovery = localCatalog.recipes.map(({ id, api, title }) => ({ id, api, title }));
  assertEqualArrays("Runtime recipe discovery", expectedRecipeDiscovery, publicNearBundle.recipeDiscovery);

  let publicCatalog;
  try {
    publicCatalog = JSON.parse(recipesText);
  } catch (error) {
    const preview = recipesText.trimStart().slice(0, 160);
    throw new Error(
      `Public recipes.json did not parse as JSON. Check the hosted-site deploy for ${recipesAsset.url}. First bytes: ${JSON.stringify(preview)}`
    );
  }

  if (publicCatalog.version !== localCatalog.version) {
    throw new Error(`Public recipe catalog version ${publicCatalog.version} does not match local version ${localCatalog.version}`);
  }

  assertEqualArrays(
    "Recipe IDs",
    localCatalog.recipes.map((recipe) => recipe.id),
    publicCatalog.recipes.map((recipe) => recipe.id)
  );

  assertEqualArrays(
    "Family IDs",
    localCatalog.families.map((family) => family.id),
    publicCatalog.families.map((family) => family.id)
  );

  for (const recipe of publicCatalog.recipes) {
    for (const field of requiredRecipeFields) {
      if (!(field in recipe)) {
        throw new Error(`Public recipe ${recipe.id} is missing required field ${field}`);
      }
    }
  }

  runPublicTerminalSmoke();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
