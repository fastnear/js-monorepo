import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore, privateKeyFromRandom, toBase58 } from "@fastnear/utils";
import { actions, sendTx, state } from "./near.js";
import { NETWORKS } from "./state.js";
import { __resetNonceLocks } from "./nonce.js";

// `sendTx` picks between signing locally with the slot's private key and
// handing the transaction to the wallet provider. The whole truth table is
// pinned here: only the unscoped-key row changed, and the scoped rows must
// keep behaving exactly as they did.
//
// Before this was fixed, `slot.accessKeyContractId` was write-null-only dead
// state — nothing in the package ever assigned it — so
// `receiverId !== slot.accessKeyContractId` was permanently true and the local
// path was unreachable without an explicit signer.

const originalFetch = global.fetch;

function jsonResponse(payload: any) {
  return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify(payload) };
}

function mockRpc() {
  const sent: any[] = [];
  global.fetch = vi.fn(async (_url: any, request: any) => {
    const body = JSON.parse(String(request?.body));
    if (body.method === "query" && body.params?.request_type === "view_access_key") {
      return jsonResponse({ result: { nonce: 10, permission: "FullAccess" } });
    }
    if (body.method === "block") {
      return jsonResponse({
        result: {
          header: { hash: toBase58(new Uint8Array(32)), height: 1000, timestamp_nanosec: "0" },
        },
      });
    }
    if (body.method === "send_tx") {
      sent.push(body.params);
      return jsonResponse({ result: { final_execution_status: "FINAL" } });
    }
    throw new Error(`Unexpected RPC method: ${body.method}`);
  }) as any;
  return sent;
}

function walletProvider() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendTransaction: vi.fn(async () => ({ ok: true })),
    accountId: vi.fn(() => "alice.testnet"),
    isConnected: vi.fn(() => true),
  };
}

const ZERO_DEPOSIT_CALL = () =>
  actions.functionCall({ methodName: "ping", args: {}, gas: "30 Tgas", deposit: "0" });
const TRANSFER = () => actions.transfer("1");

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

/** Seed the active slot the way the documented two-liner does. */
function storeKey(extra: Record<string, unknown> = {}) {
  state.updateAccountState(
    { accountId: "alice.testnet", privateKey: privateKeyFromRandom("ed25519"), ...extra },
    "testnet",
  );
}

describe("sendTx signer selection — unscoped key (the row that changed)", () => {
  it("signs locally with a stored full-access key", async () => {
    const sent = mockRpc();
    const provider = walletProvider();
    state.setWalletProvider(provider as any);
    storeKey();

    await sendTx({
      receiverId: "counter.testnet",
      actions: [ZERO_DEPOSIT_CALL()],
      network: "testnet",
    });

    expect(sent).toHaveLength(1);
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  });

  it("signs a transfer locally too — a full-access key is not limited to FunctionCall", async () => {
    const sent = mockRpc();
    const provider = walletProvider();
    state.setWalletProvider(provider as any);
    storeKey();

    await sendTx({ receiverId: "bob.testnet", actions: [TRANSFER()], network: "testnet" });

    expect(sent).toHaveLength(1);
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("sendTx signer selection — unchanged rows", () => {
  it("uses the wallet when no private key is stored", async () => {
    mockRpc();
    const provider = walletProvider();
    state.setWalletProvider(provider as any);
    state.updateAccountState({ accountId: "alice.testnet", privateKey: null }, "testnet");

    await sendTx({
      receiverId: "counter.testnet",
      actions: [ZERO_DEPOSIT_CALL()],
      network: "testnet",
    });

    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("signs locally when a scoped key matches the receiver with a zero-deposit call", async () => {
    const sent = mockRpc();
    const provider = walletProvider();
    state.setWalletProvider(provider as any);
    storeKey({ accessKeyContractId: "counter.testnet" });

    await sendTx({
      receiverId: "counter.testnet",
      actions: [ZERO_DEPOSIT_CALL()],
      network: "testnet",
    });

    expect(sent).toHaveLength(1);
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  });

  it("uses the wallet when a scoped key faces a non-LAK action", async () => {
    mockRpc();
    const provider = walletProvider();
    state.setWalletProvider(provider as any);
    storeKey({ accessKeyContractId: "counter.testnet" });

    await sendTx({ receiverId: "counter.testnet", actions: [TRANSFER()], network: "testnet" });

    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("uses the wallet when a scoped key faces a different receiver", async () => {
    mockRpc();
    const provider = walletProvider();
    state.setWalletProvider(provider as any);
    storeKey({ accessKeyContractId: "counter.testnet" });

    await sendTx({
      receiverId: "other.testnet",
      actions: [ZERO_DEPOSIT_CALL()],
      network: "testnet",
    });

    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
  });
});
