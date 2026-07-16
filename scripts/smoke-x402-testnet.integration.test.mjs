import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decodeSignedTransaction, encodeTransaction } from "@near-js/transactions";
import { sha256 } from "@noble/hashes/sha2.js";
import { binary_to_base58 } from "base58-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runHarness } from "./smoke-x402-testnet.mjs";

const PAYER_SECRET_KEY =
  "ed25519:1GMkH3brNXiNNs1tiFZHu4yZSRrzJwxi5wB9bHFtMikjwpAW9DMZzU2Pqakc5it8X3N5vPmqdN7KF4CCUpmKhq";
const RELAYER_SECRET_KEY =
  "ed25519:AADF5hC4G2hkMNESSHciZowNS79kocbrrSQAkSU7fuUnbvpRJFV9zP6G9GV2vLWFJTmuEyoYSXQiuVczdB5fqU4";
const ZERO_HASH = "11111111111111111111111111111111";
const TOKEN_CODE_HASH = "DqWvPnmrMHuQaBnMmLbQ7a7d3i4vdenYMWGyUUFcet8Q";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockRpcResponse(rpc) {
  if (rpc.method === "status") {
    return { chain_id: "testnet", sync_info: { latest_block_height: 1_000 } };
  }
  if (rpc.method === "block") {
    return { header: { height: 1_000, hash: ZERO_HASH } };
  }
  if (rpc.method !== "query") {
    throw new Error(`Unexpected RPC method in check-only test: ${rpc.method}`);
  }

  if (rpc.params.request_type === "view_account") {
    return {
      amount: rpc.params.account_id === "relayer.testnet"
        ? "1000000000000000000000000"
        : "5000000000000000000000000",
      locked: "0",
      code_hash: rpc.params.account_id === "token.testnet"
        ? TOKEN_CODE_HASH
        : ZERO_HASH,
      storage_usage: 100,
      block_height: 1_000,
      block_hash: ZERO_HASH,
    };
  }
  if (rpc.params.request_type === "view_access_key") {
    return {
      nonce: rpc.params.account_id === "relayer.testnet" ? 7 : 41,
      permission: "FullAccess",
      block_height: 1_000,
      block_hash: ZERO_HASH,
    };
  }
  if (rpc.params.request_type === "call_function") {
    const args = JSON.parse(Buffer.from(rpc.params.args_base64, "base64").toString("utf8"));
    let value;
    if (rpc.params.method_name === "ft_balance_of") {
      value = args.account_id === "payer.testnet" ? "100" : "10";
    } else if (rpc.params.method_name === "storage_balance_of") {
      value = { total: "1", available: "0" };
    } else if (rpc.params.method_name === "ft_metadata") {
      value = { spec: "ft-1.0.0", name: "Mock", symbol: "MOCK", decimals: 6 };
    } else {
      throw new Error(`Unexpected view method: ${rpc.params.method_name}`);
    }
    return {
      result: Array.from(Buffer.from(JSON.stringify(value))),
      logs: [],
      block_height: 1_000,
      block_hash: ZERO_HASH,
    };
  }
  throw new Error(`Unexpected query type: ${rpc.params.request_type}`);
}

