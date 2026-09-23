// Live gas-key lifecycle on testnet: add -> fund -> sign with the gas key on
// two nonce lanes -> withdraw -> delete. Every read after a FINAL send is made
// at finality. The decisive check is that the RPC-reported hash of each
// gas-key-signed transaction equals the hash we computed locally over the
// TransactionV1 bytes, which proves the V1 wire format end to end.
//
//   yarn smoke:gas-keys:testnet -- --account <x>.testnet --credential <full-access-key.json> --confirm-account <x>.testnet
//   yarn smoke:gas-keys:testnet -- ... --cleanup <recovery-record.json>   # drain + delete a key left behind
//
// Budget: ~0.06 NEAR spare on the account; everything but gas is returned.

import { open, readFile, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  actions,
  gasKeyInfoFromPermission,
  queryAccessKey,
  queryAccessKeyList,
  queryGasKeyNonces,
  queryProtocolVersion,
  sendTx,
  state,
} from "@fastnear/api";
import { base64ToBytes, privateKeyFromRandom, signerFromPrivateKey } from "@fastnear/utils";

import {
  assertLaneAdvanced,
  errorText,
  isGasKeyError,
  residualBurn,
  unknownAccessKey,
} from "./gas-key-testnet-helpers.mjs";

const NETWORK = "testnet";
const REQUIRED_PROTOCOL_VERSION = 85;
const NUM_NONCES = 2;
const FUND = "0.05 NEAR";
const FUND_YOCTO = 5n * 10n ** 22n;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue; // Yarn Berry forwards the separator itself.
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const [rawName, inlineValue] = argument.slice(2).split("=", 2);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${rawName} requires a value`);
    result[rawName] = value;
  }
  return result;
}

function requireOption(options, name) {
  const value = options[name];
  if (!value) throw new Error(`Missing required --${name} option`);
  return value;
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function loadOwnerSigner(accountId, credentialPath) {
  const metadata = await stat(credentialPath);
  if ((metadata.mode & 0o077) !== 0) {
    console.warn(
      `WARNING: ${credentialPath} is readable by group or other users (mode ${(metadata.mode & 0o777).toString(8)}). ` +
      "This smoke will not change its permissions.",
    );
  }
  let credential;
  try {
    credential = JSON.parse(await readFile(credentialPath, "utf8"));
  } catch {
    throw new Error(`Credential file is not valid JSON: ${credentialPath}`);
  }
  if (credential.account_id && credential.account_id !== accountId) {
    throw new Error(`Credential account ${credential.account_id} does not match ${accountId}`);
  }
  const privateKey = credential.private_key ?? credential.secret_key;
  if (typeof privateKey !== "string") throw new Error("Credential is missing private_key/secret_key");
  const signer = signerFromPrivateKey(privateKey);
  if (credential.public_key && credential.public_key !== signer.publicKey) {
    throw new Error("Credential public_key does not match its private key");
  }
  const view = await queryAccessKey({ accountId, publicKey: signer.publicKey, network: NETWORK });
  if (view.result.permission !== "FullAccess") {
    throw new Error("The supplied credential is not a classical FullAccess key");
  }
  return signer;
}

async function writeRecoveryRecord(filename, record) {
  const handle = await open(filename, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Gas-key view at finality: { info, nonces } or null when the key is absent. */
async function readGasKey(accountId, publicKey) {
  let view;
  try {
    view = await queryAccessKey({ accountId, publicKey, blockId: "final", network: NETWORK });
  } catch (error) {
    if (unknownAccessKey(error)) return null;
    throw error;
  }
  if (view.result.error) {
    if (unknownAccessKey(view.result.error)) return null;
    throw new Error(view.result.error);
  }
  const info = gasKeyInfoFromPermission(view.result.permission);
  if (!info) throw new Error(`${publicKey} exists on ${accountId} but is not a gas key`);
  const lanes = await queryGasKeyNonces({ accountId, publicKey, blockId: "final", network: NETWORK });
  return { info, nonces: lanes.result.nonces.map(String) };
}

const LIST_PAGE = 100;

/** The listed row for `publicKey`, or null. Pages, since >100 keys are refused unpaginated. */
async function listedKey(accountId, publicKey) {
  let afterKey;
  for (;;) {
    const page = await queryAccessKeyList({
      accountId,
      blockId: "final",
      network: NETWORK,
      afterKey,
      limit: LIST_PAGE,
    });
    const keys = page.result.keys;
    const hit = keys.find((key) => key.public_key === publicKey);
    if (hit) return hit;
    // nearcore returns `last_key` only when the listing was truncated.
    const cursor = page.result.last_key ?? (keys.length < LIST_PAGE ? null : keys.at(-1)?.public_key);
    if (!cursor) return null;
    afterKey = cursor;
  }
}

/** The most recent locally signed transaction (tx history keeps insertion order). */
function latestSignedRecord() {
  const records = Object.values(state.getTxHistory()).filter((record) => record.signedTxBase64);
  return records.at(-1) ?? null;
}

/**
 * Fail-safe removal: withdraw whatever is left, then delete, and only trust a
 * finalized absence read. Tolerates the key already being gone.
 */
async function drainAndDelete(accountId, publicKey, ownerSigner) {
  let lastError = new Error("gas key remains present");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const current = await readGasKey(accountId, publicKey);
      if (!current) return;
      const drain = BigInt(current.info.balance) > 0n
        ? [actions.withdrawFromGasKey({ publicKey, amount: current.info.balance })]
        : [];
      await sendTx({
        signer: ownerSigner,
        signerId: accountId,
        receiverId: accountId,
        actions: [...drain, actions.deleteKey({ publicKey })],
        network: NETWORK,
        waitUntil: "FINAL",
      });
      if (!(await readGasKey(accountId, publicKey))) return;
      lastError = new Error(`gas key remains present after finalized deletion attempt ${attempt}`);
    } catch (error) {
      if (isGasKeyError(error, "GasKeyDoesNotExist") || unknownAccessKey(error)) return;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(`Could not establish finalized gas-key absence: ${errorText(lastError)}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const accountId = requireOption(options, "account");
  const credentialPath = path.resolve(requireOption(options, "credential"));
  if (requireOption(options, "confirm-account") !== accountId) {
    throw new Error("--confirm-account must exactly match --account");
  }
  if (!accountId.endsWith(".testnet")) {
    throw new Error("This lifecycle smoke is hard-locked to named testnet accounts");
  }

  const protocolVersion = await queryProtocolVersion({ network: NETWORK });
  if (protocolVersion < REQUIRED_PROTOCOL_VERSION) {
    throw new Error(`Testnet protocol ${protocolVersion} does not activate gas keys (requires ${REQUIRED_PROTOCOL_VERSION})`);
  }
  const ownerSigner = await loadOwnerSigner(accountId, credentialPath);

  if (options.cleanup) {
    const recoveryPath = path.resolve(options.cleanup);
    const record = JSON.parse(await readFile(recoveryPath, "utf8"));
    if (record.accountId !== accountId || record.network !== NETWORK) {
      throw new Error("Recovery record does not match the confirmed account/network");
    }
    await drainAndDelete(accountId, record.publicKey, ownerSigner);
    await unlink(recoveryPath);
    console.log(`Recovery complete: ${record.publicKey} is absent from ${accountId}`);
    return;
  }

  // A gas key is an ordinary ed25519 key pair; only its permission differs.
  const gasSigner = signerFromPrivateKey(privateKeyFromRandom("ed25519"));
  const recoveryPath = path.resolve(
    options["recovery-file"] ?? path.join(os.tmpdir(), `fastnear-gas-key-${accountId}-${Date.now()}.json`),
  );
  const recoveryRecord = {
    schemaVersion: 1,
    network: NETWORK,
    accountId,
    publicKey: gasSigner.publicKey,
    numNonces: NUM_NONCES,
  };

  let addAttempted = false;
  let cleaned = false;
  try {
    await writeRecoveryRecord(recoveryPath, recoveryRecord);
    console.log(`Recovery metadata: ${recoveryPath}`);

    // 1. AddKey with a gas-key permission, signed by the classical owner key.
    addAttempted = true;
    await sendTx({
      signer: ownerSigner,
      signerId: accountId,
      receiverId: accountId,
      actions: [actions.addFullAccessGasKey({ publicKey: gasSigner.publicKey, numNonces: NUM_NONCES })],
      network: NETWORK,
      waitUntil: "FINAL",
    });
    let current = await readGasKey(accountId, gasSigner.publicKey);
    assert(current, "gas key present after AddKey");
    assert(current.info.balance === "0", `fresh gas key balance is 0 (got ${current.info.balance})`);
    assert(current.info.num_nonces === NUM_NONCES, `num_nonces is ${NUM_NONCES}`);
    assert(current.info.functionCall === null, "GasKeyFullAccess has no function-call scope");
    assert(current.nonces.length === NUM_NONCES, `${NUM_NONCES} lane nonces`);
    const listed = await listedKey(accountId, gasSigner.publicKey);
    assert(listed, "gas key appears in view_access_key_list");
    assert(
      listed.access_key?.permission && "GasKeyFullAccess" in listed.access_key.permission,
      "listed row carries the GasKeyFullAccess permission view",
    );
    console.log(`Added gas key ${gasSigner.publicKey} with lanes ${JSON.stringify(current.nonces)}`);

    // 2. Fund it (any account may; here the owner). The deposit leaves the account.
    await sendTx({
      signer: ownerSigner,
      signerId: accountId,
      receiverId: accountId,
      actions: [actions.transferToGasKey({ publicKey: gasSigner.publicKey, deposit: FUND })],
      network: NETWORK,
      waitUntil: "FINAL",
    });
    current = await readGasKey(accountId, gasSigner.publicKey);
    assert(BigInt(current.info.balance) === FUND_YOCTO, `funded balance is ${FUND_YOCTO} (got ${current.info.balance})`);
    console.log(`Funded with ${FUND}`);

    // 3. Sign with the gas key on each lane. Gas comes from the key balance.
    let nonces = current.nonces;
    for (const nonceIndex of [0, 1]) {
      const before = nonces;
      const response = await sendTx({
        signer: gasSigner,
        signerId: accountId,
        receiverId: accountId,
        actions: [actions.transfer("1")],
        nonceIndex,
        network: NETWORK,
        waitUntil: "FINAL",
      });
      const local = latestSignedRecord();
      assert(local, "sendTx recorded the signed transaction");
      assert(base64ToBytes(local.signedTxBase64)[0] === 0x01, "signed bytes carry the TransactionV1 prefix");
      assert(local.tx.nonceIndex === nonceIndex, `history records nonceIndex ${nonceIndex}`);
      const txView = response?.result?.transaction ?? response?.transaction;
      assert(txView?.hash, "RPC response includes the transaction view");
      assert(txView.hash === local.txHash, `RPC hash ${txView.hash} equals local V1 hash ${local.txHash}`);
      assert(txView.public_key === gasSigner.publicKey, "transaction was signed by the gas key");
      if (txView.nonce_index !== undefined) {
        assert(txView.nonce_index === nonceIndex, `RPC echoes nonce_index ${nonceIndex}`);
      }
      current = await readGasKey(accountId, gasSigner.publicKey);
      nonces = current.nonces;
      const laneReport = assertLaneAdvanced({ before, after: nonces, index: nonceIndex });
      const balance = BigInt(current.info.balance);
      assert(balance < FUND_YOCTO && balance > 0n, `gas was charged to the key (balance now ${balance})`);
      console.log(
        `Lane ${nonceIndex}: tx ${txView.hash} finalized; lane advanced, lanes ${JSON.stringify(laneReport.unchanged)} unchanged; key balance ${balance}`,
      );
    }

    // 3b. Strict nonce mode on lane 0: the trailing NonceMode byte is 0x01.
    {
      const before = nonces;
      await sendTx({
        signer: gasSigner,
        signerId: accountId,
        receiverId: accountId,
        actions: [actions.transfer("1")],
        nonceIndex: 0,
        nonceMode: "strict",
        network: NETWORK,
        waitUntil: "FINAL",
      });
      const bytes = base64ToBytes(latestSignedRecord().signedTxBase64);
      assert(bytes[bytes.length - 65 - 1] === 0x01, "strict mode sets the NonceMode byte");
      current = await readGasKey(accountId, gasSigner.publicKey);
      nonces = current.nonces;
      assertLaneAdvanced({ before, after: nonces, index: 0 });
      console.log("Strict-mode send on lane 0 finalized");
    }

    // 4. Negative path: the classical key is not a gas key.
    let negative = null;
    try {
      await queryGasKeyNonces({ accountId, publicKey: ownerSigner.publicKey, blockId: "final", network: NETWORK });
    } catch (error) {
      negative = error;
    }
    assert(negative && isGasKeyError(negative, "UNKNOWN_GAS_KEY"), "view_gas_key_nonces on a classical key fails with UNKNOWN_GAS_KEY");

    // 5. Withdraw what is left (owner-signed, signer == receiver), then delete.
    await sendTx({
      signer: ownerSigner,
      signerId: accountId,
      receiverId: accountId,
      actions: [actions.withdrawFromGasKey({ publicKey: gasSigner.publicKey, amount: current.info.balance })],
      network: NETWORK,
      waitUntil: "FINAL",
    });
    current = await readGasKey(accountId, gasSigner.publicKey);
    const residual = residualBurn(current.info.balance);
    console.log(`Withdrew; residual ${residual} yoctoNEAR will be burnt by DeleteKey`);

    await drainAndDelete(accountId, gasSigner.publicKey, ownerSigner);
    assert(!(await listedKey(accountId, gasSigner.publicKey)), "gas key absent from the final key list");
    await unlink(recoveryPath);
    cleaned = true;
    console.log(`Verified cleanup: ${gasSigner.publicKey} is absent from ${accountId}`);
  } finally {
    if (addAttempted && !cleaned) {
      try {
        await drainAndDelete(accountId, gasSigner.publicKey, ownerSigner);
        await unlink(recoveryPath);
        cleaned = true;
        console.log("Fail-safe cleanup established that the transient gas key is absent");
      } catch (cleanupError) {
        console.error(
          `Automatic cleanup failed. Retain ${recoveryPath} and run:\n` +
          `yarn smoke:gas-keys:testnet -- --account ${shellArg(accountId)} ` +
          `--credential ${shellArg(credentialPath)} --confirm-account ${shellArg(accountId)} ` +
          `--cleanup ${shellArg(recoveryPath)}`,
        );
        console.error(errorText(cleanupError));
      }
    }
  }
}

main().catch((error) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
