import { serialize as borshSerialize } from "@fastnear/borsh";
import {
  assertNearValidatorPublicKey,
  decodeNearPublicKey,
  keyFromString,
  keyTypeFromString,
  NEAR_KEY_DESCRIPTORS,
  type NearPublicKey,
} from "./crypto.js";
import { base64ToBytes, fromBase58 } from "./misc.js";
import { convertUnit } from "./units.js";
import { getBorshSchema } from "@fastnear/borsh-schema";

export type NearInteger = string | bigint | number;

/**
 * Coerce a NearInteger amount field (gas, deposit, stake, allowance) to bigint.
 *
 * String values may carry a human unit suffix — "100 Tgas", "0.01 NEAR" —
 * which is exactly the shape the wallet path and the demo site's action
 * config use. `convertUnit` scales those to a plain yocto/gas integer string
 * (and is a no-op on unit-less digits), so local signing via `near.sendTx`
 * accepts the same action shape the wallet path does instead of throwing a
 * bare `BigInt` conversion error.
 */
function toNearAmount(
  value: NearInteger | null | undefined,
  fallback: NearInteger = 0,
): bigint {
  const resolved = value ?? fallback;
  if (typeof resolved === "bigint") return resolved;
  if (typeof resolved === "number") return BigInt(resolved);
  return BigInt(convertUnit(resolved.trim()));
}

export interface NearCreateAccountAction {
  type: "CreateAccount";
}

export interface NearDeployContractAction {
  type: "DeployContract";
  codeBase64: string;
}

export interface NearFunctionCallAction {
  type: "FunctionCall";
  methodName: string;
  args?: unknown;
  argsBase64?: string | null;
  gas?: NearInteger;
  deposit?: NearInteger;
}

export interface NearTransferAction {
  type: "Transfer";
  deposit: NearInteger;
}

export interface NearStakeAction {
  type: "Stake";
  stake: NearInteger;
  publicKey: NearPublicKey;
}

export interface NearFunctionCallPermission {
  receiverId: string;
  methodNames?: string[];
  allowance?: NearInteger | null;
}

export interface NearAccessKey {
  nonce?: NearInteger;
  permission: "FullAccess" | "FunctionCall" | NearFunctionCallPermission;
  receiverId?: string;
  methodNames?: string[];
  allowance?: NearInteger | null;
}

export interface NearAddKeyAction {
  type: "AddKey";
  publicKey: NearPublicKey;
  accessKey: NearAccessKey;
}

export interface NearDeleteKeyAction {
  type: "DeleteKey";
  publicKey: NearPublicKey;
}

export interface NearDeleteAccountAction {
  type: "DeleteAccount";
  beneficiaryId: string;
}

export type NearClassicAction =
  | NearCreateAccountAction
  | NearDeployContractAction
  | NearFunctionCallAction
  | NearTransferAction
  | NearStakeAction
  | NearAddKeyAction
  | NearDeleteKeyAction
  | NearDeleteAccountAction;

export interface NearDelegateAction {
  senderId: string;
  receiverId: string;
  actions: NearClassicAction[];
  nonce: NearInteger;
  maxBlockHeight: NearInteger;
  publicKey: NearPublicKey;
}

export interface NearSignedDelegateAction {
  type: "SignedDelegate";
  delegateAction: NearDelegateAction;
  signature: string | Uint8Array;
  publicKey?: NearPublicKey;
}

export type NearAction = NearClassicAction | NearSignedDelegateAction;

export interface PlainTransaction {
  signerId: string;
  publicKey: NearPublicKey;
  nonce: NearInteger;
  receiverId: string;
  blockHash: string;
  actions: NearAction[];
}

export interface PlainSignedTransaction {
  transaction: object;
  signature: object;
}

