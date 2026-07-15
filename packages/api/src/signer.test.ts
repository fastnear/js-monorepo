import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyToString, memoryStore, toBase58 } from "@fastnear/utils";
import type { TransactionSigner } from "@fastnear/utils";
import {
  actions,
  sendTx,
  state,
} from "./near.js";
import { NETWORKS } from "./state.js";
import { __resetNonceLocks } from "./nonce.js";

const originalFetch = global.fetch;
const blockHash = toBase58(new Uint8Array(32));

function jsonResponse(payload: any) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(payload),
  };
}

function rpcMethod(request: any): { method: string; params: any } {
  const body = JSON.parse(String(request?.body));
  return { method: body.method, params: body.params };
}

function mockRpc({
  protocolVersion = 85,
  permission = "FullAccess",
  onSendTx,
}: {
  protocolVersion?: number;
  permission?: any;
  onSendTx?: () => void | Promise<void>;
} = {}) {
  global.fetch = vi.fn(async (_url: any, request: any) => {
    const { method, params } = rpcMethod(request);
    if (method === "status") {
      return jsonResponse({ result: { protocol_version: protocolVersion } });
    }
    if (method === "query" && params.request_type === "view_access_key") {
      return jsonResponse({ result: { nonce: 10, permission } });
    }
    if (method === "block") {
      return jsonResponse({
        result: {
          header: {
            hash: blockHash,
            timestamp_nanosec: String(BigInt(Date.now()) * 1_000_000n),
          },
        },
      });
    }
    if (method === "send_tx") {
      await onSendTx?.();
      return jsonResponse({ result: { final_execution_status: "FINAL" } });
    }
    if (method === "tx") {
      return jsonResponse({ result: { status: { SuccessValue: "" } } });
    }
    throw new Error(`Unexpected RPC method: ${method}`);
  }) as any;
}

