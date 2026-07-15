import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.join(repoRoot, "packages");
const publishPreparationScript = path.join(
  repoRoot,
  "scripts",
  "prepare-package-for-publish.mjs",
);
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "fastnear-packed-smoke-"));
const tarballsRoot = path.join(temporaryRoot, "tarballs");
const consumerRoot = path.join(temporaryRoot, "consumer");

const exportProbes = {
  "@fastnear/api": ["sendTx", "queryProtocolVersion"],
  "@fastnear/borsh": ["serialize", "deserialize"],
  "@fastnear/borsh-schema": ["getBorshSchema", "nearChainSchema"],
  "@fastnear/ml-dsa-65": ["generateSigner", "publicKeyToHandle"],
  "@fastnear/utils": ["serializeSignedTransaction", "signerFromPrivateKey"],
  "@fastnear/wallet": ["connect", "sendTransaction"],
  "@fastnear/wallet-adapter": ["createMeteorAdapter", "createNearMobileAdapter"],
  "@fastnear/x402": [
    "createFastNearWalletSigner",
    "createNearPaymentFetch",
    "createNearX402Client",
  ],
};

const subpathExportProbes = {
  "@fastnear/x402": {
    "/node": ["createLocalNearSigner"],
    "/server": ["createNearResourceServer"],
    "/facilitator": ["createNearFacilitator"],
  },
};

const runtimes = [
  { expectedVersion: "20.19.0", packageSpecifier: "node@20.19.0" },
  { expectedVersion: "22", packageSpecifier: "node@22" },
];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function resolveExportTarget(manifest, exportPath, condition) {
  let target = manifest.exports?.[exportPath];
  while (target && typeof target === "object") {
    target = target[condition] ?? target.default;
  }
  return typeof target === "string" ? target : undefined;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
      ...options.env,
    },
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = options.capture
      ? `\n${result.stdout ?? ""}${result.stderr ?? ""}`
      : "";
    throw new Error(
      `${command} ${args.join(" ")} exited with status ${result.status}${output}`,
    );
  }

  return result.stdout?.trim() ?? "";
}

