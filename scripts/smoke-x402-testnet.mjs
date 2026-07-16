import { constants, open, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { signerFromPrivateKey } from "@fastnear/utils";
import { createNearPaymentFetch } from "@fastnear/x402";
import { createNearFacilitator } from "@fastnear/x402/facilitator";
import { createLocalNearSigner } from "@fastnear/x402/node";
import { createNearResourceServer } from "@fastnear/x402/server";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import {
  SettlementCache,
  decodeSignedDelegateB64,
  parseFtTransferArgs,
} from "@x402/near";
import {
  decodeSignedTransaction,
  encodeSignedDelegate,
  encodeTransaction,
} from "@near-js/transactions";
import { sha256 } from "@noble/hashes/sha2.js";
import { binary_to_base58 } from "base58-js";
import {
  MAX_TIMEOUT_SECONDS,
  credentialMetadataError,
  normalizeHarnessOptions,
  parseHarnessArgs,
  sanitizedRpcUrl,
  transformWalletSmokePage,
} from "./x402-testnet-helpers.mjs";

const NETWORK = "near:testnet";
const CHAIN_ID = "testnet";
const ZERO_CODE_HASH = "11111111111111111111111111111111";
const FT_TRANSFER_GAS = 30_000_000_000_000n;
const ONE_YOCTO = 1n;
const MIN_RELAYER_BALANCE = 100_000_000_000_000_000_000_000n;
const MAX_BODY_BYTES = 64 * 1024;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `Usage:
  yarn smoke:x402:testnet -- --check-only [fixture options]
  yarn smoke:x402:testnet -- --execute [fixture options] [confirmations]
  yarn smoke:x402:testnet -- --serve-wallet [fixture options] [confirmations]

Modes:
  --check-only       Read-only testnet, credential, HTTP, and package preflight (default)
  --execute          Make one local-key payment and reconcile it at finality
  --serve-wallet     Serve a one-payment-only browser QA page on 127.0.0.1

Required fixture options:
  --payer <account.testnet>
  --payer-credential <file>       Required for check/execute; forbidden for wallet mode
  --relayer <account.testnet>
  --relayer-credential <file>
  --pay-to <account.testnet>
  --asset <token.testnet|64-char implicit account>
  --amount <atomic units>         Positive integer, capped at 1000000
  --rpc-url <https URL>

State-changing confirmations:
  --confirm-network testnet
  --confirm-payer <exact payer>
  --confirm-pay-to <exact recipient>
  --confirm-relayer <exact relayer>
  --confirm-asset <exact token>
  --confirm-amount <exact atomic amount>

Wallet-only options:
  --port <0-65535>                Defaults to an ephemeral loopback port
  --expected-wallet <exact name>  Must match nearWallet.walletName()
  --bundle-version <exact semver>  Load immutable npm bundles instead of local builds
  --wallet-manifest <https URL>   Optional candidate/custom near-connect manifest
  --wallet-timeout-seconds <n>    1-3600 seconds; defaults to 900

No payment is signed or submitted unless --execute is present or a user clicks
Pay in --serve-wallet mode. Credential files must be owner-only (chmod 600 or 400).`;

let nextRpcId = 1;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sanitizedErrorMessage(error, rpcUrl) {
  let message = safeErrorMessage(error);
  if (rpcUrl) {
    message = message.replaceAll(rpcUrl.href, sanitizedRpcUrl(rpcUrl));
    if (rpcUrl.search) message = message.replaceAll(rpcUrl.search, "");
  }
  return message;
}

function createDeferred() {
  let resolve;
  const promise = new Promise(innerResolve => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

class RpcResponseError extends Error {
  constructor(method, rpcError) {
    const detail = typeof rpcError?.message === "string"
      ? rpcError.message.slice(0, 300)
      : "unknown RPC error";
    super(`RPC ${method} failed: ${detail}`);
    this.rpcError = rpcError;
  }
}

class HttpInputError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function jsonStringify(value) {
  return JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
}

function sendJson(response, status, value, extraHeaders = {}) {
  const body = jsonStringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

function sendBytes(response, contentType, bytes) {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": contentType,
    "content-length": bytes.length,
    "x-content-type-options": "nosniff",
  });
  response.end(bytes);
}

async function readRequestBody(request, limit = MAX_BODY_BYTES) {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpInputError(413, "Request body is too large");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new HttpInputError(413, "Request body is too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function readJsonRequest(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpInputError(415, "Content-Type must be application/json");
  }
  const bytes = await readRequestBody(request);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new HttpInputError(400, "Request body must be valid JSON");
  }
}

function configureServer(server, requestTimeout = 120_000) {
  server.headersTimeout = 10_000;
  server.requestTimeout = requestTimeout;
  server.keepAliveTimeout = 1_000;
  server.setTimeout(requestTimeout);
  return server;
}

async function listenLoopback(server, port = 0) {
  await new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
  const address = server.address();
  invariant(address && typeof address === "object", "Loopback server did not expose an address");
  return {
    port: address.port,
    host: `127.0.0.1:${address.port}`,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(server) {
  if (!server?.listening) return;
  server.closeIdleConnections?.();
  await new Promise(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, 1_000);
    server.close(finish);
  });
}

function validHost(request, expectedHost) {
  return request.headers.host === expectedHost;
}

async function callRpc(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextRpcId++, method, params }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Local RPC proxy returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new RpcResponseError(method, body.error);
  return body.result;
}

