import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const packages = [
  { directory: "borsh", globalName: "NearBorsh" },
  { directory: "borsh-schema", globalName: "NearBorshSchema" },
  { directory: "utils", globalName: "NearUtils" },
  { directory: "api", globalName: "near" },
  { directory: "wallet-adapter", globalName: "nearWalletAdapters" },
  { directory: "wallet", globalName: "nearWallet" },
  { directory: "ml-dsa-65", globalName: "NearMlDsa65" },
  {
    directory: "x402",
    globalName: "nearX402",
    probes: [
      "createFastNearWalletSigner",
      "createNearPaymentFetch",
      "createNearX402Client",
    ],
    subpaths: [
      { exportPath: "./node", probes: ["createLocalNearSigner"] },
      { exportPath: "./server", probes: ["createNearResourceServer"] },
      { exportPath: "./facilitator", probes: ["createNearFacilitator"] },
    ],
  },
];

function runtimeKeys(namespace) {
  return Object.keys(namespace).filter((key) => key !== "default").sort();
}

function resolveExportTarget(manifest, exportPath, condition) {
  let target = manifest.exports?.[exportPath];
  while (target && typeof target === "object") {
    target = target[condition] ?? target.default;
  }
  if (typeof target !== "string") {
    throw new Error(
      `${manifest.name} is missing a ${condition} target for export ${exportPath}`,
    );
  }
  return target;
}

function assertProbes(namespace, probes, label) {
  for (const probe of probes ?? []) {
    if (namespace[probe] === undefined) {
      throw new Error(`${label} did not expose ${probe}`);
    }
  }
}

async function smokeModulePair(packageRoot, manifest, exportPath, probes) {
  const requireTarget = exportPath === "."
    ? manifest.main
    : resolveExportTarget(manifest, exportPath, "require");
  const importTarget = exportPath === "."
    ? manifest.module
    : resolveExportTarget(manifest, exportPath, "import");
  const typesTarget = exportPath === "."
    ? manifest.types
    : resolveExportTarget(manifest, exportPath, "types");
  const label = exportPath === "."
    ? manifest.name
    : `${manifest.name}/${exportPath.slice(2)}`;
  const cjs = require(path.resolve(packageRoot, requireTarget));
  const esm = await import(
    `${pathToFileURL(path.resolve(packageRoot, importTarget)).href}?smoke=1`
  );
  await readFile(path.resolve(packageRoot, typesTarget));
  const cjsKeys = runtimeKeys(cjs);
  const esmKeys = runtimeKeys(esm);

  if (cjsKeys.length === 0 || esmKeys.length === 0) {
    throw new Error(`${label} exposed no runtime exports`);
  }
  if (JSON.stringify(cjsKeys) !== JSON.stringify(esmKeys)) {
    throw new Error(
      `${label} CJS/ESM export mismatch\nCJS=${JSON.stringify(cjsKeys)}\nESM=${JSON.stringify(esmKeys)}`,
    );
  }
  assertProbes(cjs, probes, `${label} CJS`);
  assertProbes(esm, probes, `${label} ESM`);

  return cjsKeys.length;
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
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    Response: globalThis.Response,
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

async function smokeX402BrowserPayment(sandbox) {
  if (sandbox.Buffer !== undefined) {
    throw new Error("x402 browser smoke must run without Node Buffer");
  }
  const borsh = require(path.join(repoRoot, "packages/borsh/dist/cjs/index.cjs"));
  const { nearChainSchema } = require(
    path.join(repoRoot, "packages/borsh-schema/dist/cjs/index.cjs"),
  );
  const { encodePaymentRequiredHeader } = require("@x402/core/http");
  const requirements = {
    scheme: "exact",
    network: "near:testnet",
    asset: "usdc.fakes.testnet",
    amount: "10",
    payTo: "seller.testnet",
    maxTimeoutSeconds: 300,
    extra: {},
  };
  const signedDelegate = Buffer.from(borsh.serialize(nearChainSchema.SignedDelegate, {
    delegateAction: {
      senderId: "payer.testnet",
      receiverId: requirements.asset,
      actions: [{
        functionCall: {
          methodName: "ft_transfer",
          args: Array.from(new TextEncoder().encode(
            '{"receiver_id":"seller.testnet","amount":"10"}',
          )),
          gas: 30_000_000_000_000n,
          deposit: 1n,
        },
      }],
      nonce: 1n,
      maxBlockHeight: 1_300n,
      publicKey: {
        ed25519Key: {
          data: Array.from(Buffer.from(
            "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=",
            "base64",
          )),
        },
      },
    },
    signature: {
      ed25519Signature: {
        data: Array.from(Buffer.from(
          "42EtRVHPX77f3XvCQD4bU00PtAAwcKPaXrLmJUG58mGZLkG7ngZ9JsXO/eYFL5ufW3agsXHfiEDjEEObnv9eBw==",
          "base64",
        )),
      },
    },
  })).toString("base64");
  const calls = [];
  const fetchMock = async (...args) => {
    calls.push(args);
    if (calls.length === 1) {
      return new Response(null, {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": encodePaymentRequiredHeader({
            x402Version: 2,
            resource: { url: "https://example.test/paid" },
            accepts: [requirements],
          }),
        },
      });
    }
    return new Response("paid", { status: 200 });
  };
  const wallet = {
    accountId: () => "payer.testnet",
    signDelegateActions: async () => ({
      signedDelegateActions: [{ borshSerializedBase64: signedDelegate }],
    }),
  };
  const signer = sandbox.nearX402.createFastNearWalletSigner({ wallet });
  const paidFetch = sandbox.nearX402.createNearPaymentFetch({
    signer,
    fetch: fetchMock,
    network: "near:testnet",
  });
  const response = await paidFetch("https://example.test/paid");
  if (await response.text() !== "paid" || calls.length !== 2) {
    throw new Error("x402 IIFE did not complete a bufferless paid-fetch retry");
  }
  const retriedRequest = calls[1][0];
  if (!(retriedRequest instanceof Request) || !retriedRequest.headers.get("PAYMENT-SIGNATURE")) {
    throw new Error("x402 IIFE retry did not include PAYMENT-SIGNATURE");
  }
}

for (const { directory, globalName, probes, subpaths = [] } of packages) {
  const packageRoot = path.join(repoRoot, "packages", directory);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const rootExportCount = await smokeModulePair(packageRoot, manifest, ".", probes);
  for (const subpath of subpaths) {
    await smokeModulePair(
      packageRoot,
      manifest,
      subpath.exportPath,
      subpath.probes,
    );
  }

  const browserPath = path.resolve(packageRoot, manifest.browser);
  const browserSource = await readFile(browserPath, "utf8");
  const sandbox = createBrowserSandbox();
  vm.runInNewContext(browserSource, sandbox, { filename: browserPath });
  if (!sandbox[globalName]) {
    throw new Error(`${manifest.name} IIFE did not expose globalThis.${globalName}`);
  }
  assertProbes(sandbox[globalName], probes, `${manifest.name} IIFE`);
  if (directory === "x402") {
    await smokeX402BrowserPayment(sandbox);
  }

  const subpathSummary = subpaths.length === 0
    ? ""
    : ` and ${subpaths.length} subpaths`;
  console.log(
    `${manifest.name}: CJS, ESM, and IIFE OK (${rootExportCount} root exports${subpathSummary})`,
  );
}