function discoverWorkspaces() {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = path.join(packagesRoot, entry.name);
      const manifestPath = path.join(directory, "package.json");
      if (!existsSync(manifestPath)) {
        return null;
      }

      const manifest = readJson(manifestPath);
      if (!manifest.name?.startsWith("@fastnear/")) {
        return null;
      }

      return {
        directory,
        manifest,
        manifestPath,
        originalManifestSource: readFileSync(manifestPath, "utf8"),
        publishBackupPath: path.join(directory, ".package.json.publish-backup"),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

function safeTarballName(workspace) {
  const packageName = workspace.manifest.name
    .replace(/^@/, "")
    .replaceAll("/", "-");
  return `${packageName}-${workspace.manifest.version}.tgz`;
}

function restoreWorkspaceManifests(workspaces) {
  const failures = [];

  for (const workspace of workspaces) {
    try {
      if (existsSync(workspace.publishBackupPath)) {
        run(process.execPath, [publishPreparationScript, "restore"], {
          cwd: workspace.directory,
        });
      }

      if (
        readFileSync(workspace.manifestPath, "utf8") !==
        workspace.originalManifestSource
      ) {
        // This is a last-resort recovery for an interrupted package lifecycle. Normal
        // packs are restored by the package's existing postpack hook.
        writeFileSync(workspace.manifestPath, workspace.originalManifestSource);
      }

      assert.equal(
        readFileSync(workspace.manifestPath, "utf8"),
        workspace.originalManifestSource,
        `${workspace.manifest.name} package.json was not restored exactly`,
      );
      assert.equal(
        existsSync(workspace.publishBackupPath),
        false,
        `${workspace.manifest.name} left a publish backup behind`,
      );
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Failed to restore workspace package manifests",
    );
  }
}

function assertWorkspaceManifestsUnchanged(workspaces) {
  for (const workspace of workspaces) {
    assert.equal(
      readFileSync(workspace.manifestPath, "utf8"),
      workspace.originalManifestSource,
      `${workspace.manifest.name} package.json changed after yarn pack`,
    );
    assert.equal(
      existsSync(workspace.publishBackupPath),
      false,
      `${workspace.manifest.name} left a publish backup behind`,
    );
  }
}

function packWorkspaces(workspaces) {
  const packed = [];

  for (const workspace of workspaces) {
    const tarballPath = path.join(tarballsRoot, safeTarballName(workspace));
    console.log(`\nPacking ${workspace.manifest.name}@${workspace.manifest.version}`);
    run("yarn", ["pack", "--out", tarballPath], { cwd: workspace.directory });
    assert.equal(existsSync(tarballPath), true, `Missing tarball ${tarballPath}`);
    assertWorkspaceManifestsUnchanged(workspaces);
    packed.push({ ...workspace, tarballPath });
  }

  return packed;
}

function writeConsumerProject(workspaces) {
  writeFileSync(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "fastnear-packed-acceptance",
        version: "0.0.0",
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  );

  const packageSpecs = workspaces.map((workspace) => ({
    name: workspace.manifest.name,
    probes: exportProbes[workspace.manifest.name] ?? [],
    subpaths: subpathExportProbes[workspace.manifest.name] ?? {},
    version: workspace.manifest.version,
  }));

  writeFileSync(
    path.join(consumerRoot, "consume.mjs"),
    `import assert from "node:assert/strict";
import { createRequire } from "node:module";

const packageSpecs = ${JSON.stringify(packageSpecs, null, 2)};
const expectedVersion = process.argv[2];
const require = createRequire(import.meta.url);

if (expectedVersion === "22") {
  assert.equal(process.versions.node.split(".")[0], "22", "expected a Node 22 runtime");
} else {
  assert.equal(process.versions.node, expectedVersion, "unexpected Node runtime");
}

function runtimeKeys(namespace) {
  return Object.keys(namespace)
    .filter((key) => key !== "default" && key !== "__esModule")
    .sort();
}

async function assertModuleFormats(specifier, probes) {
  const cjs = require(specifier);
  const esm = await import(specifier);
  const cjsKeys = runtimeKeys(cjs);
  const esmKeys = runtimeKeys(esm);

  assert.ok(cjsKeys.length > 0, specifier + " require() exposed no exports");
  assert.ok(esmKeys.length > 0, specifier + " import exposed no exports");
  assert.deepEqual(cjsKeys, esmKeys, specifier + " CJS/ESM export mismatch");

  for (const probe of probes) {
    assert.notEqual(cjs[probe], undefined, specifier + " require() missed " + probe);
    assert.notEqual(esm[probe], undefined, specifier + " import missed " + probe);
  }
}

for (const packageSpec of packageSpecs) {
  await assertModuleFormats(packageSpec.name, packageSpec.probes);
  for (const [subpath, probes] of Object.entries(packageSpec.subpaths)) {
    await assertModuleFormats(packageSpec.name + subpath, probes);
  }

  const subpathCount = Object.keys(packageSpec.subpaths).length;
  console.log(
    packageSpec.name + "@" + packageSpec.version + ": require() + import() OK" +
      (subpathCount === 0 ? "" : " (" + subpathCount + " subpaths)"),
  );
}

console.log("Runtime " + process.version + ": all packed packages OK");
`,
  );
}

function installTarballsTogether(workspaces) {
  console.log("\nInstalling every local tarball in one npm transaction");
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefer-offline",
      ...workspaces.map((workspace) => workspace.tarballPath),
    ],
    { cwd: consumerRoot },
  );
}

