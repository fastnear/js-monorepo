import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base64ToBytes, keyToString, memoryStore, sha256, toBase58, SCHEMA } from "@fastnear/utils";
import type { TransactionSigner } from "@fastnear/utils";
import { deserialize } from "@fastnear/borsh";
import { actions, sendTx, state } from "./near.js";
import { NETWORKS } from "./state.js";
import { __resetNonceLocks } from "./nonce.js";

// Gas keys (protocol 85+) sign TransactionV1: a 0x01 prefix, a GasKeyNonce
// that names the nonce lane, and a trailing nonce-mode byte. sendTx detects
// the key from its view_access_key permission, reads the lane nonce from
// view_gas_key_nonces (the access-key nonce is always 0 for gas keys), and
// keeps one nonce cache per lane.

const originalFetch = global.fetch;
const blockHash = toBase58(new Uint8Array(32));
const GAS_FULL = (num_nonces: number, balance = "1000") => ({ GasKeyFullAccess: { balance, num_nonces } });

function jsonResponse(payload: any) {
  return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify(payload) };
}

function rpcMethod(request: any): { method: string; params: any } {
  const body = JSON.parse(String(request?.body));
  return { method: body.method, params: body.params };
}

function mockRpc({
  protocolVersion = 87,
  permission = GAS_FULL(2) as any,
  nonces = [10, 20],
  noncesPayload,
}: {
  protocolVersion?: number;
  permission?: any;
  nonces?: number[];
  noncesPayload?: any;
} = {}) {
  const sent: any[] = [];
  global.fetch = vi.fn(async (_url: any, request: any) => {
    const { method, params } = rpcMethod(request);
    if (method === "status") {
      return jsonResponse({ result: { protocol_version: protocolVersion } });
    }
    if (method === "query" && params.request_type === "view_access_key") {
      return jsonResponse({ result: { nonce: 0, permission } });
    }
    if (method === "query" && params.request_type === "view_gas_key_nonces") {
      return jsonResponse(noncesPayload ?? { result: { nonces, block_height: 1, block_hash: blockHash } });
    }
    if (method === "block") {
      return jsonResponse({
        result: { header: { hash: blockHash, height: 1000, timestamp_nanosec: String(BigInt(Date.now()) * 1_000_000n) } },
      });
    }
    if (method === "send_tx") {
      sent.push(params);
      return jsonResponse({ result: { final_execution_status: "FINAL" } });
    }
    if (method === "tx") {
      return jsonResponse({ result: { status: { SuccessValue: "" } } });
    }
    throw new Error(`Unexpected RPC method: ${method}`);
  }) as any;
  return sent;
}

function calls(): { method: string; params: any }[] {
  return (global.fetch as any).mock.calls.map(([, request]: any[]) => rpcMethod(request));
}

function methodsCalled(): string[] {
  return calls().map((c) => (c.method === "query" ? `query:${c.params.request_type}` : c.method));
}

function edSigner(byte: number): TransactionSigner {
  return {
    publicKey: keyToString(new Uint8Array(32).fill(byte), "ed25519"),
    signHash: vi.fn((hash: Uint8Array) => {
      expect(hash).toHaveLength(32);
      return new Uint8Array(64).fill(byte);
    }),
  } as TransactionSigner;
}

function decodeV1(sent: any) {
  const bytes = base64ToBytes(sent.signed_tx_base64);
  expect(bytes[0]).toBe(1);
  return { bytes, signed: deserialize(SCHEMA.SignedTransactionV1, bytes, { bigints: "bigint" }) as any };
}

const SIGNER_ID = "alice.testnet";

let urlCounter = 0;
/** Point testnet at a fresh RPC URL so the per-URL protocol-gate cache starts cold. */
function freshRpcUrl() {
  urlCounter += 1;
  state.setConfig({
    networkId: "testnet",
    services: { rpc: { baseUrl: `https://gas-key-test-${urlCounter}.invalid/` } },
  });
}
const send = (signer: TransactionSigner, extra: Record<string, any> = {}) =>
  sendTx({
    signer,
    signerId: SIGNER_ID,
    receiverId: "bob.testnet",
    actions: [actions.transfer("1")],
    network: "testnet",
    ...extra,
  });

