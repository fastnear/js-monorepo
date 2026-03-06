import { serialize as borshSerialize, deserialize as borshDeserialize, type Schema } from "@fastnear/borsh";
import { curveFromKey, keyFromString } from "./crypto.js";
import {base64ToBytes, fromBase58, fromBase64, toBase64} from "./misc.js";
import { getBorshSchema } from "@fastnear/borsh-schema";

export interface PlainTransaction {
  signerId: string;
  publicKey: string;
  nonce: string | bigint | number;
  receiverId: string;
  blockHash: string;
  actions: Array<any>;
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

function mapPublicKey(keyString: string) {
  const curve = curveFromKey(keyString);
  const data = keyFromString(keyString);
  return curve === "secp256k1"
    ? { secp256k1Key: { data } }
    : { ed25519Key: { data } };
}

function mapSignature(sigBase58: string, signerKeyString: string) {
  const curve = curveFromKey(signerKeyString);
  const data = fromBase58(sigBase58);
  return curve === "secp256k1"
    ? { secp256k1Signature: { data } }
    : { ed25519Signature: { data } };
}

export function mapTransaction(jsonTransaction: PlainTransaction) {
  return {
    signerId: jsonTransaction.signerId,
    publicKey: mapPublicKey(jsonTransaction.publicKey),
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

export function serializeSignedTransaction(jsonTransaction: PlainTransaction, signature) {
  console.log("fastnear: Serializing Signed Transaction", jsonTransaction);
  console.log('fastnear: signature', signature)
  console.log('fastnear: signature length', fromBase58(signature).length)

  const mappedSignedTx = mapTransaction(jsonTransaction)
  console.log('fastnear: mapped (for borsh schema) signed transaction', mappedSignedTx)

  const plainSignedTransaction: PlainSignedTransaction = {
    transaction: mappedSignedTx,
    signature: mapSignature(signature, jsonTransaction.publicKey),
  };

  const borshSignedTx = borshSerialize(SCHEMA.SignedTransaction, plainSignedTransaction);
  console.log('fastnear: borsh-serialized signed transaction:', borshSignedTx);

  return borshSignedTx;
}

export function mapAction(action: any): object {
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
          args: (action.argsBase64 !== null && action.argsBase64 !== undefined) ?
            base64ToBytes(action.argsBase64) :
            (new TextEncoder().encode(JSON.stringify(action.args))),
          gas: BigInt(action.gas ?? "300000000000000"),
          deposit: BigInt(action.deposit ?? "0"),
        },
      };
    }
    case "Transfer": {
      return {
        transfer: {
          deposit: BigInt(action.deposit),
        },
      };
    }
    case "Stake": {
      return {
        stake: {
          stake: BigInt(action.stake),
          publicKey: mapPublicKey(action.publicKey),
        },
      };
    }
    case "AddKey": {
      return {
        addKey: {
          publicKey: mapPublicKey(action.publicKey),
          accessKey: {
            nonce: BigInt(action.accessKey.nonce),
            permission:
              action.accessKey.permission === "FullAccess"
                ? { fullAccess: {} }
                : {
                  functionCall: {
                    allowance: action.accessKey.allowance
                      ? BigInt(action.accessKey.allowance)
                      : null,
                    receiverId: action.accessKey.receiverId,
                    methodNames: action.accessKey.methodNames,
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
      return {
        signedDelegate: {
          delegateAction: mapAction(action.delegateAction),
          signature: mapSignature(action.signature, action.publicKey),
        },
      };
    }
    default: {
      throw new Error("Not implemented action: " + action.type);
    }
  }
}

export const SCHEMA = getBorshSchema();
