import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import {
  decodeSignedDelegateB64,
} from "@x402/near";
import {
  decodeSignedTransaction,
  encodeSignedDelegate,
} from "@near-js/transactions";
import { describe, expect, it, vi } from "vitest";
import { createNearFacilitator } from "./facilitator.js";
import { createNearPaymentFetch } from "./index.js";
import { createLocalNearSigner } from "./node.js";
import { createNearResourceServer } from "./server.js";

const ACCOUNT_ID =
  "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8";
const SECRET_KEY =
  "ed25519:1GMkH3brNXiNNs1tiFZHu4yZSRrzJwxi5wB9bHFtMikjwpAW9DMZzU2Pqakc5it8X3N5vPmqdN7KF4CCUpmKhq";
const RELAYER_SECRET_KEY =
  "ed25519:AADF5hC4G2hkMNESSHciZowNS79kocbrrSQAkSU7fuUnbvpRJFV9zP6G9GV2vLWFJTmuEyoYSXQiuVczdB5fqU4";
const PUBLIC_KEY = "ed25519:FAe4sisG95oZ42w7buUn5qEE4TAnfTTFPiguZUHmhiF";
const ZERO_HASH = "11111111111111111111111111111111";
const TOKEN_CODE_HASH = "DqWvPnmrMHuQaBnMmLbQ7a7d3i4vdenYMWGyUUFcet8Q";
const TOKEN_ID = "usdc.fakes.testnet";
const MERCHANT_ID = "merchant.testnet";
const FINAL_HEIGHT = 1_000;
const ACCESS_KEY_NONCE = 41;

