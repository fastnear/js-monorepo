import { describe, it, expect, beforeEach, vi } from "vitest";
import { lsGet, lsSet } from "@fastnear/utils";
import { reserveNonce, __resetNonceLocks } from "./nonce.js";

describe("reserveNonce", () => {
  beforeEach(() => {
    __resetNonceLocks();
    lsSet("nonce.mainnet.alice.key-a", null);
    lsSet("nonce.testnet.alice.key-a", null);
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
      reserveNonce("mainnet.alice.key-a", fetchChainNonce),
      reserveNonce("mainnet.alice.key-a", fetchChainNonce),
      reserveNonce("mainnet.alice.key-a", fetchChainNonce),
    ]);

    // The unserialized bug would produce [101, 101, 101] (all read 100). The
    // lock serializes the read-modify-write, so each caller gets a distinct one.
    expect(results).toEqual([101n, 102n, 103n]);
    // Every reservation checks the chain, then takes the larger cached value.
    expect(fetchCount).toBe(3);
    // The cache is left at the last reserved value for the next call.
    expect(lsGet("nonce.mainnet.alice.key-a")).toBe("103");
  });

  it("keeps per-network reservations independent", async () => {
    const [main, testnet] = await Promise.all([
      reserveNonce("mainnet.alice.key-a", async () => 10),
      reserveNonce("testnet.alice.key-a", async () => 20),
    ]);

    expect(main).toBe(11n);
    expect(testnet).toBe(21n);
    expect(lsGet("nonce.mainnet.alice.key-a")).toBe("11");
    expect(lsGet("nonce.testnet.alice.key-a")).toBe("21");
  });

  it("uses a newer chain nonce instead of a stale warm cache", async () => {
    lsSet("nonce.mainnet.alice.key-a", "50");
    const fetchChainNonce = vi.fn(async () => 999n);

    const nonce = await reserveNonce("mainnet.alice.key-a", fetchChainNonce);

    expect(nonce).toBe(1000n);
    expect(fetchChainNonce).toHaveBeenCalledOnce();
  });

  it("increments monotonically across sequential reservations", async () => {
    const fetchChainNonce = vi.fn(async () => 7);

    const a = await reserveNonce("mainnet.alice.key-a", fetchChainNonce);
    const b = await reserveNonce("mainnet.alice.key-a", fetchChainNonce);
    const c = await reserveNonce("mainnet.alice.key-a", fetchChainNonce);

    expect([a, b, c]).toEqual([8n, 9n, 10n]);
    expect(fetchChainNonce).toHaveBeenCalledTimes(3);
  });

  it("a failed cold-fetch rejects its own caller without wedging the queue", async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error("rpc down");
      return 200;
    };

    // The first caller's cold-fetch fails and surfaces to that caller...
    await expect(reserveNonce("mainnet.alice.key-a", flaky)).rejects.toThrow("rpc down");
    // ...but the lock chain is not stuck: the next caller still proceeds. The
    // cache is still cold (nothing was written), so it fetches again and lands.
    const nonce = await reserveNonce("mainnet.alice.key-a", flaky);
    expect(nonce).toBe(201n);
    expect(lsGet("nonce.mainnet.alice.key-a")).toBe("201");
  });

  it("keeps two keys on the same network independent", async () => {
    const [a, b] = await Promise.all([
      reserveNonce("testnet.alice.key-a", async () => "5"),
      reserveNonce("testnet.alice.key-b", async () => "90"),
    ]);

    expect(a).toBe(6n);
    expect(b).toBe(91n);
  });
});
