import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Clean-HEAD IIFE baselines measured with the repository's pinned esbuild and
// gzip level 9. Existing packages may grow by at most 2 KiB minus one byte by
// default; feature-specific exceptions stay explicit in the table below.
const maxExistingGzipGrowth = 2 * 1024 - 1;
const budgets = [
  { package: "borsh", baselineGzip: 2_496 },
  { package: "borsh-schema", baselineGzip: 1_411 },
  { package: "utils", baselineGzip: 35_696 },
  { package: "api", baselineGzip: 49_371 },
  { package: "wallet", baselineGzip: 21_323 },
  // The timeout-aware Meteor bridge includes local Borsh/action binding and
  // signature verification before accepting a wallet response.
  { package: "wallet-adapter", baselineGzip: 41_529, maxGzipGrowth: 4 * 1024 - 1 },
  { package: "ml-dsa-65", raw: 75 * 1024, gzip: 20 * 1024 },
  { package: "x402", raw: 256 * 1024, gzip: 64 * 1024 },
];

const results = [];
for (const budget of budgets) {
  const filename = path.join(
    repoRoot,
    "packages",
    budget.package,
    "dist/umd/browser.global.js",
  );
  const bytes = await readFile(filename);
  const gzipBytes = gzipSync(bytes, { level: 9 }).byteLength;
  const maxGzipGrowth = budget.maxGzipGrowth ?? maxExistingGzipGrowth;
  const result = {
    package: `@fastnear/${budget.package}`,
    rawBytes: bytes.byteLength,
    gzipBytes,
    ...(budget.baselineGzip == null
      ? { budget: { rawBytes: budget.raw, gzipBytes: budget.gzip } }
      : {
          baselineGzipBytes: budget.baselineGzip,
          gzipGrowthBytes: gzipBytes - budget.baselineGzip,
          budget: { maxGzipGrowthBytes: maxGzipGrowth },
        }),
  };
  results.push(result);

  const exceedsBudget = budget.baselineGzip == null
    ? bytes.byteLength > budget.raw || gzipBytes > budget.gzip
    : gzipBytes - budget.baselineGzip > maxGzipGrowth;
  if (exceedsBudget) {
    throw new Error(`Bundle budget exceeded: ${JSON.stringify(result)}`);
  }

  if (
    budget.package !== "ml-dsa-65" &&
    (bytes.includes(Buffer.from("RejNTTPoly")) || bytes.includes(Buffer.from("externalMu")))
  ) {
    throw new Error(`${result.package} unexpectedly contains the Noble ML-DSA backend`);
  }
}

console.log(JSON.stringify({ schemaVersion: 1, bundles: results }, null, 2));
