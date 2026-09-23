import { describe, expect, it } from "vitest";
import { connectorActionsToFastnearActions } from "./actions.js";

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

  it("refuses gas-key permissions instead of downgrading them to a plain key", () => {
    for (const permission of ["GasKeyFullAccess", "GasKeyFunctionCall"]) {
      expect(() =>
        connectorActionsToFastnearActions([
          { type: "AddKey", params: { publicKey, accessKey: { permission, numNonces: 2, receiverId: "c.testnet" } } },
        ]),
      ).toThrow(`Gas-key access keys (${permission}) cannot be added through a wallet adapter`);
    }
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
  it("refuses TransferToGasKey and WithdrawFromGasKey with a specific message", () => {
    expect(() =>
      connectorActionsToFastnearActions([{ type: "TransferToGasKey", params: { publicKey, deposit: "1" } } as any]),
    ).toThrow("TransferToGasKey cannot be sent through a wallet adapter");
    expect(() =>
      connectorActionsToFastnearActions([{ type: "WithdrawFromGasKey", params: { publicKey, amount: "1" } } as any]),
    ).toThrow("WithdrawFromGasKey cannot be sent through a wallet adapter");
  });

  it("still rejects unknown action types", () => {
    expect(() => connectorActionsToFastnearActions([{ type: "Nope" } as any])).toThrow("Unsupported action type: Nope");
  });
});
