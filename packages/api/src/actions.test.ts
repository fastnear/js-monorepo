import { describe, expect, it } from "vitest";
import { actions, explain, gasKeyInfoFromPermission, MAX_GAS_KEY_NONCES } from "./near.js";

const PK = "ed25519:1thX6LZfHDZZKUs92febYZhYRcXddmzfzF2NvTkPNE";

describe("gas-key action builders", () => {
  it("addFullAccessGasKey builds an AddKey with the GasKeyFullAccess permission", () => {
    expect(actions.addFullAccessGasKey({ publicKey: PK, numNonces: 4 })).toEqual({
      type: "AddKey",
      publicKey: PK,
      accessKey: { nonce: 0, permission: "GasKeyFullAccess", numNonces: 4 },
    });
  });

  it("addLimitedAccessGasKey builds a GasKeyFunctionCall permission with no allowance field", () => {
    const built = actions.addLimitedAccessGasKey({
      publicKey: PK,
      numNonces: 2,
      accountId: "app.testnet",
      methodNames: ["ping"],
    });
    expect(built).toEqual({
      type: "AddKey",
      publicKey: PK,
      accessKey: {
        nonce: 0,
        permission: "GasKeyFunctionCall",
        numNonces: 2,
        receiverId: "app.testnet",
        methodNames: ["ping"],
      },
    });
    expect("allowance" in built.accessKey).toBe(false);
  });

  it("validates numNonces as an integer in 1..MAX_GAS_KEY_NONCES", () => {
    expect(MAX_GAS_KEY_NONCES).toBe(1024);
    for (const numNonces of [0, 1025, 1.5, "2", undefined, NaN]) {
      expect(() => actions.addFullAccessGasKey({ publicKey: PK, numNonces: numNonces as any }), String(numNonces))
        .toThrow("numNonces must be an integer between 1 and 1024");
      expect(() =>
        actions.addLimitedAccessGasKey({ publicKey: PK, numNonces: numNonces as any, accountId: "a.testnet", methodNames: [] }),
      ).toThrow("numNonces must be an integer between 1 and 1024");
    }
  });

  it("addLimitedAccessGasKey requires an accountId", () => {
    expect(() =>
      actions.addLimitedAccessGasKey({ publicKey: PK, numNonces: 1, accountId: "" as any, methodNames: [] }),
    ).toThrow("requires accountId");
  });

  it("transferToGasKey and withdrawFromGasKey carry the key and amount as given", () => {
    expect(actions.transferToGasKey({ publicKey: PK, deposit: "0.05 NEAR" })).toEqual({
      type: "TransferToGasKey",
      publicKey: PK,
      deposit: "0.05 NEAR",
    });
    expect(actions.withdrawFromGasKey({ publicKey: PK, amount: "1" })).toEqual({
      type: "WithdrawFromGasKey",
      publicKey: PK,
      amount: "1",
    });
  });
});

describe("explain.action for gas keys", () => {
  it("surfaces numNonces for a gas-key AddKey and omits it for a classical one", () => {
    const gas = explain.action(actions.addFullAccessGasKey({ publicKey: PK, numNonces: 3 }));
    expect(gas.type).toBe("AddKey");
    expect(gas.numNonces).toBe(3);
    const classical = explain.action(actions.addFullAccessKey({ publicKey: PK }));
    expect("numNonces" in classical).toBe(false);
  });

  it("explains TransferToGasKey (deposit) and WithdrawFromGasKey (amount)", () => {
    expect(explain.action(actions.transferToGasKey({ publicKey: PK, deposit: "5" }))).toMatchObject({
      kind: "action",
      type: "TransferToGasKey",
      publicKey: PK,
      deposit: "5",
    });
    expect(explain.action(actions.withdrawFromGasKey({ publicKey: PK, amount: "7" }))).toMatchObject({
      kind: "action",
      type: "WithdrawFromGasKey",
      publicKey: PK,
      amount: "7",
    });
  });
});

describe("gasKeyInfoFromPermission", () => {
  it("returns null for classical permissions", () => {
    expect(gasKeyInfoFromPermission("FullAccess")).toBeNull();
    expect(gasKeyInfoFromPermission({ FunctionCall: { allowance: null, receiver_id: "a", method_names: [] } })).toBeNull();
    expect(gasKeyInfoFromPermission(undefined)).toBeNull();
  });

  it("flattens both gas-key views", () => {
    expect(gasKeyInfoFromPermission({ GasKeyFullAccess: { balance: "9", num_nonces: 3 } })).toEqual({
      balance: "9",
      num_nonces: 3,
      functionCall: null,
    });
    expect(
      gasKeyInfoFromPermission({
        GasKeyFunctionCall: { balance: "0", num_nonces: 1, allowance: null, receiver_id: "app.near", method_names: ["m"] },
      }),
    ).toEqual({
      balance: "0",
      num_nonces: 1,
      functionCall: { allowance: null, receiver_id: "app.near", method_names: ["m"] },
    });
  });
});