function decodeAndAssertDelegate(encoded, expected) {
  let decoded;
  try {
    decoded = decodeSignedDelegateB64(encoded);
  } catch {
    throw new Error("Payment contains a malformed signed delegate action");
  }
  invariant(decoded.verifySignature(), "Signed delegate signature is invalid");
  const { delegate } = decoded;
  invariant(delegate.senderId === expected.payer, "Signed delegate payer does not match the fixture");
  invariant(delegate.receiverId === expected.asset, "Signed delegate token does not match the fixture");
  if (expected.publicKey) {
    invariant(delegate.publicKey === expected.publicKey, "Signed delegate key does not match the payer credential");
  }
  invariant(delegate.actionCount === 1, "Signed delegate must contain exactly one action");
  invariant(delegate.functionCall, "Signed delegate action is not a function call");
  invariant(delegate.functionCall.methodName === "ft_transfer", "Signed delegate method is not ft_transfer");
  invariant(delegate.functionCall.gas === FT_TRANSFER_GAS, "Signed delegate gas is not 30 TGas");
  invariant(delegate.functionCall.deposit === ONE_YOCTO, "Signed delegate deposit is not 1 yoctoNEAR");

  let rawArguments;
  try {
    rawArguments = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      delegate.functionCall.args,
    ));
  } catch {
    throw new Error("Signed delegate has malformed ft_transfer arguments");
  }
  const transfer = parseFtTransferArgs(delegate.functionCall.args);
  invariant(
    Object.keys(rawArguments).sort().join(",") === "amount,receiver_id",
    "Signed delegate contains unexpected ft_transfer arguments",
  );
  invariant(transfer.receiver_id === expected.payTo, "Signed delegate recipient does not match the fixture");
  invariant(transfer.amount === expected.amountText, "Signed delegate amount does not match the fixture");
  if (expected.nonce !== undefined) {
    invariant(delegate.nonce === expected.nonce, "Signed delegate nonce is not the expected access-key nonce");
  }
  if (expected.maxBlockHeight !== undefined) {
    invariant(
      delegate.maxBlockHeight === expected.maxBlockHeight,
      "Signed delegate maximum height does not equal final height plus timeout",
    );
  }
  return decoded;
}

function decodedPublicKeyString(publicKey) {
  const ed25519 = publicKey?.ed25519Key?.data;
  if (ed25519) return `ed25519:${binary_to_base58(Uint8Array.from(ed25519))}`;
  const secp256k1 = publicKey?.secp256k1Key?.data;
  if (secp256k1) return `secp256k1:${binary_to_base58(Uint8Array.from(secp256k1))}`;
  throw new Error("Outer transaction contains an unsupported public key");
}

function inspectOuterSubmission(params, expected) {
  invariant(params && typeof params === "object", "send_tx params must be an object");
  invariant(params.wait_until === "FINAL", "Settlement must use wait_until FINAL");
  invariant(typeof params.signed_tx_base64 === "string", "send_tx is missing signed_tx_base64");

  let decoded;
  try {
    decoded = decodeSignedTransaction(Buffer.from(params.signed_tx_base64, "base64"));
  } catch {
    throw new Error("Settlement contains a malformed outer transaction");
  }
  const { transaction } = decoded;
  invariant(transaction.signerId === expected.relayer, "Outer transaction signer is not the configured relayer");
  invariant(transaction.receiverId === expected.payer, "Outer transaction receiver is not the configured payer");
  if (expected.relayerPublicKey) {
    invariant(
      decodedPublicKeyString(transaction.publicKey) === expected.relayerPublicKey,
      "Outer transaction key is not the configured relayer key",
    );
  }
  invariant(transaction.actions.length === 1, "Outer transaction must contain one action");
  const signedDelegate = transaction.actions[0].signedDelegate;
  invariant(signedDelegate, "Outer transaction action is not a signed delegate");
  const encodedDelegate = Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64");
  const delegate = decodeAndAssertDelegate(encodedDelegate, expected);
  const transactionHash = binary_to_base58(
    sha256(encodeTransaction(transaction)),
  );

  return { decoded, delegate, encodedDelegate, transactionHash };
}

function mutationMethod(method) {
  return method === "send_tx" ||
    method === "broadcast_tx_async" ||
    method === "broadcast_tx_commit" ||
    method === "EXPERIMENTAL_send_tx";
}

function latestAccessKeyNonce(records, accountId, publicKey) {
  const record = records.findLast(item =>
    item.request?.method === "query" &&
    item.request?.params?.request_type === "view_access_key" &&
    item.request?.params?.account_id === accountId &&
    item.request?.params?.public_key === publicKey &&
    item.response?.result?.nonce !== undefined
  );
  invariant(record, `No final access-key read was observed for ${accountId}`);
  return BigInt(record.response.result.nonce);
}

function observedBlockHeights(records) {
  return records.flatMap(record =>
    record.request?.method === "block" && record.response?.result?.header?.height !== undefined
      ? [BigInt(record.response.result.header.height)]
      : []
  );
}

