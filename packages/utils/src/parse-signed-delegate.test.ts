import { describe, it, expect } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  delegateSigningHash,
  parseSignedDelegate,
  privateKeyFromRandom,
  publicKeyFromPrivate,
  serializeSignedDelegate,
  signHash,
  toBase58,
  type NearClassicAction,
  type NearDelegateAction,
} from "@fastnear/utils";

// parseSignedDelegate is the inverse of serializeSignedDelegate: it turns the
// borsh bytes a wallet's signDelegateActions hands back into the flat
// { delegateAction, signature } shape relayDelegate / actions.signedDelegate
// accept. The strongest oracle is a byte-identical round-trip against a real
// signature, since re-serializing the parsed output must reproduce the exact
// bytes the wallet signed — anything else changes the signed payload.

const priv = privateKeyFromRandom("ed25519");
const pub = publicKeyFromPrivate(priv);

function sign(delegate: NearDelegateAction): { bytes: Uint8Array; b64: string } {
  const sig = signHash(delegateSigningHash(delegate), priv);
  const bytes = serializeSignedDelegate(delegate, sig);
  return { bytes, b64: bytesToBase64(bytes) };
}

function delegateWith(actions: NearClassicAction[]): NearDelegateAction {
  return {
    senderId: "alice.near",
    receiverId: "app.near",
    actions,
    nonce: "42",
    maxBlockHeight: "1000000",
    publicKey: pub,
  };
}

describe("parseSignedDelegate round-trip", () => {
  it("re-serializes byte-identical for a mixed delegate", () => {
    const delegate = delegateWith([
      { type: "Transfer", deposit: "0.5 NEAR" },
      { type: "FunctionCall", methodName: "go", args: { x: 1 }, gas: "30 Tgas", deposit: "1" },
    ]);
    const { bytes, b64 } = sign(delegate);

    const parsed = parseSignedDelegate({ borshSerializedBase64: b64 });
    const re = serializeSignedDelegate(parsed.delegateAction, parsed.signature);

    expect(bytesToBase64(re)).toBe(bytesToBase64(bytes));
  });

  it("preserves FunctionCall args byte-for-byte, even when they are not valid JSON", () => {
    const rawArgs = new Uint8Array([0, 255, 1, 254, 200]); // not JSON
    const delegate = delegateWith([
      { type: "FunctionCall", methodName: "raw", argsBase64: bytesToBase64(rawArgs), gas: "30 Tgas", deposit: "0" },
    ]);
    const { bytes } = sign(delegate);

    const parsed = parseSignedDelegate(bytesToBase64(bytes));
    const fc = parsed.delegateAction.actions[0] as Extract<NearClassicAction, { type: "FunctionCall" }>;

    expect(fc.type).toBe("FunctionCall");
    expect(fc.argsBase64).toBe(bytesToBase64(rawArgs));
    expect(bytesToBase64(serializeSignedDelegate(parsed.delegateAction, parsed.signature))).toBe(bytesToBase64(bytes));
  });

  it("round-trips every ClassicAction variant byte-identically", () => {
    const variants: NearClassicAction[][] = [
      [{ type: "CreateAccount" }],
      [{ type: "DeployContract", codeBase64: bytesToBase64(new Uint8Array([1, 2, 3, 0, 255])) }],
      [{ type: "Transfer", deposit: "123" }],
      [{ type: "Stake", stake: "10 NEAR", publicKey: pub }],
      [{ type: "AddKey", publicKey: pub, accessKey: { permission: "FullAccess" } }],
      [{ type: "AddKey", publicKey: pub, accessKey: { permission: { receiverId: "c.near", methodNames: ["m1", "m2"], allowance: "0.25 NEAR" } } }],
      [{ type: "AddKey", publicKey: pub, accessKey: { permission: { receiverId: "c.near", methodNames: [], allowance: null } } }],
      [{ type: "DeleteKey", publicKey: pub }],
      [{ type: "DeleteAccount", beneficiaryId: "heir.near" }],
    ];
    for (const actions of variants) {
      const { bytes } = sign(delegateWith(actions));
      const parsed = parseSignedDelegate(bytesToBase64(bytes));
      const re = serializeSignedDelegate(parsed.delegateAction, parsed.signature);
      expect(bytesToBase64(re), `variant ${actions[0].type}`).toBe(bytesToBase64(bytes));
    }
  });

  it("round-trips a delegate with zero actions", () => {
    const { bytes } = sign(delegateWith([]));
    const parsed = parseSignedDelegate(bytesToBase64(bytes));
    expect(parsed.delegateAction.actions).toEqual([]);
    expect(bytesToBase64(serializeSignedDelegate(parsed.delegateAction, parsed.signature))).toBe(bytesToBase64(bytes));
  });

  it("preserves max-width u128/u64 amounts exactly (no numeric rounding)", () => {
    const maxU128 = (2n ** 128n - 1n).toString();
    const maxU64 = (2n ** 64n - 1n).toString();
    const delegate: NearDelegateAction = {
      senderId: "alice.near",
      receiverId: "app.near",
      actions: [{ type: "Transfer", deposit: maxU128 }],
      nonce: maxU64,
      maxBlockHeight: maxU64,
      publicKey: pub,
    };
    const { bytes } = sign(delegate);
    const parsed = parseSignedDelegate(bytesToBase64(bytes));
    expect((parsed.delegateAction.actions[0] as any).deposit).toBe(maxU128);
    expect(parsed.delegateAction.nonce).toBe(maxU64);
    expect(bytesToBase64(serializeSignedDelegate(parsed.delegateAction, parsed.signature))).toBe(bytesToBase64(bytes));
  });

  it("round-trips a delegate carrying many actions", () => {
    const many: NearClassicAction[] = Array.from({ length: 24 }, (_, i) => ({
      type: "FunctionCall" as const,
      methodName: `m${i}`,
      argsBase64: bytesToBase64(new Uint8Array([i, i + 1, i + 2])),
      gas: "10 Tgas",
      deposit: String(i),
    }));
    const { bytes } = sign(delegateWith(many));
    const parsed = parseSignedDelegate(bytesToBase64(bytes));
    expect(parsed.delegateAction.actions).toHaveLength(24);
    expect(bytesToBase64(serializeSignedDelegate(parsed.delegateAction, parsed.signature))).toBe(bytesToBase64(bytes));
  });

  it("recovers the flat fields with the right types and encodings", () => {
    const { bytes } = sign(delegateWith([{ type: "Transfer", deposit: "7" }]));
    const parsed = parseSignedDelegate(bytesToBase64(bytes));

    expect(parsed.delegateAction.senderId).toBe("alice.near");
    expect(parsed.delegateAction.receiverId).toBe("app.near");
    expect(parsed.delegateAction.nonce).toBe("42"); // decimal string, not bigint
    expect(parsed.delegateAction.maxBlockHeight).toBe("1000000");
    expect(parsed.delegateAction.publicKey).toBe(pub); // ed25519:... string
    expect(typeof parsed.signature).toBe("string"); // bare base58, like signDelegate
    expect(parsed.signatureBytes).toBeInstanceOf(Uint8Array);
    expect(parsed.signatureBytes.length).toBe(64);
    expect(parsed.borshBase64).toBe(bytesToBase64(bytes));
    // The bare-base58 signature matches signHash's output.
    expect(parsed.signature).toBe(toBase58(signHash(delegateSigningHash(delegateWith([{ type: "Transfer", deposit: "7" }])), priv)));
  });
});

