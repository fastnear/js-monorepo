import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { encodeSignedDelegate } from "@near-js/transactions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFastNearWalletSigner,
  createNearPaymentFetch,
  createNearX402Client,
  type FastNearWalletModule,
} from "./index.js";

type WalletModuleCompatibility = typeof import("@fastnear/wallet") extends FastNearWalletModule
  ? true
  : never;
const walletModuleCompatibility: WalletModuleCompatibility = true;

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "near:testnet",
  asset: "usdc.fakes.testnet",
  amount: "12345",
  payTo: "merchant.testnet",
  maxTimeoutSeconds: 300,
  extra: {},
};

const signedDelegate = {
  delegateAction: {
    senderId: "payer.testnet",
    receiverId: "usdc.fakes.testnet",
    actions: [{
      functionCall: {
        methodName: "ft_transfer",
        args: Array.from(new TextEncoder().encode('{"receiver_id":"merchant.testnet","amount":"12345"}')),
        gas: 30_000_000_000_000n,
        deposit: 1n,
      },
    }],
    nonce: 1n,
    maxBlockHeight: 301n,
    publicKey: {
      ed25519Key: {
        data: Array.from(Buffer.from("6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=", "base64")),
      },
    },
  },
  signature: {
    ed25519Signature: {
      data: Array.from(Buffer.from(
        "nt2IJzTY/xGqyVWtFaDvKd85kM+eiGSiL9JfV4D2g+nHpxFwE/3DhaMcjd7CjtX2vgKfPE0yjhUaW2ZY+Ou1AA==",
        "base64",
      )),
    },
  },
};

const encodedSignedDelegate = Buffer.from(
  encodeSignedDelegate(signedDelegate as never),
).toString("base64");

function walletReturning(result: unknown, account = "payer.testnet") {
  return {
    accountId: vi.fn(() => account),
    signDelegateActions: vi.fn(async (_params: unknown) => ({ signedDelegateActions: [result] })),
  };
}

describe("createFastNearWalletSigner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the exact NEP-141 transfer and forwards the timeout", async () => {
    const wallet = walletReturning({ borshSerializedBase64: encodedSignedDelegate });
    const signer = createFastNearWalletSigner({ wallet: wallet as never });

    await expect(signer.createSignedDelegateAction({
      x402Version: 2,
      paymentRequirements: requirements,
    })).resolves.toBe(encodedSignedDelegate);

    expect(wallet.accountId).toHaveBeenCalledWith({ network: "testnet" });
    expect(wallet.signDelegateActions).toHaveBeenCalledWith({
      network: "testnet",
      signerId: "payer.testnet",
      delegateActions: [{
        receiverId: "usdc.fakes.testnet",
        blockHeightTtl: 300,
        actions: [{
          type: "FunctionCall",
          params: {
            methodName: "ft_transfer",
            args: { receiver_id: "merchant.testnet", amount: "12345" },
            gas: "30000000000000",
            deposit: "1",
          },
        }],
      }],
    });
  });

  it("maps mainnet and rounds fractional timeout seconds up", async () => {
    const wallet = walletReturning(encodedSignedDelegate);
    const signer = createFastNearWalletSigner({ wallet: wallet as never });
    await signer.createSignedDelegateAction({
      x402Version: 2,
      paymentRequirements: {
        ...requirements,
        network: "near:mainnet",
        maxTimeoutSeconds: 1.01,
      },
    });
    expect(wallet.accountId).toHaveBeenCalledWith({ network: "mainnet" });
    expect(wallet.signDelegateActions).toHaveBeenCalledWith(expect.objectContaining({
      delegateActions: [expect.objectContaining({ blockHeightTtl: 2 })],
    }));
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid timeout %s",
    async maxTimeoutSeconds => {
      const signer = createFastNearWalletSigner({
        wallet: walletReturning(encodedSignedDelegate) as never,
      });
      await expect(signer.createSignedDelegateAction({
        x402Version: 2,
        paymentRequirements: { ...requirements, maxTimeoutSeconds },
      })).rejects.toThrow("positive finite number");
    },
  );

  it("rejects a timeout that cannot be forwarded as a safe wallet TTL", async () => {
    const signer = createFastNearWalletSigner({
      wallet: walletReturning(encodedSignedDelegate) as never,
    });
    await expect(signer.createSignedDelegateAction({
      x402Version: 2,
      paymentRequirements: {
        ...requirements,
        maxTimeoutSeconds: Number.MAX_SAFE_INTEGER + 1,
      },
    })).rejects.toThrow("delegate-action limit");
  });

  it("normalizes legacy SignedDelegate objects", async () => {
    const wallet = walletReturning({ signedDelegate });
    const signer = createFastNearWalletSigner({ wallet: wallet as never });
    await expect(signer.createSignedDelegateAction({
      x402Version: 2,
      paymentRequirements: requirements,
    })).resolves.toBe(encodedSignedDelegate);
  });

  it.each([
    ["unsupported version", 1, requirements, "Unsupported x402 version"],
    ["unsupported scheme", 2, { ...requirements, scheme: "upto" }, "Unsupported x402 NEAR scheme"],
    ["unsupported network", 2, { ...requirements, network: "eip155:1" }, "Unsupported x402 NEAR network"],
  ])("rejects %s", async (_label, version, paymentRequirements, message) => {
    const signer = createFastNearWalletSigner({ wallet: walletReturning(encodedSignedDelegate) as never });
    await expect(signer.createSignedDelegateAction({
      x402Version: version as number,
      paymentRequirements: paymentRequirements as PaymentRequirements,
    })).rejects.toThrow(message);
  });

  it("rejects disconnected and non-compliant wallets", async () => {
    const disconnected = walletReturning(encodedSignedDelegate, "");
    const disconnectedSigner = createFastNearWalletSigner({ wallet: disconnected as never });
    await expect(disconnectedSigner.createSignedDelegateAction({
      x402Version: 2,
      paymentRequirements: requirements,
    })).rejects.toThrow("No FastNEAR wallet is connected");

    const unsupported = walletReturning(encodedSignedDelegate);
    unsupported.signDelegateActions.mockRejectedValueOnce(new Error("does not support timeout-aware delegate signing"));
    const unsupportedSigner = createFastNearWalletSigner({ wallet: unsupported as never });
    await expect(unsupportedSigner.createSignedDelegateAction({
      x402Version: 2,
      paymentRequirements: requirements,
    })).rejects.toThrow("timeout-aware delegate signing");
  });

  it.each([
    ["zero results", []],
    ["multiple results", [encodedSignedDelegate, encodedSignedDelegate]],
    ["malformed base64", ["not base64!"]],
    ["noncanonical base64", ["YQ"]],
    ["empty base64", [""]],
    ["invalid canonical result", [{ borshSerializedBase64: 123 }]],
    ["invalid legacy result", [{ signedDelegate: null }]],
    ["unsupported result", [{}]],
  ])("rejects %s", async (_label, response) => {
    const wallet = {
      accountId: () => "payer.testnet",
      signDelegateActions: async () => ({ signedDelegateActions: response }),
    };
    const signer = createFastNearWalletSigner({ wallet: wallet as never });
    await expect(signer.createSignedDelegateAction({
      x402Version: 2,
      paymentRequirements: requirements,
    })).rejects.toThrow();
  });
});

