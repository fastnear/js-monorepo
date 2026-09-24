import { describe, expect, it } from "vitest";
import { connectorActionsToFastnearActions, isGasKeyConnectorAction } from "./actions.js";

const publicKey = "ed25519:11111111111111111111111111111111";

describe("connectorActionsToFastnearActions AddKey", () => {
  it("passes FullAccess through", () => {
    expect(
      connectorActionsToFastnearActions([
        { type: "AddKey", params: { publicKey, accessKey: { nonce: 3, permission: "FullAccess" } } },
      ]),
    ).toEqual([{ type: "AddKey", publicKey, accessKey: { nonce: 3, permission: "FullAccess" } }]);
  });

  it("maps a function-call permission object", () => {
    expect(
      connectorActionsToFastnearActions([
        {
          type: "AddKey",
          params: {
            publicKey,
            accessKey: { permission: { receiverId: "c.testnet", methodNames: ["m"], allowance: "1" } },
          },
        },
      ]),
    ).toEqual([
      {
        type: "AddKey",
        publicKey,
        accessKey: { nonce: 0, permission: { receiverId: "c.testnet", methodNames: ["m"], allowance: "1" } },
      },
    ]);
  });

  it("refuses a flat gas-key kind in the permission slot (the connector format is params.gasKeyInfo)", () => {
    for (const permission of ["GasKeyFullAccess", "GasKeyFunctionCall"]) {
      expect(() =>
        connectorActionsToFastnearActions([
          { type: "AddKey", params: { publicKey, accessKey: { permission, numNonces: 2, receiverId: "c.testnet" } } },
        ]),
      ).toThrow("expressed as params.gasKeyInfo");
    }
  });

  it("maps AddKey + gasKeyInfo to the flat gas-key permission kinds", () => {
    expect(
      connectorActionsToFastnearActions([
        { type: "AddKey", params: { publicKey, accessKey: { permission: "FullAccess" }, gasKeyInfo: { balance: "0", numNonces: 4 } } },
        {
          type: "AddKey",
          params: { publicKey, accessKey: { permission: { receiverId: "c.testnet", methodNames: ["m"] } }, gasKeyInfo: { balance: "0", numNonces: 2 } },
        },
      ]),
    ).toEqual([
      { type: "AddKey", publicKey, accessKey: { nonce: 0, permission: "GasKeyFullAccess", numNonces: 4, balance: "0" } },
      {
        type: "AddKey",
        publicKey,
        accessKey: { nonce: 0, permission: "GasKeyFunctionCall", numNonces: 2, balance: "0", receiverId: "c.testnet", methodNames: ["m"] },
      },
    ]);
  });

  it("refuses a gas key with an allowance (the balance is the allowance)", () => {
    expect(() =>
      connectorActionsToFastnearActions([
        { type: "AddKey", params: { publicKey, accessKey: { permission: { receiverId: "c.testnet", allowance: "1" } }, gasKeyInfo: { balance: "0", numNonces: 1 } } },
      ]),
    ).toThrow("cannot carry an allowance");
  });

  it("refuses an unrecognised permission shape", () => {
    expect(() =>
      connectorActionsToFastnearActions([
        { type: "AddKey", params: { publicKey, accessKey: { permission: "GasKey" } } },
      ]),
    ).toThrow("Unsupported access-key permission");
  });
});

describe("connectorActionsToFastnearActions gas-key actions", () => {
  it("maps TransferToGasKey and WithdrawFromGasKey to the flat shapes", () => {
    expect(
      connectorActionsToFastnearActions([
        { type: "TransferToGasKey", params: { publicKey, deposit: "1" } },
        { type: "WithdrawFromGasKey", params: { publicKey, amount: "2" } },
      ]),
    ).toEqual([
      { type: "TransferToGasKey", publicKey, deposit: "1" },
      { type: "WithdrawFromGasKey", publicKey, amount: "2" },
    ]);
  });

  it("isGasKeyConnectorAction recognises exactly the gas-key shapes", () => {
    expect(isGasKeyConnectorAction({ type: "AddKey", params: { publicKey, accessKey: { permission: "FullAccess" } } })).toBe(false);
    expect(isGasKeyConnectorAction({ type: "AddKey", params: { publicKey, accessKey: { permission: "FullAccess" }, gasKeyInfo: { balance: "0", numNonces: 1 } } })).toBe(true);
    expect(isGasKeyConnectorAction({ type: "TransferToGasKey", params: { publicKey, deposit: "1" } })).toBe(true);
    expect(isGasKeyConnectorAction({ type: "WithdrawFromGasKey", params: { publicKey, amount: "1" } })).toBe(true);
    expect(isGasKeyConnectorAction({ type: "Transfer", params: { deposit: "1" } })).toBe(false);
  });

  it("still rejects unknown action types", () => {
    expect(() => connectorActionsToFastnearActions([{ type: "Nope" } as any])).toThrow("Unsupported action type: Nope");
  });
});