async function startRpcProxy(upstreamUrl, allowTransactions, expected) {
  const records = [];
  const submissions = [];
  const errors = [];
  let endpoint;

  const server = configureServer(createServer(async (request, response) => {
    let rpc;
    try {
      if (!endpoint || !validHost(request, endpoint.host)) {
        sendJson(response, 421, { error: "Misdirected request" });
        return;
      }
      if (request.method !== "POST" || request.url !== "/") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      rpc = await readJsonRequest(request);
      if (!rpc || typeof rpc !== "object" || Array.isArray(rpc) || typeof rpc.method !== "string") {
        throw new HttpInputError(400, "A single JSON-RPC request is required");
      }

      if (mutationMethod(rpc.method)) {
        if (!allowTransactions) {
          sendJson(response, 200, {
            jsonrpc: "2.0",
            id: rpc.id,
            error: { code: -32000, message: "Transactions are disabled in check-only mode" },
          });
          return;
        }
        if (rpc.method !== "send_tx") {
          throw new HttpInputError(403, `Mutation method ${rpc.method} is not permitted`);
        }
        if (submissions.length >= 1) {
          throw new HttpInputError(403, "This harness permits only one transaction submission");
        }
        const inspection = inspectOuterSubmission(rpc.params, expected);
        const payerNonce = latestAccessKeyNonce(
          records,
          expected.payer,
          inspection.delegate.delegate.publicKey,
        );
        invariant(
          inspection.delegate.delegate.nonce === payerNonce + 1n,
          "RPC firewall rejected a delegate nonce that was not the final access-key nonce plus one",
        );
        const relayerNonce = latestAccessKeyNonce(
          records,
          expected.relayer,
          expected.relayerPublicKey,
        );
        invariant(
          inspection.decoded.transaction.nonce === relayerNonce + 1n,
          "RPC firewall rejected an outer nonce that was not the final relayer nonce plus one",
        );

        const heights = observedBlockHeights(records);
        invariant(heights.length > 0, "RPC firewall did not observe a final block height");
        if (expected.mode === "execute") {
          invariant(
            inspection.delegate.delegate.maxBlockHeight ===
              heights[0] + BigInt(MAX_TIMEOUT_SECONDS),
            "RPC firewall rejected a local delegate with the wrong timeout height",
          );
        } else {
          const currentHeight = heights[heights.length - 1];
          invariant(
            inspection.delegate.delegate.maxBlockHeight > currentHeight &&
              inspection.delegate.delegate.maxBlockHeight <=
                currentHeight + BigInt(MAX_TIMEOUT_SECONDS),
            "RPC firewall rejected a wallet delegate outside the configured timeout window",
          );
        }
        submissions.push({ request: rpc, response: undefined, ...inspection });
      }

      const record = { request: rpc, response: undefined };
      records.push(record);
      const upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rpc),
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
      const bytes = Buffer.from(await upstreamResponse.arrayBuffer());
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new Error("Upstream RPC returned malformed JSON");
      }
      record.response = parsedResponse;
      if (rpc.method === "send_tx" && submissions.length > 0) {
        submissions[submissions.length - 1].response = parsedResponse;
      }
      response.writeHead(upstreamResponse.status, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "content-length": bytes.length,
        "x-content-type-options": "nosniff",
      });
      response.end(bytes);
    } catch (error) {
      errors.push(error);
      const status = error instanceof HttpInputError ? error.status : 502;
      sendJson(response, status, {
        jsonrpc: "2.0",
        id: rpc?.id ?? null,
        error: {
          code: status === 502 ? -32001 : -32600,
          message: status === 502 ? "RPC proxy transport failed" : safeErrorMessage(error),
        },
      });
    }
  }), 120_000);

  endpoint = await listenLoopback(server);
  return {
    ...endpoint,
    server,
    records,
    submissions,
    errors,
    resetRecords() {
      records.length = 0;
    },
  };
}

async function loadCredential(accountId, filename) {
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (error?.code === "ELOOP") {
      throw new Error(`Credential path must not be a symbolic link: ${filename}`);
    }
    throw new Error(`Could not open credential file: ${filename}`);
  }

  try {
    const metadata = await handle.stat();
    const metadataError = credentialMetadataError(
      metadata,
      typeof process.getuid === "function" ? process.getuid() : undefined,
    );
    if (metadataError) {
      const fix = metadataError.startsWith("Credential permissions")
        ? `; run chmod 600 ${shellArg(filename)}`
        : "";
      throw new Error(`${metadataError}: ${filename}${fix}`);
    }

    let credential;
    try {
      credential = JSON.parse(await handle.readFile("utf8"));
    } catch {
      throw new Error(`Credential file is not valid JSON: ${filename}`);
    }
    if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
      throw new Error(`Credential file must contain an object: ${filename}`);
    }
    if (credential.account_id !== accountId) {
      throw new Error(`Credential account does not exactly match ${accountId}: ${filename}`);
    }
    if (
      credential.private_key !== undefined &&
      credential.secret_key !== undefined &&
      credential.private_key !== credential.secret_key
    ) {
      throw new Error(`Credential has conflicting private_key and secret_key values: ${filename}`);
    }
    const secretKey = credential.private_key ?? credential.secret_key;
    if (typeof secretKey !== "string") {
      throw new Error(`Credential is missing private_key/secret_key: ${filename}`);
    }

    let signer;
    try {
      signer = signerFromPrivateKey(secretKey);
    } catch {
      throw new Error(`Credential contains an invalid private key: ${filename}`);
    }
    if (credential.public_key !== undefined && credential.public_key !== signer.publicKey) {
      throw new Error(`Credential public_key does not match its private key: ${filename}`);
    }
    return { accountId, filename, publicKey: signer.publicKey, secretKey };
  } finally {
    await handle.close();
  }
}

async function loadCredentials(options) {
  const specifications = [
    { role: "relayer", accountId: options.relayer, filename: options.relayerCredential },
  ];
  if (options.payerCredential) {
    specifications.unshift({
      role: "payer",
      accountId: options.payer,
      filename: options.payerCredential,
    });
  }

  const results = await Promise.allSettled(
    specifications.map(specification => loadCredential(
      specification.accountId,
      specification.filename,
    )),
  );
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [`${specifications[index].role}: ${safeErrorMessage(result.reason)}`]
    : []);
  if (failures.length > 0) {
    for (const result of results) {
      if (result.status === "fulfilled") result.value.secretKey = "";
    }
    throw new Error(`Credential preflight failed:\n- ${failures.join("\n- ")}`);
  }

  const loaded = Object.fromEntries(results.map((result, index) => [
    specifications[index].role,
    result.value,
  ]));
  if (loaded.payer && loaded.payer.publicKey === loaded.relayer.publicKey) {
    throw new Error("Payer and relayer credentials must not use the same public key");
  }
  return loaded;
}

