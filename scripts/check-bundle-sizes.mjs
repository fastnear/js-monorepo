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
  // Transaction serialization now also carries the NEP-366 local delegate signer
  // (mapDelegateAction / serializeSignedDelegate / delegateSigningHash), the
  // reverse unit formatter (formatNearAmount), and parseSignedDelegate — the
  // inverse action/key/signature mapper, which additionally pulls in the borsh
  // *decode* path (deserialize) so a wallet-signed delegate round-trips.
  // Gas keys (protocol 85) added ~2.0 KiB gzip: the two gas-key permission
  // variants, TransferToGasKey/WithdrawFromGasKey, TransactionV1 with its
  // nonce/nonce-mode enums and V0/V1 selection, and their inverse mappers.
  { package: "utils", baselineGzip: 35_696, maxGzipGrowth: 6 * 1024 - 1 },
  // The api IIFE re-exports the @fastnear/utils surface (NEP-413 signing, the
  // NEP-366 local delegate signer + parseSignedDelegate inverse mapper with the
  // borsh decode path, and the reverse unit formatter) and adds the
  // near.signDelegate/relayDelegate (now accepting a wallet-signed delegate),
  // gasPrice/status/validators, and implicitAccountId/createFundedTestnetAccount
  // surfaces. Gas keys added ~3.9 KiB gzip on top: the inlined utils growth
  // plus the gas-key action builders, queryGasKeyNonces, gasKeyInfoFromPermission,
  // sendTx's lane-aware TransactionV1 branch, and key-list pagination.
  { package: "api", baselineGzip: 49_371, maxGzipGrowth: 11 * 1024 - 1 },
  // The wallet IIFE inlines @fastnear/near-connect. Gas-key passthrough (near-connect
  // 0.14: the gas-key action shapes + the per-wallet features.gasKeys gate, plus the
  // flat -> connector gas-key mapping in connector-actions.ts) added ~0.95 KiB gzip on
  // top of ~1.15 KiB of earlier 2.1-2.4 growth: 21,323 -> 22,497 -> 23,459 measured.
  { package: "wallet", baselineGzip: 21_323, maxGzipGrowth: 3 * 1024 - 1 },
  // The timeout-aware Meteor bridge includes local Borsh/action binding and
  // signature verification before accepting a wallet response; action mapping
  // now also carries the shared NEAR unit coercion (convertUnit) so gas/deposit
  // strings like "100 Tgas" map instead of throwing. Gas keys added ~2.1 KiB
  // gzip: the inlined utils growth plus the guards that refuse gas-key shapes.
  { package: "wallet-adapter", baselineGzip: 41_529, maxGzipGrowth: 7 * 1024 - 1 },
  { package: "ml-dsa-65", raw: 75 * 1024, gzip: 20 * 1024 },
  // Carries the full 2048-word bip39 English wordlist plus ed25519 + SLIP-0010
  // derivation, so it is inherently chunky; caps sized with headroom over the
  // 2.1.0 baseline (raw 121 KiB / gzip 36 KiB).
  { package: "seed-phrase", raw: 160 * 1024, gzip: 48 * 1024 },
  { package: "x402", raw: 256 * 1024, gzip: 64 * 1024 },
  // Typed fetch clients + NEP-413 payload assembly; no crypto in the
  // browser entry (local-key signing lives in the /node subpath).
  { package: "intents", raw: 64 * 1024, gzip: 16 * 1024 },
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
