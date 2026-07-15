import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import vm from "node:vm";

const EXACT_SEMVER =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const ROOT_FACTORIES = [
  "createFastNearWalletSigner",
  "createNearPaymentFetch",
  "createNearX402Client",
];

const SERVER_ONLY_FACTORIES = [
  "createLocalNearSigner",
  "createNearResourceServer",
  "createNearFacilitator",
];

const NODE_ENTRYPOINTS = [
  ["@fastnear/x402", ROOT_FACTORIES],
  ["@fastnear/x402/node", ["createLocalNearSigner"]],
  ["@fastnear/x402/server", ["createNearResourceServer"]],
  ["@fastnear/x402/facilitator", ["createNearFacilitator"]],
];

export function exactPublishedVersion(value) {
  if (typeof value !== "string" || !EXACT_SEMVER.test(value)) {
    throw new Error(
      "Published x402 verification requires one exact semver such as 1.5.0 or 1.5.0-beta.0",
    );
  }
  return value;
}

export function assertTarballIntegrity(tarball, integrity, shasum) {
  if (typeof integrity !== "string" || integrity.length === 0) {
    throw new Error("npm metadata is missing dist.integrity");
  }

  const supported = new Set(["sha256", "sha384", "sha512"]);
  const matchesIntegrity = integrity.split(/\s+/).some((entry) => {
    const separator = entry.indexOf("-");
    if (separator < 1) return false;
    const algorithm = entry.slice(0, separator);
    if (!supported.has(algorithm)) return false;
    const expected = entry.slice(separator + 1).split("?")[0];
    return createHash(algorithm).update(tarball).digest("base64") === expected;
  });
  if (!matchesIntegrity) {
    throw new Error("npm tarball bytes do not match dist.integrity");
  }

  if (
    typeof shasum === "string" &&
    createHash("sha1").update(tarball).digest("hex") !== shasum
  ) {
    throw new Error("npm tarball bytes do not match dist.shasum");
  }
}

function tarString(tar, offset, length) {
  const end = tar.indexOf(0, offset);
  const boundedEnd = end === -1 || end > offset + length ? offset + length : end;
  return tar.subarray(offset, boundedEnd).toString("utf8").trim();
}

export function extractTarEntry(tarball, expectedName) {
  const tar = gunzipSync(tarball);
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeSource = tarString(header, 124, 12);
    if (!/^[0-7]+$/.test(sizeSource)) {
      throw new Error(`Unsupported tar size for ${fullName || "unnamed entry"}`);
    }
    const size = Number.parseInt(sizeSource, 8);
    const contentsOffset = offset + 512;
    if (!Number.isSafeInteger(size) || contentsOffset + size > tar.length) {
      throw new Error(`Invalid tar entry size for ${fullName || "unnamed entry"}`);
    }
    if (fullName === expectedName) {
      return tar.subarray(contentsOffset, contentsOffset + size);
    }

    offset = contentsOffset + Math.ceil(size / 512) * 512;
  }

  throw new Error(`npm tarball is missing ${expectedName}`);
}

function exportTarget(manifest, exportPath, condition) {
  let target = manifest.exports?.[exportPath];
  while (target && typeof target === "object") {
    target = target[condition] ?? target.default;
  }
  if (typeof target !== "string") {
    throw new Error(
      `Published @fastnear/x402 is missing ${condition} for export ${exportPath}`,
    );
  }
  return target;
}

function assertPackedSurface(tarball, manifest, version) {
  if (manifest.name !== "@fastnear/x402" || manifest.version !== version) {
    throw new Error(
      `npm tarball identity mismatch: ${manifest.name ?? "unknown"}@${manifest.version ?? "unknown"}`,
    );
  }
  if (manifest.peerDependencies?.["@fastnear/wallet"] !== version) {
    throw new Error(
      "Published @fastnear/x402 wallet peer does not match its synchronized version",
    );
  }
  if (manifest.peerDependenciesMeta?.["@fastnear/wallet"]?.optional !== true) {
    throw new Error("Published @fastnear/x402 wallet peer is not optional");
  }
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (range === "*" || String(range).startsWith("workspace:")) {
      throw new Error(`Published @fastnear/x402 leaked dependency ${name}: ${range}`);
    }
  }

  const targets = new Set([
    manifest.main,
    manifest.module,
    manifest.types,
    manifest.browser,
  ]);
  for (const exportPath of [".", "./node", "./server", "./facilitator"]) {
    for (const condition of ["require", "import", "types"]) {
      targets.add(exportTarget(manifest, exportPath, condition));
    }
  }
  for (const target of targets) {
    if (typeof target !== "string" || !target.startsWith("./")) {
      throw new Error(`Published @fastnear/x402 has an invalid package target: ${target}`);
    }
    extractTarEntry(tarball, `package/${target.slice(2)}`);
  }
}

