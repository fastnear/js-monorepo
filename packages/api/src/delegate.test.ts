import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyToString, memoryStore, toBase58, SCHEMA } from "@fastnear/utils";
import type { TransactionSigner } from "@fastnear/utils";
import { deserialize } from "@fastnear/borsh";
import { signDelegate, relayDelegate, actions, state } from "./near.js";
import { NETWORKS } from "./state.js";
import { __resetNonceLocks } from "./nonce.js";

const originalFetch = global.fetch;

function jsonResponse(payload: any) {
  return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify(payload) };
}

function rpcMethod(request: any): { method: string; params: any } {
  const body = JSON.parse(String(request?.body));
  return { method: body.method, params: body.params };
}

function mockRpc({ nonce = 10, height = 1000 }: { nonce?: number; height?: number } = {}) {
  global.fetch = vi.fn(async (_url: any, request: any) => {
    const { method, params } = rpcMethod(request);
    if (method === "query" && params.request_type === "view_access_key") {
      return jsonResponse({ result: { nonce, permission: "FullAccess" } });
    }
    if (method === "block") {
      return jsonResponse({
        result: {
          header: {
            hash: toBase58(new Uint8Array(32)),
            height,
            timestamp_nanosec: "0",
          },
        },
      });
    }
    if (method === "send_tx") {
      return jsonResponse({ result: { final_execution_status: "FINAL" } });
    }
    throw new Error(`Unexpected RPC method: ${method}`);
  }) as any;
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
});

describe("signDelegate", () => {
  it("reserves nonce (+1), derives maxBlockHeight, and returns decimal strings", async () => {
    mockRpc({ nonce: 10, height: 1000 });
    const signer = edSigner(1);
    const result = await signDelegate({
      receiverId: "counter.testnet",
      actions: [actions.functionCall({ methodName: "increment", gas: "30 Tgas", deposit: "0" })],
      signerId: "alice.testnet",
      signer,
      blockHeightTtl: 600,
      network: "testnet",
    });

    expect(result.delegateAction.nonce).toBe("11");
    expect(result.delegateAction.maxBlockHeight).toBe("1600");
    expect(result.delegateAction.senderId).toBe("alice.testnet");
    expect(result.delegateAction.publicKey).toBe(signer.publicKey);
    expect(typeof result.borshBase64).toBe("string");
    expect(signer.signHash).toHaveBeenCalledOnce();
  });

  it("honors an explicit maxBlockHeight without querying a block", async () => {
    mockRpc({ nonce: 4 });
    const result = await signDelegate({
      receiverId: "counter.testnet",
      actions: [actions.transfer("1")],
      signerId: "alice.testnet",
      signer: edSigner(2),
      maxBlockHeight: 9999,
      network: "testnet",
    });
    expect(result.delegateAction.maxBlockHeight).toBe("9999");
    expect(result.delegateAction.nonce).toBe("5");
  });

  it("produces borsh bytes that decode back to the delegate fields", async () => {
    mockRpc({ nonce: 41, height: 700 });
    const result = await signDelegate({
      receiverId: "bob.testnet",
      actions: [actions.transfer("1000000000000000000000000")],
      signerId: "alice.testnet",
      signer: edSigner(3),
      blockHeightTtl: 600,
      network: "testnet",
    });
    const bytes = Uint8Array.from(atob(result.borshBase64), (c) => c.charCodeAt(0));
    const decoded = deserialize(SCHEMA.SignedDelegate, bytes) as any;
    expect(decoded.delegateAction.senderId).toBe("alice.testnet");
    expect(decoded.delegateAction.receiverId).toBe("bob.testnet");
    expect(decoded.delegateAction.nonce).toBe("42");
    expect(decoded.delegateAction.maxBlockHeight).toBe("1300");
  });

  it("rejects an unpaired signer/signerId", async () => {
    await expect(
      signDelegate({ receiverId: "x.testnet", actions: [], signer: edSigner(1), network: "testnet" }),
    ).rejects.toThrow(/must be paired/);
  });
});

describe("relayDelegate", () => {
  it("wraps the delegate in a send_tx to the sender, paid by the relayer", async () => {
    mockRpc({ nonce: 10, height: 1000 });
    const senderSigner = edSigner(1);
    const signed = await signDelegate({
      receiverId: "counter.testnet",
      actions: [actions.functionCall({ methodName: "increment", gas: "30 Tgas", deposit: "0" })],
      signerId: "alice.testnet",
      signer: senderSigner,
      network: "testnet",
    });

    const relayerSigner = edSigner(9);
    await relayDelegate({
      delegateAction: {
        senderId: "alice.testnet",
        receiverId: "counter.testnet",
        actions: [actions.functionCall({ methodName: "increment", gas: "30 Tgas", deposit: "0" })],
        nonce: signed.delegateAction.nonce,
        maxBlockHeight: signed.delegateAction.maxBlockHeight,
        publicKey: senderSigner.publicKey,
      },
      signature: signed.signatureBytes,
      relayerSigner,
      relayerId: "relayer.testnet",
      network: "testnet",
    });

    const sent = (global.fetch as any).mock.calls
      .map(([, r]: any[]) => rpcMethod(r))
      .some((m: any) => m.method === "send_tx");
    expect(sent).toBe(true);
    expect(relayerSigner.signHash).toHaveBeenCalled();
  });

  it("requires a relayerId when a relayerSigner is given", async () => {
    await expect(
      relayDelegate({
        delegateAction: {
          senderId: "alice.testnet",
          receiverId: "counter.testnet",
          actions: [],
          nonce: "1",
          maxBlockHeight: "1",
          publicKey: keyToString(new Uint8Array(32).fill(1), "ed25519"),
        },
        signature: new Uint8Array(64),
        relayerSigner: edSigner(9),
        network: "testnet",
      }),
    ).rejects.toThrow(/must be paired/);
  });

  it("accepts a wallet-shaped { signedDelegate } directly, no hand-normalization", async () => {
    mockRpc({ nonce: 10, height: 1000 });
    const senderSigner = edSigner(1);
    // signDelegate's borshBase64 is byte-identical to what a wallet's
    // signDelegateActions returns as { borshSerializedBase64 }.
    const signed = await signDelegate({
      receiverId: "counter.testnet",
      actions: [
        actions.functionCall({ methodName: "increment", gas: "30 Tgas", deposit: "0" }),
        actions.transfer("1"),
      ],
      signerId: "alice.testnet",
      signer: senderSigner,
      network: "testnet",
    });

    const relayerSigner = edSigner(9);
    // The whole point of #46: this used to throw "Not implemented action:
    // undefined" if you decoded the borsh yourself and passed it in.
    await expect(
      relayDelegate({
        signedDelegate: { borshSerializedBase64: signed.borshBase64 },
        relayerSigner,
        relayerId: "relayer.testnet",
        network: "testnet",
      }),
    ).resolves.toBeDefined();

    const sent = (global.fetch as any).mock.calls
      .map(([, r]: any[]) => rpcMethod(r))
      .some((m: any) => m.method === "send_tx");
    expect(sent).toBe(true);
  });

  it("errors clearly when given neither the pair nor a signedDelegate", async () => {
    await expect(relayDelegate({ network: "testnet" } as any)).rejects.toThrow(
      /needs \{ delegateAction, signature \} or a wallet-signed \{ signedDelegate \}/,
    );
  });
});