function base64Json(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

async function queryFinal(rpcUrl, blockHash, request) {
  return callRpc(rpcUrl, "query", { ...request, block_id: blockHash });
}

async function viewAccount(rpcUrl, blockHash, accountId) {
  return queryFinal(rpcUrl, blockHash, {
    request_type: "view_account",
    account_id: accountId,
  });
}

async function viewAccessKey(rpcUrl, blockHash, accountId, publicKey) {
  return queryFinal(rpcUrl, blockHash, {
    request_type: "view_access_key",
    account_id: accountId,
    public_key: publicKey,
  });
}

async function callFunction(rpcUrl, blockHash, contractId, methodName, args) {
  const result = await queryFinal(rpcUrl, blockHash, {
    request_type: "call_function",
    account_id: contractId,
    method_name: methodName,
    args_base64: base64Json(args),
  });
  if (typeof result?.error === "string") {
    throw new Error(result.error);
  }
  try {
    return JSON.parse(Buffer.from(result.result).toString("utf8"));
  } catch {
    throw new Error(`${contractId}.${methodName} returned malformed JSON`);
  }
}

async function ftBalanceOf(rpcUrl, blockHash, token, accountId) {
  const value = await callFunction(rpcUrl, blockHash, token, "ft_balance_of", {
    account_id: accountId,
  });
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error(`${token}.ft_balance_of returned a non-integer balance`);
  }
  return BigInt(value);
}

function methodMissing(error) {
  const detail = error instanceof RpcResponseError
    ? `${error.message} ${jsonStringify(error.rpcError)}`
    : safeErrorMessage(error);
  return /MethodNotFound|MethodResolveError|MethodEmptyName/i.test(detail);
}

async function collectChainSnapshot(rpcUrl, options, payerPublicKey, relayerPublicKey) {
  const block = await callRpc(rpcUrl, "block", { finality: "final" });
  const blockHash = block?.header?.hash;
  invariant(typeof blockHash === "string", "Final block response is missing its hash");
  const blockHeight = BigInt(block.header.height);

  const [payerAccount, payToAccount, relayerAccount, tokenAccount] = await Promise.all([
    viewAccount(rpcUrl, blockHash, options.payer),
    viewAccount(rpcUrl, blockHash, options.payTo),
    viewAccount(rpcUrl, blockHash, options.relayer),
    viewAccount(rpcUrl, blockHash, options.asset),
  ]);
  const [payerToken, payToToken, payerKey, relayerKey] = await Promise.all([
    ftBalanceOf(rpcUrl, blockHash, options.asset, options.payer),
    ftBalanceOf(rpcUrl, blockHash, options.asset, options.payTo),
    payerPublicKey
      ? viewAccessKey(rpcUrl, blockHash, options.payer, payerPublicKey)
      : Promise.resolve(undefined),
    viewAccessKey(rpcUrl, blockHash, options.relayer, relayerPublicKey),
  ]);

  return {
    blockHash,
    blockHeight,
    payerAccount,
    payToAccount,
    relayerAccount,
    tokenAccount,
    payerToken,
    payToToken,
    payerKey,
    relayerKey,
  };
}

async function runPreflight(rpcUrl, options, credentials) {
  const status = await callRpc(rpcUrl, "status", []);
  invariant(status?.chain_id === CHAIN_ID, `RPC chain_id must be ${CHAIN_ID}`);
  const snapshot = await collectChainSnapshot(
    rpcUrl,
    options,
    credentials.payer?.publicKey,
    credentials.relayer.publicKey,
  );

  invariant(snapshot.tokenAccount.code_hash !== ZERO_CODE_HASH, "Configured token account has no contract code");
  invariant(snapshot.payerToken >= options.amount, "Payer token balance is below the configured amount");
  invariant(
    BigInt(snapshot.relayerAccount.amount) >= MIN_RELAYER_BALANCE,
    "Relayer has less than 0.1 testnet NEAR available",
  );
  if (snapshot.payerKey) {
    invariant(snapshot.payerKey.permission === "FullAccess", "Payer credential is not an on-chain FullAccess key");
  }
  invariant(snapshot.relayerKey.permission === "FullAccess", "Relayer credential is not an on-chain FullAccess key");

  let storage;
  try {
    storage = await callFunction(
      rpcUrl,
      snapshot.blockHash,
      options.asset,
      "storage_balance_of",
      { account_id: options.payTo },
    );
    invariant(storage !== null, "Recipient is not registered for storage with the token");
  } catch (error) {
    if (!methodMissing(error)) throw error;
    storage = undefined;
  }

  let metadata;
  try {
    metadata = await callFunction(rpcUrl, snapshot.blockHash, options.asset, "ft_metadata", {});
  } catch (error) {
    if (!methodMissing(error)) throw error;
  }

  console.log(`RPC lock: ${sanitizedRpcUrl(options.rpcUrl)} -> testnet at final height ${snapshot.blockHeight}`);
  console.log(`Payer: ${options.payer} (${snapshot.payerToken} atomic ${metadata?.symbol ?? options.asset})`);
  if (credentials.payer) console.log(`Payer FullAccess key: ${credentials.payer.publicKey}`);
  console.log(`Recipient: ${options.payTo} (${snapshot.payToToken} atomic before payment)`);
  console.log(`Recipient storage: ${storage === undefined ? "token does not expose storage_balance_of" : "registered"}`);
  console.log(`Relayer: ${options.relayer} (${snapshot.relayerAccount.amount} yoctoNEAR)`);
  console.log(`Relayer FullAccess key: ${credentials.relayer.publicKey}`);
  console.log(`Fixture: transfer ${options.amountText} atomic units of ${options.asset}`);
  return snapshot;
}