function methodsCalled(): string[] {
  return (global.fetch as any).mock.calls.map(([, request]: any[]) => rpcMethod(request).method);
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

function mlDsaSigner(): TransactionSigner {
  return {
    publicKey: `ml-dsa-65:${toBase58(new Uint8Array(1952).fill(7))}`,
    signHash: vi.fn(() => new Uint8Array(3309).fill(9)),
  } as TransactionSigner;
}

beforeEach(() => {
  global.fetch = vi.fn();
  memoryStore.clear();
  __resetNonceLocks();
  state.resetTxHistory();
  state.setWalletProvider(null as any);
  state.setConfig({ ...NETWORKS.mainnet, apiKey: null });
  for (const network of ["mainnet", "testnet"] as const) {
    state.updateAccountState(
      { accountId: null, privateKey: null, accessKeyContractId: null, lastWalletId: null },
      network,
    );
  }
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("sendTx explicit signer", () => {
  it("signs without wallet or persisted account state", async () => {
    mockRpc();
    const signer = edSigner(1);

    await sendTx({
      signer,
      signerId: "device.testnet",
      receiverId: "receiver.testnet",
      actions: [actions.transfer("1")],
      network: "testnet",
      waitUntil: "FINAL",
    });

    expect(signer.signHash).toHaveBeenCalledOnce();
    expect(methodsCalled()).toEqual(["query", "block", "send_tx", "tx"]);
  });

  it("requires signer and signerId together", async () => {
    await expect(sendTx({
      signer: edSigner(2),
      receiverId: "receiver.testnet",
      actions: [actions.transfer("1")],
      network: "testnet",
    } as any)).rejects.toThrow("signer and signerId must be paired");

    await expect(sendTx({
      signerId: "device.testnet",
      receiverId: "receiver.testnet",
      actions: [actions.transfer("1")],
      network: "testnet",
    } as any)).rejects.toThrow("signer and signerId must be paired");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("allows an authorized zero-deposit function call through a restricted key", async () => {
    mockRpc({
      permission: {
        FunctionCall: {
          allowance: "1000000000000000000000000",
          receiver_id: "contract.testnet",
          method_names: ["allowed"],
        },
      },
    });
    const signer = edSigner(4);

    await sendTx({
      signer,
      signerId: "device.testnet",
      receiverId: "contract.testnet",
      actions: [actions.functionCall({ methodName: "allowed", deposit: "0" })],
      network: "testnet",
    });

    expect(signer.signHash).toHaveBeenCalledOnce();
  });

  it("rejects actions outside a function-call key's permission", async () => {
    mockRpc({
      permission: {
        FunctionCall: {
          allowance: null,
          receiver_id: "contract.testnet",
          method_names: ["allowed"],
        },
      },
    });

    await expect(sendTx({
      signer: edSigner(3),
      signerId: "device.testnet",
      receiverId: "contract.testnet",
      actions: [actions.functionCall({ methodName: "denied" })],
      network: "testnet",
    })).rejects.toThrow("not permitted");
    expect(methodsCalled()).toEqual(["query"]);
  });

  it("gates an ML-DSA signer on the active protocol version", async () => {
    mockRpc({ protocolVersion: 84 });

    await expect(sendTx({
      signer: mlDsaSigner(),
      signerId: "device.testnet",
      receiverId: "device.testnet",
      actions: [actions.transfer("1")],
      network: "testnet",
    })).rejects.toThrow("requires v85+");
    expect(methodsCalled()).toEqual(["status"]);
  });

  it("recursively gates nested ML-DSA actions", async () => {
    mockRpc({ protocolVersion: 84 });
    const signer = edSigner(5);

    await expect(sendTx({
      signer,
      signerId: "device.testnet",
      receiverId: "relay.testnet",
      network: "testnet",
      actions: [{
        type: "SignedDelegate",
        delegateAction: {
          senderId: "device.testnet",
          receiverId: "device.testnet",
          actions: [{
            type: "AddKey",
            publicKey: mlDsaSigner().publicKey,
            accessKey: { permission: "FullAccess" },
          }],
          nonce: 1,
          maxBlockHeight: 100,
          publicKey: signer.publicKey,
        },
        signature: new Uint8Array(64),
      }],
    })).rejects.toThrow("requires v85+");
    expect(methodsCalled()).toEqual(["status"]);
  });

  it("rejects an ML-DSA validator key before delegating to a wallet", async () => {
    const sendTransaction = vi.fn();
    state.setWalletProvider({
      isConnected: () => true,
      sendTransaction,
    } as any);
    state.updateAccountState({ accountId: "validator.testnet" }, "testnet");

    await expect(sendTx({
      receiverId: "validator.testnet",
      actions: [{
        type: "Stake",
        stake: "1",
        publicKey: mlDsaSigner().publicKey,
      }],
      network: "testnet",
    })).rejects.toThrow("validator staking keys must be Ed25519");

    expect(sendTransaction).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a hash handle in a wallet-bound key action", async () => {
    const sendTransaction = vi.fn();
    state.setWalletProvider({
      isConnected: () => true,
      sendTransaction,
    } as any);
    state.updateAccountState({ accountId: "device.testnet" }, "testnet");

    await expect(sendTx({
      receiverId: "device.testnet",
      actions: [{
        type: "DeleteKey",
        publicKey: "ml-dsa-65-hash:11111111111111111111111111111111",
      } as any],
      network: "testnet",
    })).rejects.toThrow("handles cannot be used");

    expect(sendTransaction).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("serializes and submits an ML-DSA signature on protocol 85", async () => {
    mockRpc({ protocolVersion: 85 });
    const signer = mlDsaSigner();

    await sendTx({
      signer,
      signerId: "device.testnet",
      receiverId: "device.testnet",
      actions: [actions.transfer("1")],
      network: "testnet",
    });

    expect(signer.signHash).toHaveBeenCalledOnce();
    expect(methodsCalled()).toEqual(["status", "query", "block", "send_tx", "tx"]);
  });

  it("caches protocol support per RPC URL and rechecks a changed URL", async () => {
    mockRpc({ protocolVersion: 85 });
    const signer = mlDsaSigner();
    const send = () => sendTx({
      signer,
      signerId: "device.testnet",
      receiverId: "device.testnet",
      actions: [actions.transfer("1")],
      network: "testnet" as const,
    });

    state.setConfig({
      networkId: "testnet",
      services: {
        rpc: { baseUrl: "https://ml-dsa-cache-a.invalid/" },
      },
    });
    await send();
    await send();
    expect(methodsCalled().filter((method) => method === "status")).toHaveLength(1);

    state.setConfig({
      services: { rpc: { baseUrl: "https://ml-dsa-cache-b.invalid/" } },
    });
    await send();
    expect(methodsCalled().filter((method) => method === "status")).toHaveLength(2);
  });

  it("keeps concurrent accounts and keys in distinct nonce scopes", async () => {
    mockRpc();
    const first = edSigner(6);
    const second = edSigner(7);

    await Promise.all([
      sendTx({
        signer: first,
        signerId: "first.testnet",
        receiverId: "first.testnet",
        actions: [actions.transfer("1")],
        network: "testnet",
      }),
      sendTx({
        signer: second,
        signerId: "second.testnet",
        receiverId: "second.testnet",
        actions: [actions.transfer("1")],
        network: "testnet",
      }),
    ]);

    const nonceKeys = [...memoryStore.keys()].filter((key) =>
      key.startsWith("__fastnear_nonce.testnet."),
    );
    expect(nonceKeys).toHaveLength(2);
    expect(nonceKeys.some((key) => key.includes("first.testnet"))).toBe(true);
    expect(nonceKeys.some((key) => key.includes("second.testnet"))).toBe(true);
    expect(first.signHash).toHaveBeenCalledOnce();
    expect(second.signHash).toHaveBeenCalledOnce();
  });

  it("submits concurrent transactions from one async signer in nonce order", async () => {
    const events: string[] = [];
    mockRpc({
      onSendTx: () => {
        events.push("submit");
      },
    });

    let releaseFirstSignature!: () => void;
    const firstSignatureReady = new Promise<void>((resolve) => {
      releaseFirstSignature = resolve;
    });
    const publicKey = edSigner(8).publicKey;
    const first: TransactionSigner = {
      publicKey,
      signHash: vi.fn(async () => {
        events.push("sign-first");
        await firstSignatureReady;
        return new Uint8Array(64).fill(8);
      }),
    };
    const second: TransactionSigner = {
      publicKey,
      signHash: vi.fn(() => {
        events.push("sign-second");
        return new Uint8Array(64).fill(8);
      }),
    };

    const firstSend = sendTx({
      signer: first,
      signerId: "device.testnet",
      receiverId: "device.testnet",
      actions: [actions.transfer("1")],
      network: "testnet",
    });
    await vi.waitFor(() => expect(first.signHash).toHaveBeenCalledOnce());

    const secondSend = sendTx({
      signer: second,
      signerId: "device.testnet",
      receiverId: "device.testnet",
      actions: [actions.transfer("2")],
      network: "testnet",
    });
    await Promise.resolve();

    // The second call may not sign (and therefore cannot submit) while the
    // first call still owns this access key's ordered transaction slot.
    expect(second.signHash).not.toHaveBeenCalled();
    expect(events).toEqual(["sign-first"]);

    releaseFirstSignature();
    await Promise.all([firstSend, secondSend]);

    expect(events).toEqual(["sign-first", "submit", "sign-second", "submit"]);
  });
});