describe("parseSignedDelegate input envelopes", () => {
  const { b64 } = sign(delegateWith([{ type: "Transfer", deposit: "1" }]));
  const expected = parseSignedDelegate(b64).borshBase64;

  it("accepts a bare base64 string", () => {
    expect(parseSignedDelegate(b64).borshBase64).toBe(expected);
  });
  it("accepts { borshSerializedBase64 } (the canonical wallet entry)", () => {
    expect(parseSignedDelegate({ borshSerializedBase64: b64 }).borshBase64).toBe(expected);
  });
  it("accepts { borshBase64 } (signDelegate's own return)", () => {
    expect(parseSignedDelegate({ borshBase64: b64 }).borshBase64).toBe(expected);
  });
  it("unwraps the { signedDelegateActions: [entry] } response", () => {
    expect(parseSignedDelegate({ signedDelegateActions: [{ borshSerializedBase64: b64 }] }).borshBase64).toBe(expected);
    expect(parseSignedDelegate({ signedDelegateActions: [b64] }).borshBase64).toBe(expected);
  });
});

describe("parseSignedDelegate errors", () => {
  const { b64 } = sign(delegateWith([{ type: "Transfer", deposit: "1" }]));

  it("rejects a multi-entry signedDelegateActions wrapper", () => {
    expect(() =>
      parseSignedDelegate({ signedDelegateActions: [{ borshSerializedBase64: b64 }, { borshSerializedBase64: b64 }] }),
    ).toThrow(/exactly one signed delegate/);
  });

  it("rejects the legacy { delegateHash, signedDelegate } shape with a clear error", () => {
    expect(() =>
      parseSignedDelegate({ delegateHash: new Uint8Array(32), signedDelegate: {} } as any),
    ).toThrow(/legacy .* not supported/i);
  });

  it("rejects unrecognized input", () => {
    expect(() => parseSignedDelegate({} as any)).toThrow(/unrecognized input/);
    expect(() => parseSignedDelegate(42 as any)).toThrow(/unrecognized input/);
  });

  it("rejects trailing / non-canonical bytes after the SignedDelegate", () => {
    const bytes = base64ToBytes(b64);
    const withTrailing = new Uint8Array(bytes.length + 5);
    withTrailing.set(bytes);
    withTrailing.set([0xde, 0xad, 0xbe, 0xef, 0x99], bytes.length);
    expect(() => parseSignedDelegate(bytesToBase64(withTrailing))).toThrow(/not canonical/);
  });

  it("returns a canonical borshBase64 that matches its own re-serialization", () => {
    const parsed = parseSignedDelegate(b64);
    const re = serializeSignedDelegate(parsed.delegateAction, parsed.signature);
    expect(parsed.borshBase64).toBe(bytesToBase64(re));
    expect(base64ToBytes(parsed.borshBase64).length).toBe(re.length);
  });

  it("gives a clear error (not a raw borsh message) for garbage / truncated / empty base64", () => {
    for (const bad of ["", "zzzzzzzz", "!!!!", b64.slice(0, b64.length - 8)]) {
      expect(() => parseSignedDelegate(bad), `input ${JSON.stringify(bad)}`).toThrow(
        /parseSignedDelegate: could not decode/,
      );
    }
  });
});