async function loadWalletAssets(bundleVersion) {
  const files = {
    html: path.join(REPO_ROOT, "examples/static/x402.html"),
    css: path.join(REPO_ROOT, "examples/static/style.css"),
    favicon: path.join(REPO_ROOT, "examples/static/assets/favicon.ico"),
    logo: path.join(REPO_ROOT, "examples/static/assets/fastnear_logo_black.png"),
    wallet: path.join(REPO_ROOT, "packages/wallet/dist/umd/browser.global.js"),
    x402: path.join(REPO_ROOT, "packages/x402/dist/umd/browser.global.js"),
  };
  try {
    const [html, css, favicon, logo] = await Promise.all([
      readFile(files.html, "utf8"),
      readFile(files.css),
      readFile(files.favicon),
      readFile(files.logo),
    ]);
    if (bundleVersion !== undefined) {
      return { html, css, favicon, logo };
    }
    const [wallet, x402] = await Promise.all([
      readFile(files.wallet),
      readFile(files.x402),
    ]);
    return { html, css, favicon, logo, wallet, x402 };
  } catch {
    throw new Error(
      bundleVersion === undefined
        ? "Wallet smoke assets are missing; run yarn build first"
        : "Wallet smoke page assets are missing",
    );
  }
}

function protectedResourceInfo(url) {
  return {
    url,
    description: "FastNEAR x402 testnet smoke fixture",
    mimeType: "application/json",
  };
}

async function startSellerServer(resourceServer, options, walletAssets, captureBaseline) {
  const state = {
    hits: 0,
    closed: false,
    payment: undefined,
    requirements: undefined,
    settlement: undefined,
    settlementError: undefined,
    requestError: undefined,
    baselinePromise: undefined,
    walletName: undefined,
  };
  const settlementSignal = createDeferred();
  const paymentStartedSignal = createDeferred();
  let endpoint;
  let requirements;
  let paymentRequired;
  let resourceInfo;

  const sendChallenge = async (response, error, paymentPayload) => {
    const challenge = error
      ? await resourceServer.createPaymentRequiredResponse(
        [requirements],
        resourceInfo,
        error,
        undefined,
        undefined,
        paymentPayload,
      )
      : paymentRequired;
    sendJson(response, 402, { error: error ?? "Payment required" }, {
      "payment-required": encodePaymentRequiredHeader(challenge),
    });
  };

  const server = configureServer(createServer(async (request, response) => {
    try {
      if (!endpoint || !validHost(request, endpoint.host)) {
        sendJson(response, 421, { error: "Misdirected request" });
        return;
      }
      const url = new URL(request.url, endpoint.url);
      if (url.search) throw new HttpInputError(400, "Query parameters are not accepted");

      if (walletAssets && request.method === "GET") {
        const staticRoutes = {
          "/style.css": ["text/css; charset=utf-8", walletAssets.css],
          "/assets/favicon.ico": ["image/x-icon", walletAssets.favicon],
          "/assets/fastnear_logo_black.png": ["image/png", walletAssets.logo],
        };
        if (walletAssets.wallet !== undefined && walletAssets.x402 !== undefined) {
          staticRoutes["/bundles/wallet.js"] = [
            "text/javascript; charset=utf-8",
            walletAssets.wallet,
          ];
          staticRoutes["/bundles/x402.js"] = [
            "text/javascript; charset=utf-8",
            walletAssets.x402,
          ];
        }
        if (url.pathname === "/" || url.pathname === "/x402.html") {
          const html = transformWalletSmokePage(walletAssets.html, {
            network: "testnet",
            endpoint: "/paid",
            payer: options.payer,
            payTo: options.payTo,
            asset: options.asset,
            amount: options.amountText,
            expectedWallet: options.expectedWallet,
            manifest: options.walletManifest,
          }, options.bundleVersion);
          sendBytes(response, "text/html; charset=utf-8", Buffer.from(html));
          return;
        }
        if (staticRoutes[url.pathname]) {
          sendBytes(response, ...staticRoutes[url.pathname]);
          return;
        }
      }

      if (url.pathname !== "/paid") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed" }, { allow: "GET" });
        return;
      }
      state.hits += 1;
      if (state.closed) {
        sendJson(response, 409, { error: "This one-payment smoke session is closed" });
        return;
      }

      if (walletAssets) {
        const walletName = request.headers["x-fastnear-smoke-wallet"];
        if (walletName !== options.expectedWallet) {
          sendJson(response, 400, { error: "Reported wallet does not match this smoke session" });
          return;
        }
        state.walletName = walletName;
      }

      state.baselinePromise ??= captureBaseline();
      await state.baselinePromise;

      const paymentHeader = request.headers["payment-signature"];
      if (typeof paymentHeader !== "string") {
        await sendChallenge(response);
        return;
      }

      let paymentPayload;
      try {
        paymentPayload = decodePaymentSignatureHeader(paymentHeader);
      } catch {
        await sendChallenge(response, "Malformed payment signature");
        return;
      }
      if (paymentPayload.x402Version !== 2) {
        await sendChallenge(response, "Only x402 v2 is accepted", paymentPayload);
        return;
      }
      const matched = resourceServer.findMatchingRequirements(
        paymentRequired.accepts,
        paymentPayload,
      );
      if (!matched) {
        await sendChallenge(response, "No matching payment requirements", paymentPayload);
        return;
      }
      const extensionResult = resourceServer.validateExtensions(paymentRequired, paymentPayload);
      if (!extensionResult.valid) {
        await sendChallenge(response, extensionResult.invalidReason, paymentPayload);
        return;
      }
      const verification = await resourceServer.verifyPayment(paymentPayload, matched);
      if (!verification.isValid || verification.payer !== options.payer) {
        await sendChallenge(
          response,
          verification.payer && verification.payer !== options.payer
            ? "Verified payer does not match this smoke session"
            : verification.invalidReason ?? "Payment verification failed",
          paymentPayload,
        );
        return;
      }

      // Verification performs RPC reads and yields to the event loop. Claim the
      // one-shot session atomically after it returns and before settlement can
      // yield, so concurrent paid requests cannot both reach the relayer.
      if (state.closed) {
        sendJson(response, 409, { error: "This one-payment smoke session is closed" });
        return;
      }
      state.closed = true;

      state.payment = paymentPayload;
      state.requirements = matched;
      paymentStartedSignal.resolve();
      let settlement;
      try {
        settlement = await resourceServer.settlePayment(paymentPayload, matched);
      } catch (error) {
        state.settlementError = error;
        settlementSignal.resolve(state);
        sendJson(response, 502, { error: "Settlement transport failed" });
        return;
      }
      state.settlement = settlement;
      settlementSignal.resolve(state);
      if (!settlement.success) {
        sendJson(response, 402, { error: settlement.errorReason ?? "Settlement failed" }, {
          "payment-response": encodePaymentResponseHeader(settlement),
        });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        resource: "FastNEAR x402 testnet fixture",
        payer: settlement.payer,
        transaction: settlement.transaction,
      }, {
        "payment-response": encodePaymentResponseHeader(settlement),
      });
    } catch (error) {
      state.requestError = error;
      const status = error instanceof HttpInputError ? error.status : 500;
      sendJson(response, status, {
        error: status === 500 ? "Seller transport failed" : safeErrorMessage(error),
      });
    }
  }), 120_000);

  try {
    endpoint = await listenLoopback(server, options.mode === "serve-wallet" ? options.port : 0);
    resourceInfo = protectedResourceInfo(`${endpoint.url}/paid`);
    [requirements] = await resourceServer.buildPaymentRequirementsFromOptions([{
      scheme: "exact",
      network: NETWORK,
      payTo: options.payTo,
      price: { asset: options.asset, amount: options.amountText },
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    }], {});
    paymentRequired = await resourceServer.createPaymentRequiredResponse(
      [requirements],
      resourceInfo,
    );
    state.requirements = requirements;

    const ensureBaseline = () => {
      state.baselinePromise ??= captureBaseline();
      return state.baselinePromise;
    };
    return {
      ...endpoint,
      server,
      state,
      settlementSignal,
      paymentStartedSignal,
      requirements,
      paymentRequired,
      ensureBaseline,
    };
  } catch (error) {
    await closeServer(server);
    throw error;
  }
}

