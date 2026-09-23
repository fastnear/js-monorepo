import { bytesToBase64, isGasKeyPermission } from "@fastnear/utils";
import type { ConnectorActionLike } from "./types.js";

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
          // Wallets decode the transaction with their own schema; a gas-key
          // permission would fail or mis-render there. Never reshape it into a
          // plain key silently.
          throw new Error(
            `Gas-key access keys (${permission}) cannot be added through a wallet adapter; ` +
              "sign locally with near.sendTx",
          );
        }
        if (permission !== "FullAccess" && typeof permission?.receiverId !== "string") {
          throw new Error("Unsupported access-key permission: expected FullAccess or { receiverId, methodNames, allowance }");
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
      case "WithdrawFromGasKey":
        throw new Error(
          `${action.type} cannot be sent through a wallet adapter (gas keys are a local-signing feature); ` +
            "sign locally with near.sendTx",
        );
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