function verifyInstalledGraph(workspaces) {
  const consumerManifest = readJson(path.join(consumerRoot, "package.json"));
  const lockfile = readJson(path.join(consumerRoot, "package-lock.json"));

  for (const workspace of workspaces) {
    const { name, version } = workspace.manifest;
    const installedManifestPath = path.join(
      consumerRoot,
      "node_modules",
      ...name.split("/"),
      "package.json",
    );
    const installedManifest = readJson(installedManifestPath);
    const lockKey = `node_modules/${name}`;
    const lockEntry = lockfile.packages?.[lockKey];

    assert.equal(installedManifest.name, name);
    assert.equal(installedManifest.version, version);
    assert.equal(
      lockEntry?.version,
      version,
      `${name} has the wrong locked version`,
    );
    assert.match(
      lockEntry?.resolved ?? "",
      /^file:/,
      `${name} was not installed from a tarball`,
    );
    assert.match(
      consumerManifest.dependencies?.[name] ?? "",
      /^file:/,
      `${name} is not a direct local-tarball dependency`,
    );

    for (const [dependencyName, dependencyRange] of Object.entries(
      installedManifest.dependencies ?? {},
    )) {
      assert.equal(
        String(dependencyRange).startsWith("workspace:"),
        false,
        `${name} tarball leaked ${dependencyName}: ${dependencyRange}`,
      );
      assert.notEqual(
        dependencyRange,
        "*",
        `${name} tarball leaked an unpinned ${dependencyName} wildcard`,
      );

      const sibling = workspaces.find(
        (candidate) => candidate.manifest.name === dependencyName,
      );
      if (sibling) {
        assert.equal(
          dependencyRange,
          sibling.manifest.version,
          `${name} did not rewrite ${dependencyName} to its publish version`,
        );
      }
    }

    for (const entryPath of Object.keys(lockfile.packages ?? {})) {
      if (
        entryPath !== lockKey &&
        entryPath.endsWith(`/node_modules/${name}`)
      ) {
        throw new Error(
          `${name} was duplicated instead of resolving to its local tarball: ${entryPath}`,
        );
      }
    }

    for (const target of [
      installedManifest.main,
      installedManifest.module,
      installedManifest.types,
    ]) {
      if (target) {
        assert.equal(
          existsSync(path.resolve(path.dirname(installedManifestPath), target)),
          true,
          `${name} tarball is missing ${target}`,
        );
      }
    }

    for (const subpath of Object.keys(subpathExportProbes[name] ?? {})) {
      const exportPath = `.${subpath}`;
      for (const condition of ["require", "import", "types"]) {
        const target = resolveExportTarget(
          installedManifest,
          exportPath,
          condition,
        );
        assert.ok(
          target,
          `${name} tarball is missing the ${condition} target for ${exportPath}`,
        );
        assert.equal(
          existsSync(path.resolve(path.dirname(installedManifestPath), target)),
          true,
          `${name} tarball is missing ${target}`,
        );
      }
    }
  }
}

function smokeRuntimes() {
  const harnessPath = path.join(consumerRoot, "consume.mjs");

  for (const runtime of runtimes) {
    console.log(`\nTesting packed packages with ${runtime.packageSpecifier}`);
    run(
      "npx",
      [
        "--yes",
        `--package=${runtime.packageSpecifier}`,
        "--",
        "node",
        harnessPath,
        runtime.expectedVersion,
      ],
      { cwd: consumerRoot },
    );
  }
}

const workspaces = discoverWorkspaces();
const rootManifestPath = path.join(repoRoot, "package.json");
const originalRootManifestSource = readFileSync(rootManifestPath, "utf8");
let failure;

try {
  assert.ok(workspaces.length > 0, "No @fastnear workspace packages found");
  for (const workspace of workspaces) {
    assert.equal(
      existsSync(workspace.publishBackupPath),
      false,
      `Refusing to pack with an existing backup: ${workspace.publishBackupPath}`,
    );
  }

  mkdirSync(tarballsRoot, { recursive: true });
  mkdirSync(consumerRoot, { recursive: true });

  const packed = packWorkspaces(workspaces);
  writeConsumerProject(packed);
  installTarballsTogether(packed);
  verifyInstalledGraph(packed);
  smokeRuntimes();
  assertWorkspaceManifestsUnchanged(workspaces);
  assert.equal(
    readFileSync(rootManifestPath, "utf8"),
    originalRootManifestSource,
    "The repository root package.json changed during the smoke test",
  );

  console.log(`\nPacked-package acceptance passed for ${packed.length} workspaces.`);
} catch (error) {
  failure = error;
} finally {
  try {
    restoreWorkspaceManifests(workspaces);
    assert.equal(
      readFileSync(rootManifestPath, "utf8"),
      originalRootManifestSource,
      "The repository root package.json changed during cleanup",
    );
  } catch (cleanupError) {
    failure = failure
      ? new AggregateError([failure, cleanupError], "Smoke test and cleanup both failed")
      : cleanupError;
  }

  rmSync(temporaryRoot, { recursive: true, force: true });
}

if (failure) {
  throw failure;
}
