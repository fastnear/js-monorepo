import { serialize as borshSerialize, deserialize as borshDeserialize, Schema } from "borsh";
import { keyFromString } from "./crypto.js";
import {base64ToBytes, fromBase58, fromBase64, toBase64} from "./misc.js";
import { getBorshSchema } from "@fastnear/borsh-schema";
import type { Action, AddKeyAction, CreateAccountAction, DeleteAccountAction, DeleteKeyAction, DeployContractAction, FunctionCallAction, StakeAction, TransferAction, SignedDelegateAction } from "@fastnear/api";

export interface PlainTransaction {
  signerId: string;
  publicKey: string;
  nonce: string | bigint | number;
  receiverId: string;
  blockHash: string;
  actions: Array<Action>;
}

export interface PlainSignedTransaction {
  transaction: object;
  signature: object;
}

// Function to return a JSON-ready version of the transaction
export const txToJson = (tx: PlainTransaction): Record<string, any> => {
  return JSON.parse(JSON.stringify(tx, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));
};

// dude let's make this better. head just couldn't find a good name
export const txToJsonStringified = (tx: PlainTransaction): string => {
  return JSON.stringify(txToJson(tx));
}

export function mapTransaction(jsonTransaction: PlainTransaction) {
  return {
    signerId: jsonTransaction.signerId,
    publicKey: {
      ed25519Key: {
        data: keyFromString(jsonTransaction.publicKey)
      }
    },
    nonce: BigInt(jsonTransaction.nonce),
    receiverId: jsonTransaction.receiverId,
    blockHash: fromBase58(jsonTransaction.blockHash),
    actions: jsonTransaction.actions.map(mapAction)
  };
}

export function serializeTransaction(jsonTransaction: PlainTransaction) {
  console.log("fastnear: serializing transaction");

  const transaction = mapTransaction(jsonTransaction);
  console.log("fastnear: mapped transaction for borsh:", transaction);

  return borshSerialize(SCHEMA.Transaction, transaction);
}

export function serializeSignedTransaction(jsonTransaction: PlainTransaction, signature: string) {
  console.log("fastnear: Serializing Signed Transaction", jsonTransaction);
  console.log('fastnear: signature', signature)
  console.log('fastnear: signature length', fromBase58(signature).length)

  const mappedSignedTx = mapTransaction(jsonTransaction)
  console.log('fastnear: mapped (for borsh schema) signed transaction', mappedSignedTx)

  const plainSignedTransaction: PlainSignedTransaction = {
    transaction: mappedSignedTx,
    signature: {
      ed25519Signature: {
        data: fromBase58(signature),
      },
    },
  };

  const borshSignedTx = borshSerialize(SCHEMA.SignedTransaction, plainSignedTransaction, true);
  console.log('fastnear: borsh-serialized signed transaction:', borshSignedTx);

  return borshSignedTx;
}

export function mapAction(action: Action): object {
  switch (action.type) {
    case "CreateAccount": {
      return {
        createAccount: {},
      };
    }
    case "DeployContract": {
      const deployContractAction = action as DeployContractAction;
      return {
        deployContract: {
          code: deployContractAction.params.code,
        },
      };
    }
    case "FunctionCall": {
      const functionCallAction = action as FunctionCallAction;
      return {
        functionCall: {
          methodName: functionCallAction.params.methodName,
          args: new TextEncoder().encode(JSON.stringify(functionCallAction.params.args)),
          gas: BigInt(functionCallAction.params.gas ?? "300000000000000"),
          deposit: BigInt(functionCallAction.params.deposit ?? "0"),
        },
      };
    }
    case "Transfer": {
      const transferAction = action as TransferAction;
      return {
        transfer: {
          deposit: BigInt(transferAction.params.deposit),
        },
      };
    }
    case "Stake": {
      const stakeAction = action as StakeAction;
      return {
        stake: {
          stake: BigInt(stakeAction.params.stake),
          publicKey: {
            ed25519Key: {
              data: keyFromString(stakeAction.params.publicKey),
            },
          },
        },
      };
    }
    case "AddKey": {
      const addKeyAction = action as AddKeyAction;
      const permission = addKeyAction.params.accessKey.permission;
      let mappedPermission;
      if (permission === "FullAccess") {
        mappedPermission = { fullAccess: {} };
      } else {
        mappedPermission = {
          functionCall: {
            allowance: permission.allowance
              ? BigInt(permission.allowance)
              : null,
            receiverId: permission.receiverId,
            methodNames: permission.methodNames || [],
          },
        };
      }
      return {
        addKey: {
          publicKey: {
            ed25519Key: {
              data: keyFromString(addKeyAction.params.publicKey),
            },
          },
          accessKey: {
            nonce: BigInt(addKeyAction.params.accessKey.nonce || 0),
            permission: mappedPermission,
          },
        },
      };
    }
    case "DeleteKey": {
      const deleteKeyAction = action as DeleteKeyAction;
      return {
        deleteKey: {
          publicKey: {
            ed25519Key: {
              data: keyFromString(deleteKeyAction.params.publicKey),
            },
          },
        },
      };
    }
    case "DeleteAccount": {
      const deleteAccountAction = action as DeleteAccountAction;
      return {
        deleteAccount: {
          beneficiaryId: deleteAccountAction.params.beneficiaryId,
        },
      };
    }
    case "SignedDelegate": {
      const signedDelegateAction = action as SignedDelegateAction;
      return {
        signedDelegate: {
          delegateAction: mapAction(signedDelegateAction.params.delegateAction), // Recursive call
          signature: {
            ed25519Signature: {
              data: fromBase58(signedDelegateAction.params.signature)
            }
          },
        },
      };
    }
    default: {
      const _exhaustiveCheck: never = action;
      throw new Error(`Unhandled action type: ${(_exhaustiveCheck as Action).type}`);
    }
  }
}

export const SCHEMA = getBorshSchema();