function inspectPublishedIife(source) {
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
    navigator: { userAgent: "fastnear-published-x402-smoke" },
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

  vm.runInNewContext(source, sandbox, { filename: "@fastnear/x402 IIFE" });
  const descriptor = Object.getOwnPropertyDescriptor(sandbox, "nearX402");
  if (!descriptor || descriptor.configurable !== false) {
    throw new Error("Published IIFE did not lock globalThis.nearX402");
  }
  for (const factory of ROOT_FACTORIES) {
    if (typeof sandbox.nearX402?.[factory] !== "function") {
      throw new Error(`Published IIFE is missing ${factory}`);
    }
  }
  for (const factory of SERVER_ONLY_FACTORIES) {
    if (factory in sandbox.nearX402) {
      throw new Error(`Published IIFE leaked server-only export ${factory}`);
    }
  }
}

function verifyPublishedNodeImports(tarball, version) {
  const temporaryRoot = mkdtempSync(
    path.join(os.tmpdir(), "fastnear-published-x402-"),
  );
  try {
    const tarballPath = path.join(temporaryRoot, `fastnear-x402-${version}.tgz`);
    writeFileSync(tarballPath, tarball);
    writeFileSync(
      path.join(temporaryRoot, "package.json"),
      `${JSON.stringify({
        name: "fastnear-published-x402-acceptance",
        version: "0.0.0",
        private: true,
        type: "module",
      }, null, 2)}\n`,
    );

    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const install = spawnSync(
      npm,
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        tarballPath,
      ],
      {
        cwd: temporaryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_update_notifier: "false",
        },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (install.error) throw install.error;
    if (install.status !== 0) {
      throw new Error(
        `Failed to install the verified npm tarball:\n${install.stdout ?? ""}${install.stderr ?? ""}`,
      );
    }
    if (existsSync(path.join(temporaryRoot, "node_modules/@fastnear/wallet"))) {
      throw new Error(
        "Published @fastnear/x402 installed its optional wallet peer in a server consumer",
      );
    }

    const importSmoke = `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const entrypoints = ${JSON.stringify(NODE_ENTRYPOINTS)};
const runtimeKeys = (namespace) => Object.keys(namespace)
  .filter((key) => key !== "default" && key !== "__esModule")
  .sort();
for (const [specifier, probes] of entrypoints) {
  const cjs = require(specifier);
  const esm = await import(specifier);
  assert.deepEqual(runtimeKeys(cjs), runtimeKeys(esm), specifier + " export mismatch");
  for (const probe of probes) {
    assert.equal(typeof cjs[probe], "function", specifier + " require() missed " + probe);
    assert.equal(typeof esm[probe], "function", specifier + " import missed " + probe);
  }
}
`;
    const smoke = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", importSmoke],
      {
        cwd: temporaryRoot,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (smoke.error) throw smoke.error;
    if (smoke.status !== 0) {
      throw new Error(
        `Published CJS/ESM entrypoint smoke failed:\n${smoke.stdout ?? ""}${smoke.stderr ?? ""}`,
      );
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function fetchBytes(fetchImpl, url, label) {
  const response = await fetchImpl(url, {
    headers: { "user-agent": "fastnear-published-x402-verifier" },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${label} from ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function verifyPublishedX402(versionInput, fetchImpl = globalThis.fetch) {
  const version = exactPublishedVersion(versionInput);
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required");
  }

  const metadataUrl =
    `https://registry.npmjs.org/@fastnear%2Fx402/${encodeURIComponent(version)}`;
  const metadataBytes = await fetchBytes(fetchImpl, metadataUrl, "npm metadata");
  let metadata;
  try {
    metadata = JSON.parse(metadataBytes.toString("utf8"));
  } catch {
    throw new Error("npm returned malformed @fastnear/x402 metadata");
  }
  if (metadata.name !== "@fastnear/x402" || metadata.version !== version) {
    throw new Error("npm metadata did not resolve the requested exact version");
  }
  if (typeof metadata.dist?.tarball !== "string") {
    throw new Error("npm metadata is missing dist.tarball");
  }

  const tarball = await fetchBytes(fetchImpl, metadata.dist.tarball, "npm tarball");
  assertTarballIntegrity(tarball, metadata.dist.integrity, metadata.dist.shasum);

  const packageJson = extractTarEntry(tarball, "package/package.json");
  let manifest;
  try {
    manifest = JSON.parse(packageJson.toString("utf8"));
  } catch {
    throw new Error("npm tarball contains malformed package.json");
  }
  assertPackedSurface(tarball, manifest, version);

  const npmIife = extractTarEntry(
    tarball,
    "package/dist/umd/browser.global.js",
  );
  const cdnUrl =
    `https://cdn.jsdelivr.net/npm/@fastnear/x402@${encodeURIComponent(version)}/dist/umd/browser.global.js`;
  const cdnIife = await fetchBytes(fetchImpl, cdnUrl, "immutable jsDelivr IIFE");
  if (!npmIife.equals(cdnIife)) {
    throw new Error("jsDelivr IIFE bytes differ from the immutable npm tarball");
  }
  inspectPublishedIife(cdnIife.toString("utf8"));
  verifyPublishedNodeImports(tarball, version);

  return {
    version,
    metadataUrl,
    tarballUrl: metadata.dist.tarball,
    cdnUrl,
    iifeBytes: cdnIife.length,
    nodeEntrypoints: NODE_ENTRYPOINTS.length,
  };
}
