import { describe, expect, it } from "vitest";
import { toConnectorAction } from "./connector-actions.js";

describe("toConnectorAction AddKey", () => {
  it("normalizes the legacy flat FunctionCall permission for near-connect", () => {
    expect(toConnectorAction({
      type: "AddKey",
      publicKey: "ed25519:11111111111111111111111111111111",
      accessKey: {
        nonce: 0,
        permission: "FunctionCall",
        receiverId: "contract.testnet",
        methodNames: ["ping"],
        allowance: "10",
      },
    })).toEqual({
      type: "AddKey",
      params: {
        publicKey: "ed25519:11111111111111111111111111111111",
        accessKey: {
          nonce: 0,
          permission: {
            receiverId: "contract.testnet",
            methodNames: ["ping"],
            allowance: "10",
          },
        },
      },
    });
  });

  it("preserves the normalized object permission", () => {
    const permission = {
      receiverId: "contract.testnet",
      methodNames: [],
      allowance: null,
    };
    const converted = toConnectorAction({
      type: "AddKey",
      publicKey: "ed25519:11111111111111111111111111111111",
      accessKey: { nonce: 0, permission },
    }) as any;

    expect(converted.params.accessKey.permission).toBe(permission);
  });
});

describe("toConnectorAction maps gas-key shapes to near-connect 0.14 actions", () => {
  // near-connect gates these per wallet (manifest features.gasKeys); this layer
  // only has to translate the flat shapes faithfully.
  const publicKey = "ed25519:11111111111111111111111111111111";

  it("turns a GasKeyFullAccess AddKey into FullAccess + gasKeyInfo", () => {
    expect(toConnectorAction({ type: "AddKey", publicKey, accessKey: { nonce: 0, permission: "GasKeyFullAccess", numNonces: 2 } })).toEqual({
      type: "AddKey",
      params: { publicKey, accessKey: { nonce: 0, permission: "FullAccess" }, gasKeyInfo: { balance: "0", numNonces: 2 } },
    });
  });

  it("turns a GasKeyFunctionCall AddKey into a function-call permission + gasKeyInfo", () => {
    expect(
      toConnectorAction({
        type: "AddKey",
        publicKey,
        accessKey: { nonce: 0, permission: "GasKeyFunctionCall", numNonces: 2, receiverId: "c.testnet", methodNames: ["m"], balance: 0n },
      }),
    ).toEqual({
      type: "AddKey",
      params: { publicKey, accessKey: { nonce: 0, permission: { receiverId: "c.testnet", methodNames: ["m"] } }, gasKeyInfo: { balance: "0", numNonces: 2 } },
    });
  });

  it("refuses a gas key with an allowance or without numNonces", () => {
    expect(() =>
      toConnectorAction({ type: "AddKey", publicKey, accessKey: { permission: "GasKeyFunctionCall", numNonces: 1, receiverId: "c.testnet", allowance: "1" } }),
    ).toThrow("cannot carry an allowance");
    expect(() => toConnectorAction({ type: "AddKey", publicKey, accessKey: { permission: "GasKeyFullAccess" } })).toThrow("needs numNonces");
  });

  it("passes TransferToGasKey and WithdrawFromGasKey through as connector actions", () => {
    expect(toConnectorAction({ type: "TransferToGasKey", publicKey, deposit: "1" })).toEqual({ type: "TransferToGasKey", params: { publicKey, deposit: "1" } });
    expect(toConnectorAction({ type: "WithdrawFromGasKey", publicKey, amount: 2n })).toEqual({ type: "WithdrawFromGasKey", params: { publicKey, amount: "2" } });
  });
});
