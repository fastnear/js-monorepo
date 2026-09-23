import type { ConnectorAction } from "@fastnear/near-connect";

// Gas keys (protocol 85+) are a local-signing feature: near-connect has no
// gas-key actions or permissions, so passing these through would reach the
// wallet as unknown objects (or, worse, be reshaped into a plain key).
const GAS_KEY_PERMISSIONS = new Set(["GasKeyFullAccess", "GasKeyFunctionCall"]);

function unsupportedByWallet(what: string): Error {
  return new Error(
    `${what} is not supported through the wallet connector (near-connect has no gas-key actions); ` +
      "sign it locally with near.sendTx({ signer, signerId, ... })",
  );
}

function normalizeAddKeyAccessKey(accessKey: any): any {
  if (GAS_KEY_PERMISSIONS.has(accessKey?.permission)) {
    throw unsupportedByWallet(`Adding a gas key (${accessKey.permission})`);
  }
  if (accessKey?.permission !== "FunctionCall") return accessKey;
  const {
    permission: _permission,
    receiverId,
    methodNames,
    allowance,
    ...rest
  } = accessKey;
  return {
    ...rest,
    permission: {
      receiverId,
      methodNames: methodNames ?? [],
      allowance,
    },
  };
}

/** Convert a FastNear flat action to the near-connect action shape. */
export function toConnectorAction(action: any): ConnectorAction {
  const { type, ...rest } = action;
  switch (type) {
    case "FunctionCall":
      return { type: "FunctionCall", params: { methodName: rest.methodName, args: rest.args ?? {}, gas: rest.gas ?? "30000000000000", deposit: rest.deposit ?? "0" } };
    case "Transfer":
      return { type: "Transfer", params: { deposit: rest.deposit } };
    case "Stake":
      return { type: "Stake", params: { stake: rest.stake, publicKey: rest.publicKey } };
    case "AddKey":
      return {
        type: "AddKey",
        params: {
          publicKey: rest.publicKey,
          accessKey: normalizeAddKeyAccessKey(rest.accessKey),
        },
      };
    case "DeleteKey":
      return { type: "DeleteKey", params: { publicKey: rest.publicKey } };
    case "DeleteAccount":
      return { type: "DeleteAccount", params: { beneficiaryId: rest.beneficiaryId } };
    case "CreateAccount":
      return { type: "CreateAccount" } as ConnectorAction;
    case "DeployContract":
      return { type: "DeployContract", params: { code: rest.code ?? rest.codeBase64 } } as ConnectorAction;
    case "TransferToGasKey":
    case "WithdrawFromGasKey":
      throw unsupportedByWallet(type);
    default:
      // Pass through if already in connector format (has params).
      return action;
  }
}

export function toConnectorActions(actions: any[]): ConnectorAction[] {
  return actions.map(toConnectorAction);
}
