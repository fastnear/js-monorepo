import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const packages = [
  ["borsh", "NearBorsh"],
  ["borsh-schema", "NearBorshSchema"],
  ["utils", "NearUtils"],
  ["api", "near"],
  ["wallet-adapter", "nearWalletAdapters"],
  ["wallet", "nearWallet"],
  ["ml-dsa-65", "NearMlDsa65"],
];

function runtimeKeys(namespace) {
  return Object.keys(namespace).filter((key) => key !== "default").sort();
}

function createBrowserSandbox() {
  const storage = new Map();
  const sandbox = {
    console,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Uint8Array,
    ArrayBuffer,
    DataView,
    setTimeout,
    clearTimeout,
    crypto: globalThis.crypto,
    fetch: globalThis.fetch,
    navigator: { userAgent: "fastnear-format-smoke" },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
      clear: () => storage.clear(),
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  return sandbox;
}

for (const [directory, globalName] of packages) {
  const packageRoot = path.join(repoRoot, "packages", directory);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const cjs = require(path.resolve(packageRoot, manifest.main));
  const esm = await import(`${pathToFileURL(path.resolve(packageRoot, manifest.module)).href}?smoke=1`);
  const cjsKeys = runtimeKeys(cjs);
  const esmKeys = runtimeKeys(esm);

  if (cjsKeys.length === 0 || esmKeys.length === 0) {
    throw new Error(`${manifest.name} exposed no runtime exports`);
  }
  if (JSON.stringify(cjsKeys) !== JSON.stringify(esmKeys)) {
    throw new Error(
      `${manifest.name} CJS/ESM export mismatch\nCJS=${JSON.stringify(cjsKeys)}\nESM=${JSON.stringify(esmKeys)}`,
    );
  }

  const browserPath = path.resolve(packageRoot, manifest.browser);
  const browserSource = await readFile(browserPath, "utf8");
  const sandbox = createBrowserSandbox();
  vm.runInNewContext(browserSource, sandbox, { filename: browserPath });
  if (!sandbox[globalName]) {
    throw new Error(`${manifest.name} IIFE did not expose globalThis.${globalName}`);
  }

  console.log(`${manifest.name}: CJS, ESM, and IIFE OK (${cjsKeys.length} exports)`);
}