beforeEach(() => {
  global.fetch = vi.fn();
  memoryStore.clear();
  __resetNonceLocks();
  state.resetTxHistory();
  state.setWalletProvider(null as any);
  state.setConfig({ ...NETWORKS.testnet, apiKey: null });
});

afterEach(() => {
  global.fetch = originalFetch;
  state.setWalletProvider(null as any);
});

describe("sendTx with a gas key signer", () => {
  it("signs TransactionV1 on the requested lane using that lane's nonce + 1", async () => {
    freshRpcUrl();
    const sent = mockRpc({ nonces: [10, 20] });
    const signer = edSigner(1);

    await send(signer, { nonceIndex: 1 });

    expect(sent).toHaveLength(1);
    const { signed } = decodeV1(sent[0]);
    expect(signed.transaction.version).toBe(1);
    expect(signed.transaction.nonce).toEqual({ gasKeyNonce: { nonce: 21n, nonceIndex: 1 } });
    expect(signed.transaction.nonceMode).toEqual({ monotonic: {} });
    expect(signed.transaction.actions).toEqual([{ transfer: { deposit: 1n } }]);
    // An explicit nonceIndex asks for TransactionV1, so the protocol gate runs
    // before the access-key lookup; the lane nonces are read after it.
    expect(methodsCalled()).toEqual(["status", "query:view_access_key", "query:view_gas_key_nonces", "block", "send_tx", "tx"]);
  });

  it("defaults to lane 0 and shares the classic nonce-cache scope for it", async () => {
    const sent = mockRpc({ nonces: [10, 20] });
    await send(edSigner(1));

    const { signed } = decodeV1(sent[0]);
    expect(signed.transaction.nonce).toEqual({ gasKeyNonce: { nonce: 11n, nonceIndex: 0 } });
    const nonceKeys = [...memoryStore.keys()].filter((k) => k.startsWith("__fastnear_nonce."));
    expect(nonceKeys).toHaveLength(1);
    expect(nonceKeys[0]).not.toMatch(/\.n\d+$/);
  });

  it("strict nonce mode sets the trailing NonceMode byte", async () => {
    const sent = mockRpc();
    await send(edSigner(1), { nonceIndex: 0, nonceMode: "strict" });

    const { bytes, signed } = decodeV1(sent[0]);
    expect(signed.transaction.nonceMode).toEqual({ strict: {} });
    // signature = 1 tag byte + 64 bytes; the byte before it is the nonce mode.
    expect(bytes[bytes.length - 65 - 1]).toBe(1);
  });

  it("keeps an independent nonce cache per lane", async () => {
    const sent = mockRpc({ nonces: [10, 20] });
    const signer = edSigner(1);

    await send(signer, { nonceIndex: 0 });
    await send(signer, { nonceIndex: 1 });
    await send(signer, { nonceIndex: 0 });

    const nonces = sent.map((s) => decodeV1(s).signed.transaction.nonce.gasKeyNonce);
    expect(nonces).toEqual([
      { nonce: 11n, nonceIndex: 0 },
      { nonce: 21n, nonceIndex: 1 },
      { nonce: 12n, nonceIndex: 0 }, // max(chain 10, cached 11) + 1
    ]);
    const nonceKeys = [...memoryStore.keys()].filter((k) => k.startsWith("__fastnear_nonce."));
    expect(nonceKeys).toHaveLength(2);
    expect(nonceKeys.some((k) => k.endsWith(".n1"))).toBe(true);
  });

  it("records the lane in tx history and hashes the V1 bytes it signed", async () => {
    const sent = mockRpc();
    await send(edSigner(1), { nonceIndex: 1 });

    const { bytes } = decodeV1(sent[0]);
    const txBytes = bytes.slice(0, bytes.length - 65);
    const record = Object.values(state.getTxHistory() as Record<string, any>).find((r: any) => r.txHash);
    expect(record.tx.nonceIndex).toBe(1);
    expect(record.txHash).toBe(toBase58(sha256(txBytes)));
    expect(record.signedTxBase64).toBe(sent[0].signed_tx_base64);
  });

  it("rejects a lane at or beyond num_nonces before fetching lane nonces", async () => {
    mockRpc({ permission: GAS_FULL(2) });
    await expect(send(edSigner(1), { nonceIndex: 2 })).rejects.toThrow("nonceIndex 2 is out of range");
    expect(methodsCalled()).not.toContain("query:view_gas_key_nonces");
  });

  it("rejects malformed nonceIndex values before any RPC call", async () => {
    mockRpc();
    for (const nonceIndex of [-1, 1.5, 1024, "1"]) {
      await expect(send(edSigner(1), { nonceIndex }), String(nonceIndex)).rejects.toThrow(
        "nonceIndex must be an integer in 0..1023",
      );
    }
    expect(methodsCalled()).toEqual([]);
  });

  it("rejects nonceIndex for a classical key and never asks for lane nonces", async () => {
    mockRpc({ permission: "FullAccess" });
    await expect(send(edSigner(1), { nonceIndex: 0 })).rejects.toThrow("only valid for gas keys");
    expect(methodsCalled()).not.toContain("query:view_gas_key_nonces");
  });

  it("classical keys stay on V0 even when sending gas-key actions", async () => {
    freshRpcUrl();
    const sent = mockRpc({ permission: "FullAccess" });
    const signer = edSigner(1);
    await sendTx({
      signer,
      signerId: SIGNER_ID,
      receiverId: SIGNER_ID,
      actions: [actions.transferToGasKey({ publicKey: edSigner(2).publicKey, deposit: "0.05 NEAR" })],
      network: "testnet",
    });
    const bytes = base64ToBytes(sent[0].signed_tx_base64);
    expect(bytes[0]).not.toBe(1);
    const signed = deserialize(SCHEMA.SignedTransaction, bytes, { bigints: "bigint" }) as any;
    expect(signed.transaction.actions[0].transferToGasKey.deposit).toBe(5n * 10n ** 22n);
    // Gas-key actions need protocol 85, so the gate ran once.
    expect(methodsCalled()[0]).toBe("status");
  });

  it("surfaces a JSON-RPC UNKNOWN_GAS_KEY failure from view_gas_key_nonces", async () => {
    mockRpc({
      noncesPayload: {
        error: {
          name: "HANDLER_ERROR",
          cause: { name: "UNKNOWN_GAS_KEY", info: {} },
          code: -32000,
          message: "Server error",
          data: "Gas key for public key ed25519:... does not exist while viewing",
        },
      },
    });
    await expect(send(edSigner(1))).rejects.toThrow(/UNKNOWN_GAS_KEY|does not exist/);
  });

  it("surfaces a result.error from view_gas_key_nonces", async () => {
    // The transport already rejects `result.error` payloads as contract errors.
    mockRpc({ noncesPayload: { result: { error: "Gas key does not exist" } } });
    await expect(send(edSigner(1))).rejects.toThrow("Gas key does not exist");
  });

  it("fails clearly when the lane is missing from the nonces response", async () => {
    mockRpc({ permission: GAS_FULL(2), nonces: [10] });
    await expect(send(edSigner(1), { nonceIndex: 1 })).rejects.toThrow("lane 1 is unavailable");
  });
});