async function startMockNearRpc() {
  const requests: any[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    requests.push(rpc);

    let result: unknown;
    if (rpc.method === "query" && rpc.params?.request_type === "view_access_key") {
      result = {
        block_hash: ZERO_HASH,
        block_height: FINAL_HEIGHT,
        nonce: rpc.params.account_id === "relayer.testnet" ? 7 : ACCESS_KEY_NONCE,
        permission: "FullAccess",
      };
    } else if (rpc.method === "query" && rpc.params?.request_type === "view_account") {
      result = {
        amount: "1000000000000000000000000",
        locked: "0",
        code_hash: rpc.params.account_id === TOKEN_ID ? TOKEN_CODE_HASH : ZERO_HASH,
        storage_usage: 0,
        storage_paid_at: 0,
        block_height: FINAL_HEIGHT,
        block_hash: ZERO_HASH,
      };
    } else if (rpc.method === "query" && rpc.params?.request_type === "call_function") {
      const value = rpc.params.method_name === "ft_balance_of"
        ? "1000000"
        : { total: "1", available: "0" };
      result = {
        result: Array.from(Buffer.from(JSON.stringify(value))),
        logs: [],
        block_height: FINAL_HEIGHT,
        block_hash: ZERO_HASH,
      };
    } else if (rpc.method === "block") {
      result = { header: { height: FINAL_HEIGHT, hash: ZERO_HASH } };
    } else if (rpc.method === "send_tx") {
      result = {
        status: { SuccessValue: "" },
        transaction_outcome: { id: "settled-transaction-hash" },
        receipts_outcome: [{
          outcome: {
            executor_id: TOKEN_ID,
            status: { SuccessValue: "" },
          },
        }],
      };
    } else {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: rpc.id,
        error: { code: -32601, message: `Unexpected RPC method: ${rpc.method}` },
      }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

describe("wallet-free x402 integration", () => {
  it("signs, verifies, settles, and retries through the public factories", async () => {
    const rpc = await startMockNearRpc();
    try {
      const facilitator = createNearFacilitator({
        registrations: [{
          network: "near:testnet",
          signer: {
            relayers: [{
              accountId: "relayer.testnet",
              secretKey: RELAYER_SECRET_KEY,
            }],
            rpcUrls: { "near:testnet": rpc.url },
          },
        }],
      });
      const resourceServer = createNearResourceServer({
        facilitators: facilitator,
      });
      await resourceServer.initialize();

      const [requirements] = await resourceServer.buildPaymentRequirementsFromOptions([{
        scheme: "exact",
        network: "near:testnet",
        payTo: MERCHANT_ID,
        price: { asset: TOKEN_ID, amount: "10" },
        maxTimeoutSeconds: 300,
      }], {});
      const paymentRequired = await resourceServer.createPaymentRequiredResponse(
        [requirements],
        {
          url: "https://seller.example.test/paid",
          description: "Wallet-free integration fixture",
          mimeType: "application/json",
        },
      );

      let capturedPayment: ReturnType<typeof decodePaymentSignatureHeader> | undefined;
      const sellerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (sellerFetch.mock.calls.length === 1) {
          return new Response(null, {
            status: 402,
            headers: {
              "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired),
            },
          });
        }

        const request = input instanceof Request ? input : new Request(input, init);
        const paymentHeader = request.headers.get("PAYMENT-SIGNATURE");
        expect(paymentHeader).toBeTruthy();
        capturedPayment = decodePaymentSignatureHeader(paymentHeader!);
        const matched = resourceServer.findMatchingRequirements(
          paymentRequired.accepts,
          capturedPayment,
        );
        expect(matched).toEqual(requirements);

        const verification = await resourceServer.verifyPayment(capturedPayment, matched!);
        expect(verification).toMatchObject({ isValid: true, payer: ACCOUNT_ID });
        const settlement = await resourceServer.settlePayment(capturedPayment, matched!);
        expect(settlement).toMatchObject({
          success: true,
          transaction: "settled-transaction-hash",
          network: "near:testnet",
          payer: ACCOUNT_ID,
        });
        return new Response(JSON.stringify({ paid: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": encodePaymentResponseHeader(settlement),
          },
        });
      });

      const signer = createLocalNearSigner({
        accountId: ACCOUNT_ID,
        secretKey: SECRET_KEY,
        rpcUrls: { "near:testnet": rpc.url },
      });
      const paidFetch = createNearPaymentFetch({
        signer,
        fetch: sellerFetch,
        network: "near:testnet",
      });
      const response = await paidFetch("https://seller.example.test/paid");

      await expect(response.json()).resolves.toEqual({ paid: true });
      expect(sellerFetch).toHaveBeenCalledTimes(2);
      expect(rpc.requests).toEqual(expect.arrayContaining([
        expect.objectContaining({
          method: "query",
          params: expect.objectContaining({
            request_type: "view_access_key",
            account_id: ACCOUNT_ID,
            public_key: PUBLIC_KEY,
            finality: "final",
          }),
        }),
        expect.objectContaining({
          method: "block",
          params: { finality: "final" },
        }),
      ]));

      const submission = rpc.requests.find(request => request.method === "send_tx");
      expect(submission).toMatchObject({
        method: "send_tx",
        params: {
          wait_until: "FINAL",
          signed_tx_base64: expect.any(String),
        },
      });
      const outerTransaction = decodeSignedTransaction(
        Buffer.from(submission.params.signed_tx_base64, "base64"),
      );
      expect(outerTransaction.transaction).toMatchObject({
        signerId: "relayer.testnet",
        receiverId: ACCOUNT_ID,
        nonce: 8n,
      });
      expect(outerTransaction.transaction.actions).toHaveLength(1);
      const submittedDelegate = outerTransaction.transaction.actions[0].signedDelegate;
      expect(submittedDelegate).toBeDefined();
      expect(Buffer.from(encodeSignedDelegate(submittedDelegate!)).toString("base64")).toBe(
        capturedPayment!.payload.signedDelegateAction,
      );

      const decoded = decodeSignedDelegateB64(
        capturedPayment!.payload.signedDelegateAction as string,
      );
      expect(decoded.verifySignature()).toBe(true);
      expect(decoded.delegate).toMatchObject({
        senderId: ACCOUNT_ID,
        receiverId: TOKEN_ID,
        nonce: 42n,
        maxBlockHeight: 1_300n,
        actionCount: 1,
      });
      expect(decoded.delegate.functionCall).toMatchObject({
        methodName: "ft_transfer",
        gas: 30_000_000_000_000n,
        deposit: 1n,
      });

      const restrictiveFacilitator = createNearFacilitator({
        registrations: [{
          network: "near:testnet",
          signer: {
            relayers: [{
              accountId: "relayer.testnet",
              secretKey: RELAYER_SECRET_KEY,
            }],
            rpcUrls: { "near:testnet": rpc.url },
          },
          maxSponsoredGas: 29_999_999_999_999n,
        }],
      });
      await expect(
        restrictiveFacilitator.verify(capturedPayment!, requirements),
      ).resolves.toMatchObject({
        isValid: false,
        invalidReason: "invalid_exact_near_payload_gas_limit_exceeded",
        payer: ACCOUNT_ID,
      });
    } finally {
      await rpc.close();
    }
  });
});
