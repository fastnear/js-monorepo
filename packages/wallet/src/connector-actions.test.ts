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

describe("toConnectorAction refuses gas-key shapes", () => {
  // near-connect has no gas-key actions or permissions; these must never reach
  // a wallet as unknown objects or be reshaped into a plain key.
  const publicKey = "ed25519:11111111111111111111111111111111";

  it("throws for AddKey with a GasKeyFullAccess permission", () => {
    expect(() =>
      toConnectorAction({
        type: "AddKey",
        publicKey,
        accessKey: { nonce: 0, permission: "GasKeyFullAccess", numNonces: 2 },
      }),
    ).toThrow("Adding a gas key (GasKeyFullAccess) is not supported through the wallet connector");
  });

  it("throws for AddKey with a GasKeyFunctionCall permission", () => {
    expect(() =>
      toConnectorAction({
        type: "AddKey",
        publicKey,
        accessKey: { nonce: 0, permission: "GasKeyFunctionCall", numNonces: 2, receiverId: "c.testnet", methodNames: [] },
      }),
    ).toThrow("not supported through the wallet connector");
  });

  it("throws for TransferToGasKey and WithdrawFromGasKey instead of passing them through", () => {
    expect(() => toConnectorAction({ type: "TransferToGasKey", publicKey, deposit: "1" })).toThrow(
      "TransferToGasKey is not supported through the wallet connector",
    );
    expect(() => toConnectorAction({ type: "WithdrawFromGasKey", publicKey, amount: "1" })).toThrow(
      "WithdrawFromGasKey is not supported through the wallet connector",
    );
  });
});