describe("sendTx with a GasKeyFunctionCall key", () => {
  const permission = {
    GasKeyFunctionCall: {
      balance: "1000",
      num_nonces: 1,
      allowance: null,
      receiver_id: "counter.testnet",
      method_names: ["ping"],
    },
  };

  it("applies the function-call rules and signs V1 on lane 0", async () => {
    const sent = mockRpc({ permission });
    await sendTx({
      signer: edSigner(3),
      signerId: SIGNER_ID,
      receiverId: "counter.testnet",
      actions: [actions.functionCall({ methodName: "ping", args: {}, gas: "30 Tgas", deposit: "0" })],
      network: "testnet",
    });
    const { signed } = decodeV1(sent[0]);
    expect(signed.transaction.nonce).toEqual({ gasKeyNonce: { nonce: 11n, nonceIndex: 0 } });
  });

  it("refuses a transfer, a wrong receiver, and an unlisted method", async () => {
    mockRpc({ permission });
    await expect(send(edSigner(3))).rejects.toThrow("not permitted");
    await expect(
      sendTx({
        signer: edSigner(3),
        signerId: SIGNER_ID,
        receiverId: "counter.testnet",
        actions: [actions.functionCall({ methodName: "pong", args: {}, deposit: "0" })],
        network: "testnet",
      }),
    ).rejects.toThrow("not permitted");
    expect(methodsCalled()).not.toContain("query:view_gas_key_nonces");
  });
});