describe("x402 guarded testnet harness", () => {
  it("runs the complete in-process check-only topology without signing or submitting", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "fastnear-x402-check-"));
    const payerCredential = path.join(directory, "payer.json");
    const relayerCredential = path.join(directory, "relayer.json");
    await Promise.all([
      writeFile(payerCredential, JSON.stringify({
        account_id: "payer.testnet",
        private_key: PAYER_SECRET_KEY,
      }), { mode: 0o600 }),
      writeFile(relayerCredential, JSON.stringify({
        account_id: "relayer.testnet",
        private_key: RELAYER_SECRET_KEY,
      }), { mode: 0o600 }),
    ]);

    const originalFetch = globalThis.fetch;
    const rpcMethods = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://rpc.mock.test/") {
        const rpc = JSON.parse(String(init?.body));
        rpcMethods.push(rpc.method);
        const result = mockRpcResponse(rpc);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });
    const logs = [];
    vi.spyOn(console, "log").mockImplementation(message => logs.push(String(message)));

    try {
      await runHarness([
        "--check-only",
        "--payer", "payer.testnet",
        "--payer-credential", payerCredential,
        "--relayer", "relayer.testnet",
        "--relayer-credential", relayerCredential,
        "--pay-to", "merchant.testnet",
        "--asset", "token.testnet",
        "--amount", "1",
        "--rpc-url", "https://rpc.mock.test/",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(directory, { recursive: true, force: true });
    }

    expect(rpcMethods).toContain("status");
    expect(rpcMethods).not.toContain("send_tx");
    expect(logs).toContain(
      "Check-only PASS: in-process facilitator support and the 402 challenge are wired",
    );
    expect(logs).toContain("No payment was signed and no transaction was submitted");
  });

  it("runs one paid retry through the firewall and reconciles final state", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "fastnear-x402-execute-"));
    const payerCredential = path.join(directory, "payer.json");
    const relayerCredential = path.join(directory, "relayer.json");
    await Promise.all([
      writeFile(payerCredential, JSON.stringify({
        account_id: "payer.testnet",
        private_key: PAYER_SECRET_KEY,
      }), { mode: 0o600 }),
      writeFile(relayerCredential, JSON.stringify({
        account_id: "relayer.testnet",
        private_key: RELAYER_SECRET_KEY,
      }), { mode: 0o600 }),
    ]);

    const state = {
      payerNonce: 41,
      relayerNonce: 7,
      payerToken: 100n,
      recipientToken: 10n,
      payerNear: 5_000_000_000_000_000_000_000_000n,
      relayerNear: 1_000_000_000_000_000_000_000_000n,
      sendCount: 0,
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== "https://rpc.mock.test/") return originalFetch(input, init);

      const rpc = JSON.parse(String(init?.body));
      let result;
      if (rpc.method === "status") {
        result = { chain_id: "testnet" };
      } else if (rpc.method === "block") {
        result = { header: { height: 1_000, hash: ZERO_HASH } };
      } else if (rpc.method === "send_tx") {
        state.sendCount += 1;
        const signed = decodeSignedTransaction(
          Buffer.from(rpc.params.signed_tx_base64, "base64"),
        );
        const transactionHash = binary_to_base58(
          sha256(encodeTransaction(signed.transaction)),
        );
        state.payerNonce += 1;
        state.relayerNonce += 1;
        state.payerToken -= 1n;
        state.recipientToken += 1n;
        state.relayerNear -= 100_000_000_000_000_000_000n;
        result = {
          status: { SuccessValue: "" },
          transaction_outcome: { id: transactionHash },
          receipts_outcome: [{
            outcome: {
              executor_id: "token.testnet",
              status: { SuccessValue: "" },
            },
          }],
        };
      } else if (rpc.method === "query" && rpc.params.request_type === "view_account") {
        const accountId = rpc.params.account_id;
        result = {
          amount: accountId === "payer.testnet"
            ? state.payerNear.toString()
            : accountId === "relayer.testnet"
              ? state.relayerNear.toString()
              : "5000000000000000000000000",
          locked: "0",
          code_hash: accountId === "token.testnet" ? TOKEN_CODE_HASH : ZERO_HASH,
          storage_usage: 100,
          block_height: 1_000,
          block_hash: ZERO_HASH,
        };
      } else if (rpc.method === "query" && rpc.params.request_type === "view_access_key") {
        result = {
          nonce: rpc.params.account_id === "relayer.testnet"
            ? state.relayerNonce
            : state.payerNonce,
          permission: "FullAccess",
          block_height: 1_000,
          block_hash: ZERO_HASH,
        };
      } else if (rpc.method === "query" && rpc.params.request_type === "call_function") {
        const args = JSON.parse(Buffer.from(rpc.params.args_base64, "base64").toString("utf8"));
        let value;
        if (rpc.params.method_name === "ft_balance_of") {
          value = args.account_id === "payer.testnet"
            ? state.payerToken.toString()
            : state.recipientToken.toString();
        } else if (rpc.params.method_name === "storage_balance_of") {
          value = { total: "1", available: "0" };
        } else if (rpc.params.method_name === "ft_metadata") {
          value = { spec: "ft-1.0.0", name: "Mock", symbol: "MOCK", decimals: 6 };
        } else {
          throw new Error(`Unexpected view method: ${rpc.params.method_name}`);
        }
        result = {
          result: Array.from(Buffer.from(JSON.stringify(value))),
          logs: [],
          block_height: 1_000,
          block_hash: ZERO_HASH,
        };
      } else {
        throw new Error(`Unexpected RPC request: ${rpc.method}`);
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const logs = [];
    vi.spyOn(console, "log").mockImplementation(message => logs.push(String(message)));

    try {
      await runHarness([
        "--execute",
        "--payer", "payer.testnet",
        "--payer-credential", payerCredential,
        "--relayer", "relayer.testnet",
        "--relayer-credential", relayerCredential,
        "--pay-to", "merchant.testnet",
        "--asset", "token.testnet",
        "--amount", "1",
        "--rpc-url", "https://rpc.mock.test/",
        "--confirm-network", "testnet",
        "--confirm-payer", "payer.testnet",
        "--confirm-pay-to", "merchant.testnet",
        "--confirm-relayer", "relayer.testnet",
        "--confirm-asset", "token.testnet",
        "--confirm-amount", "1",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(directory, { recursive: true, force: true });
    }

    expect(state.sendCount).toBe(1);
    expect(state.payerToken).toBe(99n);
    expect(state.recipientToken).toBe(11n);
    expect(logs.some(message => message.startsWith("Settlement PASS: "))).toBe(true);
    expect(logs).toContain(
      "Reconciliation PASS: exact token deltas, sponsored costs, both nonces, and replay rejection",
    );
  });
});
