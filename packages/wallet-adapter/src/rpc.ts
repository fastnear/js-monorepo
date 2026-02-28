import { TransportError } from "./errors.js";
import type { WalletNetwork } from "./types.js";

interface JsonRpcResponse<T> {
  result?: T;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
    name?: string;
  };
}

const defaultProviders: Record<WalletNetwork, string[]> = {
  mainnet: ["https://relmn.aurora.dev", "https://nearrpc.aurora.dev", "https://rpc.mainnet.near.org"],
  testnet: ["https://rpc.testnet.near.org"],
};

const wait = (timeout: number) => new Promise<void>((resolve) => setTimeout(resolve, timeout));

let rpcId = 1000;

export class NearRpcClient {
  private readonly providers: string[];
  private index = 0;
  private timeoutMs: number;
  private readonly startTimeoutMs: number;

  constructor(providers: string[], timeoutMs = 30_000) {
    this.providers = providers.length > 0 ? providers : defaultProviders.mainnet;
    this.timeoutMs = timeoutMs;
    this.startTimeoutMs = timeoutMs;
  }

  async block(params: { finality: "final" | "optimistic" }): Promise<any> {
    return this.sendJsonRpc("block", params);
  }

  async query<T = any>(params: Record<string, any>): Promise<T> {
    return this.sendJsonRpc<T>("query", params);
  }

  async txStatus(txHash: string, accountId: string, waitUntil?: string): Promise<any> {
    return this.sendJsonRpc("tx", {
      tx_hash: txHash,
      sender_account_id: accountId,
      wait_until: waitUntil,
    });
  }

  private async sendJsonRpc<T>(method: string, params: any, attempt = 0): Promise<T> {
    const provider = this.providers[this.index];
    try {
      const result = await this.send<T>(provider, method, params, this.timeoutMs);
      this.timeoutMs = Math.max(this.startTimeoutMs, Math.floor(this.timeoutMs / 1.2));
      return result;
    } catch (error) {
      const providersExhausted = attempt + 1 >= this.providers.length * 3;
      this.index = (this.index + 1) % this.providers.length;
      this.timeoutMs = Math.min(60_000, Math.floor(this.timeoutMs * 1.2));

      if (providersExhausted) {
        throw error;
      }

      await wait(Math.min(500 * (attempt + 1), 3_000));
      return this.sendJsonRpc<T>(method, params, attempt + 1);
    }
  }

  private async send<T>(provider: string, method: string, params: any, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(provider, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: rpcId++,
          method,
          params,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "Unknown RPC error");
        throw new TransportError("RPC_HTTP_ERROR", `RPC request failed (${response.status}): ${text}`);
      }

      const json = (await response.json()) as JsonRpcResponse<T>;

      if (json.error) {
        const message = typeof json.error.data === "string" ? json.error.data : json.error.message ?? "RPC error";
        throw new TransportError("RPC_RESPONSE_ERROR", message, { details: json.error });
      }

      return json.result as T;
    } catch (error: any) {
      if (controller.signal.aborted) {
        throw new TransportError("RPC_TIMEOUT", "RPC request timed out", { cause: error });
      }

      if (error instanceof TransportError) throw error;
      throw new TransportError("RPC_NETWORK_ERROR", "RPC network request failed", { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}

export const createRpcFactory = (
  getNetworkProviders?: (network: WalletNetwork) => string[],
): ((network: WalletNetwork) => NearRpcClient) => {
  const clients: Partial<Record<WalletNetwork, NearRpcClient>> = {};

  return (network: WalletNetwork) => {
    if (clients[network] != null) return clients[network] as NearRpcClient;
    const providers = getNetworkProviders?.(network);
    clients[network] = new NearRpcClient(providers && providers.length > 0 ? providers : defaultProviders[network]);
    return clients[network] as NearRpcClient;
  };
};