async function startTopology(options, credentials, rpcProxy, captureBaseline) {
  const facilitator = createNearFacilitator({
    registrations: [{
      network: NETWORK,
      signer: {
        relayers: [{
          accountId: options.relayer,
          secretKey: credentials.relayer.secretKey,
        }],
        rpcUrls: { [NETWORK]: rpcProxy.url },
      },
      settlementCache: new SettlementCache(),
    }],
  });
  let seller;
  try {
    const resourceServer = createNearResourceServer({
      facilitators: facilitator,
    });
    await resourceServer.initialize();
    const walletAssets = options.mode === "serve-wallet"
      ? await loadWalletAssets(options.bundleVersion)
      : undefined;
    seller = await startSellerServer(
      resourceServer,
      options,
      walletAssets,
      captureBaseline,
    );
    return { resourceServer, seller };
  } catch (error) {
    await closeServer(seller?.server);
    throw error;
  }
}

function assertChallenge(challenge, options) {
  invariant(challenge.x402Version === 2, "Seller challenge is not x402 v2");
  invariant(challenge.accepts.length === 1, "Seller challenge must contain one requirement");
  const accepted = challenge.accepts[0];
  invariant(accepted.scheme === "exact", "Seller challenge scheme is not exact");
  invariant(accepted.network === NETWORK, "Seller challenge network is not near:testnet");
  invariant(accepted.asset === options.asset, "Seller challenge token does not match the fixture");
  invariant(accepted.amount === options.amountText, "Seller challenge amount does not match the fixture");
  invariant(accepted.payTo === options.payTo, "Seller challenge recipient does not match the fixture");
  invariant(
    accepted.maxTimeoutSeconds === MAX_TIMEOUT_SECONDS,
    "Seller challenge timeout does not match the fixture",
  );
}

async function runCheckOnly(topology, rpcProxy, options) {
  const response = await fetch(`${topology.seller.url}/paid`);
  invariant(response.status === 402, "Unpaid seller request did not return HTTP 402");
  const header = response.headers.get("payment-required");
  invariant(header, "Unpaid seller response omitted PAYMENT-REQUIRED");
  assertChallenge(decodePaymentRequiredHeader(header), options);

  invariant(rpcProxy.submissions.length === 0, "Check-only mode observed a transaction submission");
  console.log("Check-only PASS: in-process facilitator support and the 402 challenge are wired");
  console.log("No payment was signed and no transaction was submitted");
}

