import { deserialize, serialize } from "@fastnear/borsh";
import {
  base64ToBytes,
  bytesToBase64,
  SCHEMA,
  sha256,
} from "@fastnear/utils";
import { ed25519 } from "@noble/curves/ed25519.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateSignedDelegate } from "./delegate-validation.js";
import { createMeteorAdapter } from "./meteor.js";
import type {
  AdapterStorage,
  MeteorExtensionBridge,
} from "./types.js";

const createStorage = (accountId = "payer.testnet"): AdapterStorage => {
  const values = new Map<string, string>([
    [
      "near_app_meteor_wallet_auth_key:testnet",
      JSON.stringify({ accountId, allKeys: [] }),
    ],
  ]);
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => void values.set(key, value),
    remove: (key) => void values.delete(key),
  };
};

const mockFinalBlock = (height: number) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { header: { height } } }),
    })),
  );
};

const TEST_SECRET_KEY = new Uint8Array(32).fill(7);

function signDelegateAction(
  encodedDelegate: string,
  mutate?: (delegateAction: any) => void,
): string {
  const delegateAction = deserialize(
    SCHEMA.DelegateAction,
    base64ToBytes(encodedDelegate),
  ) as any;
  delegateAction.publicKey = {
    ed25519Key: { data: Array.from(ed25519.getPublicKey(TEST_SECRET_KEY)) },
  };
  delegateAction.nonce = 1n;
  mutate?.(delegateAction);
  const digest = sha256(
    new Uint8Array(serialize(SCHEMA.DelegateAction, delegateAction)),
  );
  const signedDelegate = {
    delegateAction,
    signature: {
      ed25519Signature: {
        data: Array.from(ed25519.sign(digest, TEST_SECRET_KEY)),
      },
    },
  };
  return bytesToBase64(
    new Uint8Array(serialize(SCHEMA.SignedDelegate, signedDelegate)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Meteor delegate signing", () => {
  it("sends a real sign_delegate_actions request with the requested TTL", async () => {
    mockFinalBlock(1_000);
    let listener: ((data: any) => void) | undefined;
    let request: any;
    let signedDelegateAction = "";
    const bridge: MeteorExtensionBridge = {
      addMessageDataListener: (next) => {
        listener = next;
      },
      sendMessageData: (message) => {
        if (message.inputs == null) return;
        request = message;
        signedDelegateAction = signDelegateAction(
          message.inputs.delegateActions.split(",")[0],
        );
        queueMicrotask(() =>
          listener?.({
            uid: message.uid,
            status: "closed_success",
            payload: {
              signedDelegatesWithHashes: [
                {
                  delegateHash: "aGFzaA==",
                  signedDelegateAction,
                },
              ],
            },
          }),
        );
      },
    };

    const meteor = createMeteorAdapter({
      storage: createStorage(),
      getExtensionBridge: () => bridge,
      getNetworkProviders: () => ["https://rpc.testnet.example"],
    });

    const result = await meteor.signDelegateActions({
      network: "testnet",
      delegateActions: [
        {
          receiverId: "usdc.fakes.testnet",
          blockHeightTtl: 300,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: "ft_transfer",
                args: { receiver_id: "seller.testnet", amount: "10" },
                gas: "30000000000000",
                deposit: "1",
              },
            },
          ],
        },
      ],
    });
    expect(result).toEqual({
      signedDelegateActions: [
        { borshSerializedBase64: signedDelegateAction },
      ],
    });

    expect(request.actionType).toBe("sign_delegate_actions");
    const encoded = request.inputs.delegateActions.split(",")[0];
    const delegate = deserialize(
      SCHEMA.DelegateAction,
      base64ToBytes(encoded),
    ) as any;
    expect(delegate.senderId).toBe("payer.testnet");
    expect(delegate.receiverId).toBe("usdc.fakes.testnet");
    expect(delegate.nonce).toBe(0n);
    expect(delegate.maxBlockHeight).toBe(1_300n);
    expect(delegate.actions[0].functionCall.methodName).toBe("ft_transfer");
  });

  it("preserves the requested TTL through the popup transport", async () => {
    mockFinalBlock(2_000);
    let listener: ((event: { data: any }) => void) | undefined;
    let request: any;
    let signedDelegateAction = "";
    const postMessage = vi.fn((message: any, targetOrigin?: string) => {
      if (message.inputs == null) return;
      request = message;
      signedDelegateAction = signDelegateAction(
        message.inputs.delegateActions.split(",")[0],
      );
      queueMicrotask(() => listener?.({
        data: {
          uid: message.uid,
          status: "closed_success",
          payload: {
            signedDelegatesWithHashes: [
              {
                delegateHash: "aGFzaA==",
                signedDelegateAction,
              },
            ],
          },
        },
      }));
      expect(targetOrigin).toBe("https://wallet.meteorwallet.app");
    });
    const popup = {
      closed: false,
      close: vi.fn(),
      postMessage,
    };
    const openWindow = vi.fn(() => popup);
    const removeEventListener = vi.fn();
    vi.stubGlobal("window", {
      top: {
        outerHeight: 800,
        outerWidth: 1_200,
        screenX: 0,
        screenY: 0,
      },
      addEventListener: (event: string, next: (event: { data: any }) => void) => {
        if (event === "message") listener = next;
      },
      removeEventListener,
    });

    const meteor = createMeteorAdapter({
      storage: createStorage(),
      openWindow,
      getNetworkProviders: () => ["https://rpc.testnet.example"],
    });
    const result = await meteor.signDelegateActions({
      network: "testnet",
      delegateActions: [{
        receiverId: "usdc.fakes.testnet",
        blockHeightTtl: 300,
        actions: [],
      }],
    });

    expect(result).toEqual({
      signedDelegateActions: [
        { borshSerializedBase64: signedDelegateAction },
      ],
    });
    expect(openWindow).toHaveBeenCalledOnce();
    expect(openWindow.mock.calls[0][0]).toContain(
      "/connect/testnet/sign_delegate_actions",
    );
    expect(request.actionType).toBe("sign_delegate_actions");
    const encoded = request.inputs.delegateActions.split(",")[0];
    const delegate = deserialize(
      SCHEMA.DelegateAction,
      base64ToBytes(encoded),
    ) as any;
    expect(delegate.maxBlockHeight).toBe(2_300n);
    expect(postMessage).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledOnce();
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it("rejects invalid timeout values before asking Meteor to sign", async () => {
    mockFinalBlock(1_000);
    const sendMessageData = vi.fn();
    const meteor = createMeteorAdapter({
      storage: createStorage(),
      getExtensionBridge: () => ({
        addMessageDataListener: vi.fn(),
        sendMessageData,
      }),
      getNetworkProviders: () => ["https://rpc.testnet.example"],
    });

    await expect(
      meteor.signDelegateActions({
        network: "testnet",
        delegateActions: [
          {
            receiverId: "usdc.fakes.testnet",
            actions: [],
            blockHeightTtl: 0,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_DELEGATE_TTL" });
    expect(sendMessageData).not.toHaveBeenCalled();
  });

  it("rejects a non-Borsh response from the wallet transport", async () => {
    mockFinalBlock(1_000);
    let listener: ((data: any) => void) | undefined;
    const bridge: MeteorExtensionBridge = {
      addMessageDataListener: (next) => {
        listener = next;
      },
      sendMessageData: (message) => {
        if (message.inputs == null) return;
        queueMicrotask(() =>
          listener?.({
            uid: message.uid,
            status: "closed_success",
            payload: {
              signedDelegatesWithHashes: [{
                signedDelegateAction: "c2lnbmVkLWRlbGVnYXRl",
              }],
            },
          }),
        );
      },
    };
    const meteor = createMeteorAdapter({
      storage: createStorage(),
      getExtensionBridge: () => bridge,
      getNetworkProviders: () => ["https://rpc.testnet.example"],
    });

    await expect(meteor.signDelegateActions({
      network: "testnet",
      delegateActions: [{
        receiverId: "usdc.fakes.testnet",
        blockHeightTtl: 300,
        actions: [],
      }],
    })).rejects.toMatchObject({ code: "INVALID_DELEGATE_RESPONSE" });
  });

  it("binds a valid signature to the requested maximum block height", () => {
    const actions = [{
      functionCall: {
        methodName: "ft_transfer",
        args: Array.from(new TextEncoder().encode(
          '{"receiver_id":"seller.testnet","amount":"10"}',
        )),
        gas: 30_000_000_000_000n,
        deposit: 1n,
      },
    }];
    const encoded = bytesToBase64(new Uint8Array(serialize(SCHEMA.DelegateAction, {
      senderId: "payer.testnet",
      receiverId: "usdc.fakes.testnet",
      actions,
      nonce: 0n,
      maxBlockHeight: 1_300n,
      publicKey: { ed25519Key: { data: new Array(32).fill(0) } },
    })));
    const signed = signDelegateAction(encoded, (delegateAction) => {
      delegateAction.maxBlockHeight = 1_301n;
    });

    expect(() => validateSignedDelegate(signed, {
      senderId: "payer.testnet",
      receiverId: "usdc.fakes.testnet",
      actions,
      maxBlockHeight: 1_300n,
    })).toThrow("does not match the requested delegate action");
  });
});
