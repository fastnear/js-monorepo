import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];

if (!mode || (mode !== "prepare" && mode !== "restore")) {
  throw new Error(
    "Usage: node scripts/prepare-package-for-publish.mjs <prepare|restore>",
  );
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const packageDir = process.cwd();
const packageJsonPath = path.join(packageDir, "package.json");
const backupPath = path.join(packageDir, ".package.json.publish-backup");

const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function collectWorkspaceVersions() {
  const packagesDir = path.join(repoRoot, "packages");
  const workspaceVersions = new Map();

  for (const packageName of readDirNames(packagesDir)) {
    const workspacePackageJsonPath = path.join(
      packagesDir,
      packageName,
      "package.json",
    );
    if (!existsSync(workspacePackageJsonPath)) {
      continue;
    }

    const workspaceManifest = readJson(workspacePackageJsonPath);
    workspaceVersions.set(workspaceManifest.name, workspaceManifest.version);
  }

  return workspaceVersions;
}

function readDirNames(dir) {
  return readdirSync(dir);
}

function resolveWorkspaceSpecifier(specifier, version) {
  if (!specifier.startsWith("workspace:")) {
    return specifier;
  }

  if (!version) {
    throw new Error(`Cannot resolve ${specifier} without a workspace version`);
  }

  const token = specifier.slice("workspace:".length);

  if (token === "" || token === "*") {
    return version;
  }

  if (token === "^" || token === "~") {
    return `${token}${version}`;
  }

  return token;
}

if (mode === "prepare") {
  const originalSource = readFileSync(packageJsonPath, "utf8");
  const manifest = JSON.parse(originalSource);
  const workspaceVersions = collectWorkspaceVersions();
  let changed = false;

  if (existsSync(backupPath)) {
    throw new Error(
      `Found an existing publish backup at ${backupPath}. Run the restore step before preparing again.`,
    );
  }

  for (const section of dependencySections) {
    const deps = manifest[section];

    if (!deps) {
      continue;
    }

    for (const [name, specifier] of Object.entries(deps)) {
      if (!String(specifier).startsWith("workspace:")) {
        continue;
      }

      const resolved = resolveWorkspaceSpecifier(
        String(specifier),
        workspaceVersions.get(name),
      );

      if (resolved !== specifier) {
        deps[name] = resolved;
        changed = true;
      }
    }
  }

  if (changed) {
    writeFileSync(backupPath, originalSource);
    writeJson(packageJsonPath, manifest);
    console.log(`Prepared ${packageJsonPath} for publish.`);
  } else {
    console.log(`No workspace dependency rewrites needed for ${packageJsonPath}.`);
  }
}

if (mode === "restore") {
  if (!existsSync(backupPath)) {
    console.log(`No publish backup found for ${packageJsonPath}.`);
  } else {
    writeFileSync(packageJsonPath, readFileSync(backupPath, "utf8"));
    rmSync(backupPath);
    console.log(`Restored ${packageJsonPath} after pack/publish.`);
  }
}
