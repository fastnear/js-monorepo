import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "@fastnear/utils";
import { event } from "./near.js";
import { _unbroadcastedEvents } from "./state.js";

// near.event.onAccount / onTx registered a listener for the life of the page —
// no off, no unsubscribe. These tests pin the two ways to detach it: the
// function onAccount/onTx now return, and the offAccount/offTx counterparts.

beforeEach(() => {
  memoryStore.clear();
  // Clear both the listeners and the replay buffer left by a prior test.
  // notify() with no listeners buffers the event for the next subscriber, so a
  // leftover buffer would flush into the next test's fresh onAccount call.
  (event as any)._eventListeners.account.clear();
  (event as any)._eventListeners.tx.clear();
  _unbroadcastedEvents.account = [];
  _unbroadcastedEvents.tx = [];
});

describe("near.event unsubscribe", () => {
  it("onAccount returns a working unsubscribe function", () => {
    const cb = vi.fn();
    const off = event.onAccount(cb);

    event.notifyAccountListeners("alice.near");
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    event.notifyAccountListeners("bob.near");
    expect(cb).toHaveBeenCalledTimes(1); // no second delivery
  });

  it("onTx returns a working unsubscribe function", () => {
    const cb = vi.fn();
    const off = event.onTx(cb);

    event.notifyTxListeners({ id: "t1" } as any);
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    event.notifyTxListeners({ id: "t2" } as any);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("offAccount detaches by callback identity and reports whether it removed one", () => {
    const cb = vi.fn();
    event.onAccount(cb);

    expect(event.offAccount(cb)).toBe(true);
    event.notifyAccountListeners("alice.near");
    expect(cb).not.toHaveBeenCalled();

    // Idempotent: removing an already-removed / never-registered callback.
    expect(event.offAccount(cb)).toBe(false);
    expect(event.offAccount(vi.fn())).toBe(false);
  });

  it("offTx detaches by callback identity", () => {
    const cb = vi.fn();
    event.onTx(cb);

    expect(event.offTx(cb)).toBe(true);
    event.notifyTxListeners({ id: "t1" } as any);
    expect(cb).not.toHaveBeenCalled();
    expect(event.offTx(cb)).toBe(false);
  });

  it("detaching one listener leaves the others attached", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = event.onAccount(a);
    event.onAccount(b);

    offA();
    event.notifyAccountListeners("alice.near");

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("unsubscribing twice is a no-op", () => {
    const cb = vi.fn();
    const off = event.onAccount(cb);
    off();
    expect(() => off()).not.toThrow();
    event.notifyAccountListeners("alice.near");
    expect(cb).not.toHaveBeenCalled();
  });
});
