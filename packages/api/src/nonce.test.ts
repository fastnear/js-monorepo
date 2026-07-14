import { describe, it, expect, beforeEach, vi } from "vitest";
import { lsGet, lsSet } from "@fastnear/utils";
import { reserveNonce, __resetNonceLocks } from "./nonce.js";

describe("reserveNonce", () => {
  beforeEach(() => {
    __resetNonceLocks();
    lsSet("nonce.mainnet", null);
    lsSet("nonce.testnet", null);
  });

  it("hands out distinct, sequential nonces to a concurrent cold-cache burst", async () => {
    // Reproduce the first-transactions-after-connect race: the cache is cold,
    // the chain nonce is 100, and the access-key fetch yields (as a real network
    // round-trip would) so all three calls would overlap if unserialized.
    let fetchCount = 0;
    const fetchChainNonce = async () => {
      fetchCount += 1;
      await Promise.resolve(); // yield the microtask queue: opens the race window
      return 100;
    };

    const results = await Promise.all([
      reserveNonce("mainnet", fetchChainNonce),
      reserveNonce("mainnet", fetchChainNonce),
      reserveNonce("mainnet", fetchChainNonce),
    ]);

    // The unserialized bug would produce [101, 101, 101] (all read 100). The
    // lock serializes the read-modify-write, so each caller gets a distinct one.
    expect(results).toEqual([101, 102, 103]);
    // The cold fetch happened exactly once; the later waiters reused the cache.
    expect(fetchCount).toBe(1);
    // The cache is left at the last reserved value for the next call.
    expect(lsGet("nonce.mainnet")).toBe(103);
  });

  it("keeps per-network reservations independent", async () => {
    const [main, testnet] = await Promise.all([
      reserveNonce("mainnet", async () => 10),
      reserveNonce("testnet", async () => 20),
    ]);

    expect(main).toBe(11);
    expect(testnet).toBe(21);
    expect(lsGet("nonce.mainnet")).toBe(11);
    expect(lsGet("nonce.testnet")).toBe(21);
  });

  it("reuses a warm cache without fetching", async () => {
    lsSet("nonce.mainnet", 50);
    const fetchChainNonce = vi.fn(async () => 999);

    const nonce = await reserveNonce("mainnet", fetchChainNonce);

    expect(nonce).toBe(51);
    expect(fetchChainNonce).not.toHaveBeenCalled();
  });

  it("increments monotonically across sequential reservations", async () => {
    const fetchChainNonce = vi.fn(async () => 7);

    const a = await reserveNonce("mainnet", fetchChainNonce);
    const b = await reserveNonce("mainnet", fetchChainNonce);
    const c = await reserveNonce("mainnet", fetchChainNonce);

    expect([a, b, c]).toEqual([8, 9, 10]);
    expect(fetchChainNonce).toHaveBeenCalledTimes(1); // only the first was cold
  });

  it("a failed cold-fetch rejects its own caller without wedging the queue", async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error("rpc down");
      return 200;
    };

    // The first caller's cold-fetch fails and surfaces to that caller...
    await expect(reserveNonce("mainnet", flaky)).rejects.toThrow("rpc down");
    // ...but the lock chain is not stuck: the next caller still proceeds. The
    // cache is still cold (nothing was written), so it fetches again and lands.
    const nonce = await reserveNonce("mainnet", flaky);
    expect(nonce).toBe(201);
    expect(lsGet("nonce.mainnet")).toBe(201);
  });
});