describe("gas-key protocol gate and ingress checks", () => {
  it("gates gas-key actions on protocol 85 before touching the chain", async () => {
    freshRpcUrl();
    mockRpc({ protocolVersion: 84, permission: "FullAccess" });
    await expect(
      sendTx({
        signer: edSigner(1),
        signerId: SIGNER_ID,
        receiverId: SIGNER_ID,
        actions: [actions.addFullAccessGasKey({ publicKey: edSigner(2).publicKey, numNonces: 2 })],
        network: "testnet",
      }),
    ).rejects.toThrow("Gas keys (TransactionV1) requires v85+; got 84");
    expect(methodsCalled()).toEqual(["status"]);
  });

  it("gates a gas-key signer discovered from its permission view, then caches per RPC URL", async () => {
    freshRpcUrl();
    mockRpc({ protocolVersion: 84 });
    await expect(send(edSigner(1))).rejects.toThrow("requires v85+");
    expect(methodsCalled()).toEqual(["query:view_access_key", "status"]);

    mockRpc({ protocolVersion: 87 });
    await send(edSigner(1));
    await send(edSigner(1));
    expect(methodsCalled().filter((m) => m === "status")).toHaveLength(1);
  });

  it("rejects AddKey of a gas key with a nonzero balance at ingress", async () => {
    mockRpc({ permission: "FullAccess" });
    await expect(
      sendTx({
        signer: edSigner(1),
        signerId: SIGNER_ID,
        receiverId: SIGNER_ID,
        actions: [{
          type: "AddKey",
          publicKey: edSigner(2).publicKey,
          accessKey: { permission: "GasKeyFullAccess", numNonces: 1, balance: "5" },
        }],
        network: "testnet",
      }),
    ).rejects.toThrow("balance must be 0");
    expect(methodsCalled()).toEqual([]);
  });

  it("validates gas-key action public keys like AddKey/DeleteKey", async () => {
    mockRpc({ permission: "FullAccess" });
    await expect(
      sendTx({
        signer: edSigner(1),
        signerId: SIGNER_ID,
        receiverId: SIGNER_ID,
        actions: [actions.withdrawFromGasKey({ publicKey: "ed25519:not-a-key", amount: "1" })],
        network: "testnet",
      }),
    ).rejects.toThrow();
    expect(methodsCalled()).toEqual([]);
  });

  it("refuses nonceIndex/nonceMode on the wallet path", async () => {
    mockRpc();
    state.setWalletProvider({
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendTransaction: vi.fn(async () => ({ ok: true })),
      accountId: vi.fn(() => SIGNER_ID),
      isConnected: vi.fn(() => true),
    } as any);
    state.updateAccountState({ accountId: SIGNER_ID, privateKey: null }, "testnet");
    await expect(
      sendTx({ receiverId: "bob.testnet", actions: [actions.transfer("1")], network: "testnet", nonceIndex: 0 }),
    ).rejects.toThrow("require local signing");
  });
});
