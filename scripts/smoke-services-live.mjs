import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const apiBundlePath = path.join(repoRoot, "packages/api/dist/esm/index.js");

if (!existsSync(apiBundlePath)) {
  throw new Error(
    "Missing built @fastnear/api bundle. Run `yarn workspace @fastnear/api build` or `yarn smoke:services:live`."
  );
}

const {
  api,
  config,
  fastdata,
  neardata,
  queryAccount,
  transfers,
  tx,
} = await import(pathToFileURL(apiBundlePath).href);

const FASTNEAR_API_KEY = process.env.FASTNEAR_API_KEY || undefined;

const MAINNET_RPC_URL = "https://rpc.mainnet.fastnear.com/";
const ARCHIVAL_RPC_URL = "https://archival-rpc.mainnet.fastnear.com/";
const ARCHIVAL_BLOCK_HEIGHT = 75590392;
const ARCHIVAL_BLOCK_HASH = "9rbKPCYX12JpqjEPuLJb6ych736vzRnzPFPjg4UCCps9";
const ACCOUNT_ID = "root.near";
const KV_TARGET = {
  currentAccountId: "social.near",
  predecessorId: "james.near",
  key: "graph/follow/sleet.near",
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function configureMainnetRpc(nodeUrl = MAINNET_RPC_URL) {
  config({
    networkId: "mainnet",
    apiKey: FASTNEAR_API_KEY,
    nodeUrl,
    services: {
      rpc: { baseUrl: nodeUrl },
    },
  });
}

function isRetryableTransportError(error) {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "econnreset",
    "socket hang up",
    "temporarily unavailable",
  ].some((marker) => message.includes(marker));
}

async function withTimeout(label, run, timeoutMs = 20000) {
  let timeoutId;

  try {
    return await Promise.race([
      run(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runCheck(label, run, validate) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await withTimeout(label, run);
      validate(result);
      console.log(`PASS ${label}`);
      return result;
    } catch (error) {
      if (attempt === 1 && isRetryableTransportError(error)) {
        console.error(`RETRY ${label}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`${label}: exceeded retry budget`);
}

await runCheck(
  "rpc latest queryAccount",
  async () => {
    configureMainnetRpc();
    return queryAccount({ accountId: ACCOUNT_ID });
  },
  (response) => {
    assert(response?.result?.amount, "expected result.amount");
    assert(response?.result?.block_hash, "expected result.block_hash");
    assert(Number(response?.result?.block_height) > 0, "expected result.block_height > 0");
  }
);

await runCheck(
  "rpc archival queryAccount",
  async () => {
    configureMainnetRpc(ARCHIVAL_RPC_URL);
    return queryAccount({
      accountId: ACCOUNT_ID,
      blockId: ARCHIVAL_BLOCK_HASH,
    });
  },
  (response) => {
    assert(response?.result?.block_hash === ARCHIVAL_BLOCK_HASH, "expected historical block_hash match");
    assert(
      Number(response?.result?.block_height) === ARCHIVAL_BLOCK_HEIGHT,
      `expected archival block_height ${ARCHIVAL_BLOCK_HEIGHT}`
    );
    assert(response?.result?.amount, "expected historical result.amount");
  }
);

await runCheck(
  "api accountFull",
  async () => {
    configureMainnetRpc();
    return api.v1.accountFull({ accountId: ACCOUNT_ID });
  },
  (response) => {
    assert(response?.account_id === ACCOUNT_ID, `expected account_id ${ACCOUNT_ID}`);
    assert("nfts" in response, "expected accountFull response to expose nfts");
  }
);

await runCheck(
  "tx account",
  async () => {
    configureMainnetRpc();
    return tx.account({ accountId: ACCOUNT_ID, limit: 1 });
  },
  (response) => {
    assert(Array.isArray(response?.account_txs), "expected account_txs array");
    assert(response.account_txs.length > 0, "expected at least one account tx");
    assert(response.account_txs[0]?.account_id === ACCOUNT_ID, `expected tx row account_id ${ACCOUNT_ID}`);
  }
);

await runCheck(
  "transfers query",
  async () => {
    configureMainnetRpc();
    return transfers.query({ accountId: ACCOUNT_ID, limit: 1 });
  },
  (response) => {
    assert(Array.isArray(response?.transfers), "expected transfers array");
    assert(response.transfers.length > 0, "expected at least one transfer row");
    assert(response.transfers[0]?.account_id === ACCOUNT_ID, `expected transfer row account_id ${ACCOUNT_ID}`);
  }
);

await runCheck(
  "neardata lastBlockFinal",
  async () => {
    configureMainnetRpc();
    return neardata.lastBlockFinal();
  },
  (response) => {
    assert(response?.block?.author, "expected block.author");
    assert(Array.isArray(response?.block?.chunks), "expected block.chunks array");
  }
);

await runCheck(
  "fastdata kv getLatestKey",
  async () => {
    configureMainnetRpc();
    return fastdata.kv.getLatestKey(KV_TARGET);
  },
  (response) => {
    assert(Array.isArray(response?.entries), "expected entries array");
    assert(response.entries.length > 0, "expected at least one kv entry");
    const latest = response.entries[0];
    assert(
      latest?.current_account_id === KV_TARGET.currentAccountId,
      `expected current_account_id ${KV_TARGET.currentAccountId}`
    );
    assert(
      latest?.predecessor_id === KV_TARGET.predecessorId,
      `expected predecessor_id ${KV_TARGET.predecessorId}`
    );
    assert(latest?.key === KV_TARGET.key, `expected key ${KV_TARGET.key}`);
  }
);

console.log("PASS live services smoke");