// Function to return a JSON-ready version of the transaction
export const txToJson = (tx: PlainTransaction): Record<string, any> => {
  return JSON.parse(
    JSON.stringify(tx, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
};

// Return a compact JSON string of the transaction (for display/logging)
export const txToJsonStringified = (tx: PlainTransaction): string => {
  return JSON.stringify(txToJson(tx));
};

function mapPublicKey(keyString: string) {
  const { keyType, data } = decodeNearPublicKey(keyString);
  return { [NEAR_KEY_DESCRIPTORS[keyType].publicKeyVariant]: { data } };
}

function mapSignature(signature: string | Uint8Array, signerKeyString: string) {
  const keyType = keyTypeFromString(signerKeyString);
  let data: Uint8Array;
  if (typeof signature === "string") {
    if (signature.includes(":")) {
      const signatureKeyType = keyTypeFromString(signature);
      if (signatureKeyType !== keyType) {
        throw new Error(
          `Signature key type ${signatureKeyType} does not match signer key type ${keyType}`,
        );
      }
      data = keyFromString(signature);
    } else {
      data = keyFromString(`${keyType}:${signature}`);
    }
  } else {
    data = signature;
  }
  const expected = NEAR_KEY_DESCRIPTORS[keyType].signatureLength;
  if (data.length !== expected) {
    throw new Error(
      `Invalid ${keyType} signature length: expected ${expected} bytes, got ${data.length}`,
    );
  }

  return { [NEAR_KEY_DESCRIPTORS[keyType].signatureVariant]: { data } };
}

export function mapTransaction(jsonTransaction: PlainTransaction) {
  return {
    signerId: jsonTransaction.signerId,
    publicKey: mapPublicKey(jsonTransaction.publicKey),
    nonce: BigInt(jsonTransaction.nonce),
    receiverId: jsonTransaction.receiverId,
    blockHash: fromBase58(jsonTransaction.blockHash),
    actions: jsonTransaction.actions.map(mapAction),
  };
}

export function serializeTransaction(jsonTransaction: PlainTransaction) {
  const transaction = mapTransaction(jsonTransaction);
  return borshSerialize(SCHEMA.Transaction, transaction);
}

export function serializeSignedTransaction(
  jsonTransaction: PlainTransaction,
  signature: string | Uint8Array,
) {
  const mappedSignedTx = mapTransaction(jsonTransaction);

  const plainSignedTransaction: PlainSignedTransaction = {
    transaction: mappedSignedTx,
    signature: mapSignature(signature, jsonTransaction.publicKey),
  };

  return borshSerialize(SCHEMA.SignedTransaction, plainSignedTransaction);
}

export function mapAction(action: NearAction): object {
  switch (action.type) {
    case "CreateAccount": {
      return {
        createAccount: {},
      };
    }
    case "DeployContract": {
      return {
        deployContract: {
          code: base64ToBytes(action.codeBase64),
        },
      };
    }
    case "FunctionCall": {
      return {
        functionCall: {
          methodName: action.methodName,
          args:
            action.argsBase64 !== null && action.argsBase64 !== undefined
              ? base64ToBytes(action.argsBase64)
              : new TextEncoder().encode(JSON.stringify(action.args ?? {})),
          gas: toNearAmount(action.gas, "300000000000000"),
          deposit: toNearAmount(action.deposit),
        },
      };
    }
    case "Transfer": {
      return {
        transfer: {
          deposit: toNearAmount(action.deposit),
        },
      };
    }
    case "Stake": {
      assertNearValidatorPublicKey(action.publicKey);
      return {
        stake: {
          stake: toNearAmount(action.stake),
          publicKey: mapPublicKey(action.publicKey),
        },
      };
    }
    case "AddKey": {
      const permission = action.accessKey.permission;
      if (
        permission !== "FullAccess" &&
        permission !== "FunctionCall" &&
        (permission == null || typeof permission !== "object")
      ) {
        throw new Error(`Unsupported access-key permission: ${String(permission)}`);
      }
      const functionCall =
        typeof permission === "object" ? permission : action.accessKey;
      if (
        permission !== "FullAccess" &&
        typeof functionCall.receiverId !== "string"
      ) {
        throw new Error("Function-call access keys require a receiverId");
      }

      return {
        addKey: {
          publicKey: mapPublicKey(action.publicKey),
          accessKey: {
            nonce: BigInt(action.accessKey.nonce ?? 0),
            permission:
              permission === "FullAccess"
                ? { fullAccess: {} }
                : {
                  functionCall: {
                    allowance: functionCall.allowance != null
                      ? toNearAmount(functionCall.allowance)
                      : null,
                    receiverId: functionCall.receiverId,
                    methodNames: functionCall.methodNames ?? [],
                  },
                },
          },
        },
      };
    }
    case "DeleteKey": {
      return {
        deleteKey: {
          publicKey: mapPublicKey(action.publicKey),
        },
      };
    }
    case "DeleteAccount": {
      return {
        deleteAccount: {
          beneficiaryId: action.beneficiaryId,
        },
      };
    }
    case "SignedDelegate": {
      const delegate = action.delegateAction;
      if (action.publicKey && action.publicKey !== delegate.publicKey) {
        throw new Error(
          "SignedDelegate publicKey must match delegateAction.publicKey",
        );
      }
      return {
        signedDelegate: {
          delegateAction: {
            senderId: delegate.senderId,
            receiverId: delegate.receiverId,
            actions: delegate.actions.map(mapAction),
            nonce: BigInt(delegate.nonce),
            maxBlockHeight: BigInt(delegate.maxBlockHeight),
            publicKey: mapPublicKey(delegate.publicKey),
          },
          signature: mapSignature(action.signature, delegate.publicKey),
        },
      };
    }
    default: {
      throw new Error(
        "Not implemented action: " + (action as { type?: unknown }).type,
      );
    }
  }
}

export const SCHEMA = getBorshSchema();
