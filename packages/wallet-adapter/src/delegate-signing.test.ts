import { describe, it, expect } from "vitest";
import {
  bytesToBase64,
  delegateSigningHash,
  mapAction,
  privateKeyFromRandom,
  publicKeyFromPrivate,
  serializeSignedDelegate,
  signHash,
  type NearDelegateAction,
} from "@fastnear/utils";
import { validateSignedDelegate } from "./delegate-validation.js";

// End-to-end interop check: a SignedDelegate produced by the @fastnear/utils
// local-signing helpers (the seam behind `near.signDelegate`) must satisfy the
// wallet-adapter's independent validator — which recomputes the NEP-461 signing
// bytes with its own encoder. If the prefix or borsh layout drifted between the
// two, the signature would not verify here.
function buildSignedDelegate(overrides: Partial<NearDelegateAction> = {}) {
  const privateKey = privateKeyFromRandom("ed25519");
  const publicKey = publicKeyFromPrivate(privateKey);
  const delegate: NearDelegateAction = {
    senderId: "alice.testnet",
    receiverId: "bob.testnet",
    actions: [{ type: "Transfer", deposit: "1000000000000000000000000" }],
    nonce: "42",
    maxBlockHeight: "1300",
    publicKey,
    ...overrides,
  };
  const signature = signHash(delegateSigningHash(delegate), privateKey);
  const encoded = bytesToBase64(serializeSignedDelegate(delegate, signature));
  return { delegate, encoded };
}

describe("local delegate signing ↔ wallet-adapter validator", () => {
  it("produces a SignedDelegate the validator accepts", () => {
    const { delegate, encoded } = buildSignedDelegate();
    expect(() =>
      validateSignedDelegate(encoded, {
        senderId: delegate.senderId,
        receiverId: delegate.receiverId,
        maxBlockHeight: delegate.maxBlockHeight,
        actions: delegate.actions.map(mapAction),
      }),
    ).not.toThrow();
  });

  it("rejects a request bound to a different max block height", () => {
    const { delegate, encoded } = buildSignedDelegate();
    expect(() =>
      validateSignedDelegate(encoded, {
        senderId: delegate.senderId,
        receiverId: delegate.receiverId,
        maxBlockHeight: "1301",
        actions: delegate.actions.map(mapAction),
      }),
    ).toThrow(/does not match the requested delegate action/);
  });

  it("rejects when the signature is over a different sender", () => {
    // Sign for alice, then re-wrap the bytes claiming carol — the recomputed
    // digest changes, so signature verification must fail.
    const { encoded } = buildSignedDelegate({ senderId: "alice.testnet" });
    expect(() =>
      validateSignedDelegate(encoded, {
        senderId: "carol.testnet",
        receiverId: "bob.testnet",
        maxBlockHeight: "1300",
        actions: [{ type: "Transfer", deposit: "1000000000000000000000000" }].map(mapAction),
      }),
    ).toThrow();
  });
});
