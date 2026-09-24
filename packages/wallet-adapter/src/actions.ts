import { bytesToBase64, isGasKeyPermission } from "@fastnear/utils";
import type { ConnectorActionLike } from "./types.js";

/**
 * near-connect 0.14+ gas-key shapes: AddKey with `params.gasKeyInfo`,
 * TransferToGasKey and WithdrawFromGasKey. A wallet that does not understand
 * them must never see them (it could add a plain key), so callers that do
 * not encode locally gate on this.
 */
export const isGasKeyConnectorAction = (action: ConnectorActionLike): boolean =>
  action.type === "TransferToGasKey" ||
  action.type === "WithdrawFromGasKey" ||
  (action.type === "AddKey" && action.params?.gasKeyInfo != null);

const toBase64Code = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return bytesToBase64(value);
  if (Array.isArray(value)) return bytesToBase64(Uint8Array.from(value));
  throw new Error("DeployContract code must be Uint8Array, Array<number>, or base64 string");
};

export const connectorActionsToFastnearActions = (actions: ConnectorActionLike[]): any[] => {
  return actions.map((action) => {
    if (typeof action !== "object" || action == null) {
      throw new Error("Invalid action");
    }

    if (!("type" in action) || typeof action.type !== "string") {
      throw new Error("Action is missing type");
    }

    switch (action.type) {
      case "FunctionCall":
        return {
          type: "FunctionCall",
          methodName: action.params?.methodName,
          args: action.params?.args ?? {},
          gas: action.params?.gas ?? "30000000000000",
          deposit: action.params?.deposit ?? "0",
        };
      case "Transfer":
        return {
          type: "Transfer",
          deposit: action.params?.deposit,
        };
      case "AddKey": {
        const permission = action.params?.accessKey?.permission;
        if (isGasKeyPermission(permission)) {
          // The connector format carries gas keys as params.gasKeyInfo next to
          // a plain permission; a flat kind string here is a mis-shaped action.
          throw new Error(
            `Gas-key access keys are expressed as params.gasKeyInfo on a FullAccess or function-call AddKey, not as permission "${permission}"`,
          );
        }
        if (permission !== "FullAccess" && typeof permission?.receiverId !== "string") {
          throw new Error("Unsupported access-key permission: expected FullAccess or { receiverId, methodNames, allowance }");
        }
        const gasKey = action.params?.gasKeyInfo;
        if (gasKey != null) {
          if (typeof gasKey.numNonces !== "number") throw new Error("gasKeyInfo.numNonces must be a number (1..1024)");
          if (permission !== "FullAccess" && permission.allowance != null) {
            throw new Error("A gas key cannot carry an allowance: its balance is the allowance");
          }
          return {
            type: "AddKey",
            publicKey: action.params?.publicKey,
            accessKey: {
              nonce: action.params?.accessKey?.nonce ?? 0,
              permission: permission === "FullAccess" ? "GasKeyFullAccess" : "GasKeyFunctionCall",
              numNonces: gasKey.numNonces,
              balance: gasKey.balance ?? "0",
              ...(permission === "FullAccess" ? {} : { receiverId: permission.receiverId, methodNames: permission.methodNames ?? [] }),
            },
          };
        }
        return {
          type: "AddKey",
          publicKey: action.params?.publicKey,
          accessKey: {
            nonce: action.params?.accessKey?.nonce ?? 0,
            permission:
              permission === "FullAccess"
                ? "FullAccess"
                : {
                    receiverId: permission.receiverId,
                    methodNames: permission.methodNames ?? [],
                    allowance: permission.allowance,
                  },
          },
        };
      }
      case "TransferToGasKey":
        return { type: "TransferToGasKey", publicKey: action.params?.publicKey, deposit: action.params?.deposit };
      case "WithdrawFromGasKey":
        return { type: "WithdrawFromGasKey", publicKey: action.params?.publicKey, amount: action.params?.amount };
      case "DeleteKey":
        return {
          type: "DeleteKey",
          publicKey: action.params?.publicKey,
        };
      case "CreateAccount":
        return {
          type: "CreateAccount",
        };
      case "DeleteAccount":
        return {
          type: "DeleteAccount",
          beneficiaryId: action.params?.beneficiaryId,
        };
      case "DeployContract":
        return {
          type: "DeployContract",
          codeBase64: toBase64Code(action.params?.code),
        };
      case "Stake":
        return {
          type: "Stake",
          stake: action.params?.stake,
          publicKey: action.params?.publicKey,
        };
      default:
        throw new Error(`Unsupported action type: ${action.type}`);
    }
  });
};