describe("x402 client and fetch helpers", () => {
  it("creates a client registered for NEAR exact", async () => {
    const createSignedDelegateAction = vi.fn(async () => encodedSignedDelegate);
    const client = createNearX402Client({ signer: { createSignedDelegateAction } });
    const payment = await client.createPaymentPayload({
      x402Version: 2,
      resource: { url: "https://example.test/paid" },
      accepts: [requirements],
    });
    expect(payment.payload).toEqual({ signedDelegateAction: encodedSignedDelegate });
    expect(createSignedDelegateAction).toHaveBeenCalledWith({
      x402Version: 2,
      paymentRequirements: requirements,
    });
  });

  it("retries a 402 response with a payment signature", async () => {
    const paymentRequired = encodePaymentRequiredHeader({
      x402Version: 2,
      resource: { url: "https://example.test/paid" },
      accepts: [requirements],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 402,
        headers: { "PAYMENT-REQUIRED": paymentRequired },
      }))
      .mockResolvedValueOnce(new Response("paid", { status: 200 }));
    const signer = { createSignedDelegateAction: vi.fn(async () => encodedSignedDelegate) };
    const paidFetch = createNearPaymentFetch({ signer, fetch: fetchMock });

    const response = await paidFetch("https://example.test/paid");
    expect(await response.text()).toBe("paid");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retriedRequest = fetchMock.mock.calls[1][0] as Request;
    expect(retriedRequest.headers.get("PAYMENT-SIGNATURE")).toBeTruthy();
  });

  it("does not retry the HTTP request after a malformed wallet response", async () => {
    const paymentRequired = encodePaymentRequiredHeader({
      x402Version: 2,
      resource: { url: "https://example.test/paid" },
      accepts: [requirements],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 402,
      headers: { "PAYMENT-REQUIRED": paymentRequired },
    }));
    const signer = createFastNearWalletSigner({
      wallet: walletReturning("not base64!") as never,
    });
    const paidFetch = createNearPaymentFetch({ signer, fetch: fetchMock });

    await expect(paidFetch("https://example.test/paid")).rejects.toThrow("malformed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
