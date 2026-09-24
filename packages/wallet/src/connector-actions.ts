import type { ConnectorAction } from "@fastnear/near-connect";

// Gas keys (protocol 85+) travel as near-connect 0.14+ shapes: an AddKey with
// params.gasKeyInfo next to a plain permission, plus TransferToGasKey and
// WithdrawFromGasKey. near-connect itself refuses them for wallets whose
// manifest does not set features.gasKeys, so nothing here needs to guess
// what a wallet understands. Signing *with* a gas key (nonceIndex /
// TransactionV1) stays local — see near.sendTx.
const GAS_KEY_PERMISSIONS = new Set(["GasKeyFullAccess", "GasKeyFunctionCall"]);

function toConnectorAddKeyParams(publicKey: string, accessKey: any): { publicKey: string; accessKey: any; gasKeyInfo?: { balance: string; numNonces: number } } {
  const { permission, receiverId, methodNames, allowance, numNonces, balance, ...rest } = accessKey ?? {};
  if (GAS_KEY_PERMISSIONS.has(permission)) {
    if (allowance != null) {
      throw new Error("A gas key cannot carry an allowance: its balance is the allowance");
    }
    if (!Number.isInteger(numNonces) || numNonces < 1) {
      throw new Error(`Adding a gas key needs numNonces (1..1024); got ${numNonces}`);
    }
    return {
      publicKey,
      accessKey: {
        ...rest,
        permission: permission === "GasKeyFullAccess" ? "FullAccess" : { receiverId, methodNames: methodNames ?? [] },
      },
      gasKeyInfo: { balance: balance == null ? "0" : String(balance), numNonces },
    };
  }
  if (permission !== "FunctionCall") return { publicKey, accessKey };
  return {
    publicKey,
    accessKey: {
      ...rest,
      permission: { receiverId, methodNames: methodNames ?? [], allowance },
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
      return { type: "AddKey", params: toConnectorAddKeyParams(rest.publicKey, rest.accessKey) };
    case "DeleteKey":
      return { type: "DeleteKey", params: { publicKey: rest.publicKey } };
    case "DeleteAccount":
      return { type: "DeleteAccount", params: { beneficiaryId: rest.beneficiaryId } };
    case "CreateAccount":
      return { type: "CreateAccount" } as ConnectorAction;
    case "DeployContract":
      return { type: "DeployContract", params: { code: rest.code ?? rest.codeBase64 } } as ConnectorAction;
    case "TransferToGasKey":
      return { type: "TransferToGasKey", params: { publicKey: rest.publicKey, deposit: String(rest.deposit) } };
    case "WithdrawFromGasKey":
      return { type: "WithdrawFromGasKey", params: { publicKey: rest.publicKey, amount: String(rest.amount) } };
    default:
      // Pass through if already in connector format (has params).
      return action;
  }
}

export function toConnectorActions(actions: any[]): ConnectorAction[] {
  return actions.map(toConnectorAction);
}