function firstClientSigningHeight(records) {
  const record = records.find(item => item.request?.method === "block");
  const height = record?.response?.result?.header?.height;
  invariant(height !== undefined, "Could not identify the local signer's final block height");
  return BigInt(height);
}

async function replaySettlement(topology, rpcProxy) {
  const { payment, requirements } = topology.seller.state;
  const replay = await topology.resourceServer.settlePayment(payment, requirements);
  invariant(replay.success === false, "A finalized signed delegate was settled twice");
  invariant(
    replay.errorReason === "invalid_exact_near_payload_delegate_action_nonce_already_used",
    `Finalized replay failed for an unexpected reason: ${replay.errorReason ?? "missing reason"}`,
  );
  invariant(rpcProxy.submissions.length === 1, "Replay caused a second transaction submission");
}

async function reconcileSettlement(topology, rpcProxy, options, credentials) {
  const state = topology.seller.state;
  if (state.settlementError) throw state.settlementError;
  invariant(state.payment, "Seller did not capture a payment payload");
  invariant(state.settlement?.success, `Settlement failed: ${state.settlement?.errorReason ?? "unknown error"}`);
  invariant(state.settlement.payer === options.payer, "Settlement payer does not match the fixture");
  invariant(state.settlement.network === NETWORK, "Settlement network does not match the fixture");
  invariant(rpcProxy.submissions.length === 1, "Settlement did not submit exactly one transaction");
  invariant(state.baselinePromise, "Seller did not capture a pre-signing chain baseline");
  const before = await state.baselinePromise;

  const signedDelegateAction = state.payment.payload?.signedDelegateAction;
  invariant(typeof signedDelegateAction === "string", "Payment payload omitted its signed delegate action");
  const signingHeight = options.mode === "execute"
    ? firstClientSigningHeight(rpcProxy.records)
    : undefined;
  const decodedDelegate = decodeAndAssertDelegate(signedDelegateAction, {
    payer: options.payer,
    relayer: options.relayer,
    asset: options.asset,
    payTo: options.payTo,
    amountText: options.amountText,
    publicKey: credentials.payer?.publicKey,
    nonce: before.payerKey ? BigInt(before.payerKey.nonce) + 1n : undefined,
    maxBlockHeight: signingHeight === undefined
      ? undefined
      : signingHeight + BigInt(MAX_TIMEOUT_SECONDS),
  });
  if (options.mode === "serve-wallet") {
    invariant(
      decodedDelegate.delegate.maxBlockHeight > before.blockHeight,
      "Wallet delegate was already expired when the smoke server started",
    );
  }

  const submission = rpcProxy.submissions[0];
  invariant(
    submission.encodedDelegate === signedDelegateAction,
    "Outer transaction did not embed the exact payment delegate bytes",
  );
  invariant(
    submission.decoded.transaction.nonce === BigInt(before.relayerKey.nonce) + 1n,
    "Outer transaction nonce is not the relayer access-key nonce plus one",
  );
  const transactionHash = submission.response?.result?.transaction_outcome?.id;
  invariant(typeof transactionHash === "string", "send_tx response omitted the transaction hash");
  invariant(
    state.settlement.transaction === transactionHash,
    "PAYMENT-RESPONSE transaction does not match the submitted transaction",
  );

  await replaySettlement(topology, rpcProxy);
  const after = await collectChainSnapshot(
    rpcProxy.url,
    options,
    decodedDelegate.delegate.publicKey,
    credentials.relayer.publicKey,
  );
  invariant(after.payerToken === before.payerToken - options.amount, "Payer token delta is not exactly -amount");
  invariant(after.payToToken === before.payToToken + options.amount, "Recipient token delta is not exactly +amount");
  invariant(
    BigInt(after.payerAccount.amount) === BigInt(before.payerAccount.amount),
    "Payer native NEAR balance changed during sponsored settlement",
  );
  invariant(
    BigInt(after.relayerAccount.amount) < BigInt(before.relayerAccount.amount),
    "Relayer native NEAR balance did not pay settlement costs",
  );
  invariant(
    BigInt(after.payerKey.nonce) === decodedDelegate.delegate.nonce,
    "Payer access-key nonce did not finalize at the delegate nonce",
  );
  invariant(
    BigInt(after.relayerKey.nonce) === BigInt(before.relayerKey.nonce) + 1n,
    "Relayer access-key nonce did not advance exactly once",
  );
  console.log(`Settlement PASS: ${transactionHash}`);
  console.log("Reconciliation PASS: exact token deltas, sponsored costs, both nonces, and replay rejection");
  return transactionHash;
}

