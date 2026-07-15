import { open, readFile, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  actions,
  queryAccessKey,
  queryAccessKeyList,
  queryProtocolVersion,
  sendTx,
} from "@fastnear/api";
import { generateSigner, publicKeyToHandle } from "@fastnear/ml-dsa-65";
import { signerFromPrivateKey } from "@fastnear/utils";

const NETWORK = "testnet";
const REQUIRED_PROTOCOL_VERSION = 85;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
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

function unknownAccessKey(error) {
  return /UnknownAccessKey|does not exist|unknown access key/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

async function accessKeyExists(accountId, publicKey) {
  try {
    const view = await queryAccessKey({
      accountId,
      publicKey,
      blockId: "final",
      network: NETWORK,
    });
    if (view.result.error) {
      if (unknownAccessKey(view.result.error)) return false;
      throw new Error(view.result.error);
    }
    return true;
  } catch (error) {
    if (unknownAccessKey(error)) return false;
    throw error;
  }
}

async function loadRecoverySigner(accountId, credentialPath) {
  const metadata = await stat(credentialPath);
  if ((metadata.mode & 0o077) !== 0) {
    console.warn(
      `WARNING: ${credentialPath} is readable by group or other users (mode ${(metadata.mode & 0o777).toString(8)}). ` +
      "This smoke will not change its permissions.",
    );
  }

  const contents = await readFile(credentialPath, "utf8");
  let credential;
  try {
    credential = JSON.parse(contents);
  } catch {
    throw new Error(`Credential file is not valid JSON: ${credentialPath}`);
  }

  if (credential.account_id && credential.account_id !== accountId) {
    throw new Error(`Credential account ${credential.account_id} does not match ${accountId}`);
  }
  const privateKey = credential.private_key ?? credential.secret_key;
  if (typeof privateKey !== "string") {
    throw new Error("Credential is missing private_key/secret_key");
  }

  const signer = signerFromPrivateKey(privateKey);
  if (credential.public_key && credential.public_key !== signer.publicKey) {
    throw new Error("Credential public_key does not match its private key");
  }
  const view = await queryAccessKey({
    accountId,
    publicKey: signer.publicKey,
    network: NETWORK,
  });
  if (view.result.permission !== "FullAccess") {
    throw new Error("The supplied classical recovery credential is not a FullAccess key");
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

async function establishKeyAbsence(accountId, publicKey, signer) {
  let lastError = new Error("ML-DSA key remains present");

  // Do not skip deletion merely because one read says the key is absent. An
  // AddKey request can be accepted before a transport error and land later.
  // A finalized transaction from the same classical access key forms a nonce
  // barrier: any ambiguous earlier AddKey transaction can no longer land. If a
  // same-nonce transaction wins the race, the next attempt uses a higher nonce.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await sendTx({
        signer,
        signerId: accountId,
        receiverId: accountId,
        actions: [actions.deleteKey({ publicKey })],
        network: NETWORK,
        waitUntil: "FINAL",
      });
      if (!(await accessKeyExists(accountId, publicKey))) return;
      lastError = new Error(
        `ML-DSA key remains present after finalized deletion attempt ${attempt}`,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(
    `Could not establish finalized ML-DSA key absence: ${lastError.message}`,
  );
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
    throw new Error(
      `Testnet protocol ${protocolVersion} does not activate ML-DSA-65 (requires ${REQUIRED_PROTOCOL_VERSION})`,
    );
  }

  const recoverySigner = await loadRecoverySigner(accountId, credentialPath);

  if (options.cleanup) {
    const recoveryPath = path.resolve(options.cleanup);
    const record = JSON.parse(await readFile(recoveryPath, "utf8"));
    if (record.accountId !== accountId || record.network !== NETWORK) {
      throw new Error("Recovery record does not match the confirmed account/network");
    }
    if (record.publicKeyHandle !== publicKeyToHandle(record.publicKey)) {
      throw new Error("Recovery record public key and hash handle do not match");
    }
    await establishKeyAbsence(accountId, record.publicKey, recoverySigner);
    await unlink(recoveryPath);
    console.log(`Recovery complete: ${record.publicKeyHandle} is absent from ${accountId}`);
    return;
  }

  const pqSigner = generateSigner();
  const recoveryPath = path.resolve(
    options["recovery-file"] ??
      path.join(os.tmpdir(), `fastnear-ml-dsa-65-${accountId}-${Date.now()}.json`),
  );
  const recoveryRecord = {
    schemaVersion: 1,
    network: NETWORK,
    accountId,
    publicKey: pqSigner.publicKey,
    publicKeyHandle: pqSigner.publicKeyHandle,
  };

  let addAttempted = false;
  let cleaned = false;

  try {
    await writeRecoveryRecord(recoveryPath, recoveryRecord);
    console.log(`Recovery metadata: ${recoveryPath}`);

    // Mark the attempt before submitting: the transaction can land even if a
    // transport error prevents sendTx from returning its final response.
    addAttempted = true;
    await sendTx({
      signer: recoverySigner,
      signerId: accountId,
      receiverId: accountId,
      actions: [actions.addFullAccessKey({ publicKey: pqSigner.publicKey })],
      network: NETWORK,
      waitUntil: "FINAL",
    });
    const direct = await queryAccessKey({
      accountId,
      publicKey: pqSigner.publicKey,
      network: NETWORK,
    });
    if (direct.result.permission !== "FullAccess") {
      throw new Error("Direct ML-DSA access-key query did not return FullAccess");
    }
    const list = await queryAccessKeyList({ accountId, network: NETWORK });
    if (!list.result.keys.some((key) => key.public_key === pqSigner.publicKeyHandle)) {
      throw new Error("Access-key list did not expose the expected ML-DSA hash handle");
    }
    console.log(`Added and reconciled: ${pqSigner.publicKeyHandle}`);

    await sendTx({
      signer: pqSigner,
      signerId: accountId,
      receiverId: accountId,
      actions: [actions.transfer("1")],
      network: NETWORK,
      waitUntil: "FINAL",
    });
    console.log("ML-DSA-signed 1-yocto self-transfer finalized");

    await establishKeyAbsence(accountId, pqSigner.publicKey, recoverySigner);
    const finalList = await queryAccessKeyList({ accountId, network: NETWORK });
    if (finalList.result.keys.some((key) => key.public_key === pqSigner.publicKeyHandle)) {
      throw new Error("ML-DSA hash handle remains in the final access-key list");
    }
    await unlink(recoveryPath);
    cleaned = true;
    console.log(`Verified cleanup: ${pqSigner.publicKeyHandle} is absent from ${accountId}`);
  } finally {
    if (addAttempted && !cleaned) {
      try {
        await establishKeyAbsence(accountId, pqSigner.publicKey, recoverySigner);
        await unlink(recoveryPath);
        cleaned = true;
        console.log("Fail-safe cleanup established that the transient ML-DSA key is absent");
      } catch (cleanupError) {
        console.error(
          `Automatic cleanup failed. Retain ${recoveryPath} and run:\n` +
          `yarn smoke:ml-dsa:testnet -- --account ${shellArg(accountId)} ` +
          `--credential ${shellArg(credentialPath)} --confirm-account ${shellArg(accountId)} ` +
          `--cleanup ${shellArg(recoveryPath)}`,
        );
        console.error(cleanupError instanceof Error ? cleanupError.message : cleanupError);
      }
    }
    pqSigner.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
