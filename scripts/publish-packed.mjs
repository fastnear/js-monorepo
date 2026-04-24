import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const packageDir = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "fastnear-publish-"));
const tarballPath = path.join(tempDir, "package.tgz");
const publishArgs = process.argv.slice(2).filter((arg) => arg !== "--tolerate-republish");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageDir,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

try {
  run("yarn", ["pack", "--out", tarballPath]);
  run("npm", ["publish", tarballPath, ...publishArgs]);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