async function runExecute(topology, rpcProxy, options, credentials) {
  await topology.seller.ensureBaseline();
  rpcProxy.resetRecords();
  const signer = createLocalNearSigner({
    accountId: options.payer,
    secretKey: credentials.payer.secretKey,
    rpcUrls: { [NETWORK]: rpcProxy.url },
  });
  const paidFetch = createNearPaymentFetch({ signer, network: NETWORK });
  const response = await paidFetch(`${topology.seller.url}/paid`);
  if (response.status !== 200 && topology.seller.state.requestError) {
    throw topology.seller.state.requestError;
  }
  if (response.status !== 200 && topology.seller.state.settlement) {
    const proxyError = rpcProxy.errors.at(-1);
    if (proxyError) throw proxyError;
    throw new Error(
      `Settlement failed: ${topology.seller.state.settlement.errorReason ?? "unknown error"}` +
        (topology.seller.state.settlement.errorMessage
          ? ` (${topology.seller.state.settlement.errorMessage})`
          : ""),
    );
  }
  invariant(response.status === 200, `Paid seller request returned HTTP ${response.status}`);
  const paymentResponseHeader = response.headers.get("payment-response");
  invariant(paymentResponseHeader, "Paid response omitted PAYMENT-RESPONSE");
  const paymentResponse = decodePaymentResponseHeader(paymentResponseHeader);
  invariant(paymentResponse.success, "PAYMENT-RESPONSE reports a failed settlement");
  invariant(topology.seller.state.hits === 2, "Paid fetch did not perform exactly one 402 retry");
  const body = await response.json();
  invariant(body.ok === true, "Paid seller response body did not report success");
  invariant(
    paymentResponse.transaction === topology.seller.state.settlement?.transaction,
    "PAYMENT-RESPONSE header does not match the seller settlement",
  );
  await reconcileSettlement(topology, rpcProxy, options, credentials);
}

async function waitForWalletSettlement(topology, signal, timeoutSeconds) {
  if (signal.aborted) throw signal.reason;
  let timer;
  try {
    const outcome = await Promise.race([
      topology.seller.settlementSignal.promise.then(state => ({ kind: "settled", state })),
      topology.seller.paymentStartedSignal.promise.then(() => ({ kind: "started" })),
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Wallet session timed out after ${timeoutSeconds} seconds`)),
          timeoutSeconds * 1_000,
        );
      }),
    ]);
    if (outcome.kind === "settled") return outcome.state;

    // The session timeout protects an idle browser listener. Once the seller
    // has claimed a verified payment, let the bounded RPC settlement path
    // finish so shutdown cannot create an avoidable unknown-status result.
    return await topology.seller.settlementSignal.promise;
  } finally {
    clearTimeout(timer);
  }
}

async function runServeWallet(topology, rpcProxy, options, credentials, signal) {
  rpcProxy.resetRecords();
  console.log(`Wallet QA page: ${topology.seller.url}/x402.html`);
  console.log(`Expected wallet account: ${options.payer}`);
  console.log(`Expected wallet: ${options.expectedWallet}`);
  console.log(
    options.bundleVersion === undefined
      ? "Browser bundles: local dist"
      : `Browser bundles: immutable npm version ${options.bundleVersion}`,
  );
  console.log("The server is loopback-only and will accept one settlement, then shut down");
  const state = await waitForWalletSettlement(
    topology,
    signal,
    options.walletTimeoutSeconds,
  );
  if (state.settlementError) throw state.settlementError;
  await reconcileSettlement(topology, rpcProxy, options, credentials);
  console.log(`Wallet QA record: ${state.walletName}`);
  console.log("Wallet smoke PASS; the one-shot server is closing");
}

function clearCredentials(credentials) {
  if (!credentials) return;
  for (const credential of Object.values(credentials)) {
    if (credential) credential.secretKey = "";
  }
}

export async function runHarness(argv = process.argv.slice(2)) {
  const values = parseHarnessArgs(argv);
  const options = normalizeHarnessOptions(values);
  if (options.mode === "help") {
    console.log(HELP);
    return;
  }

  let credentials;
  let rpcProxy;
  let topology;
  const abortController = new AbortController();
  const onSignal = signal => {
    const settlementStarted = Boolean(
      topology?.seller?.state?.payment || rpcProxy?.submissions?.length,
    );
    if (settlementStarted) {
      console.error(
        `Received ${signal} after payment processing began; waiting for bounded settlement reconciliation`,
      );
      return;
    }
    abortController.abort(new Error(`Received ${signal}`));
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    credentials = await loadCredentials(options);
    abortController.signal.throwIfAborted();
    rpcProxy = await startRpcProxy(
      options.rpcUrl,
      options.mode !== "check",
      {
        payer: options.payer,
        relayer: options.relayer,
        asset: options.asset,
        payTo: options.payTo,
        amountText: options.amountText,
        publicKey: credentials.payer?.publicKey,
        relayerPublicKey: credentials.relayer.publicKey,
        mode: options.mode,
      },
    );
    await runPreflight(rpcProxy.url, options, credentials);
    abortController.signal.throwIfAborted();
    const captureBaseline = () => collectChainSnapshot(
      rpcProxy.url,
      options,
      credentials.payer?.publicKey,
      credentials.relayer.publicKey,
    );
    topology = await startTopology(options, credentials, rpcProxy, captureBaseline);
    abortController.signal.throwIfAborted();

    if (options.mode === "check") {
      await runCheckOnly(topology, rpcProxy, options);
    } else if (options.mode === "execute") {
      await runExecute(topology, rpcProxy, options, credentials);
    } else {
      await runServeWallet(
        topology,
        rpcProxy,
        options,
        credentials,
        abortController.signal,
      );
    }
  } catch (error) {
    const submission = rpcProxy?.submissions?.[0];
    const transaction = topology?.seller?.state?.settlement?.transaction ??
      submission?.response?.result?.transaction_outcome?.id ??
      submission?.transactionHash;
    if (submission) {
      console.error(
        `A settlement may have landed. Do not rerun automatically; reconcile with: near tx-status ${shellArg(transaction)} ${shellArg(options.relayer)} --networkId testnet`,
      );
    }
    throw new Error(sanitizedErrorMessage(error, options.rpcUrl));
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await closeServer(topology?.seller?.server);
    await closeServer(rpcProxy?.server);
    clearCredentials(credentials);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runHarness().catch(error => {
    console.error(`x402 testnet smoke failed: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
