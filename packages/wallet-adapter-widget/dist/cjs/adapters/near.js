/* ⋈ 🏃🏻💨 FastNEAR Wallet Adapter Widget - https://github.com/fastnear */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/adapters/near.ts
var near_exports = {};
__export(near_exports, {
  createNearAdapter: () => createNearAdapter
});
module.exports = __toCommonJS(near_exports);

// src/utils/transaction.ts
var import_borsh = require("borsh");

// src/utils/utils.ts
var import_base58_js = require("base58-js");
var import_base64_js = require("base64-js");
var keyFromString = (key) => (0, import_base58_js.base58_to_binary)(
  key.includes(":") ? (() => {
    const [curve, keyPart] = key.split(":");
    if (curve !== "ed25519") {
      throw new Error(`Unsupported curve: ${curve}`);
    }
    return keyPart;
  })() : key
);
function fromBase64(base64) {
  return (0, import_base64_js.toByteArray)(base64);
}

// src/utils/transaction.ts
function mapTransaction(jsonTransaction) {
  return {
    signerId: jsonTransaction.signerId,
    publicKey: {
      ed25519Key: {
        data: keyFromString(jsonTransaction.publicKey)
      }
    },
    nonce: BigInt(jsonTransaction.nonce),
    receiverId: jsonTransaction.receiverId,
    blockHash: (0, import_base58_js.base58_to_binary)(jsonTransaction.blockHash),
    actions: jsonTransaction.actions.map(mapActionForBorsh)
  };
}
function serializeTransaction(jsonTransaction) {
  const transaction = mapTransaction(jsonTransaction);
  return (0, import_borsh.serialize)(SCHEMA.Transaction, transaction);
}
function mapActionForBorsh(action) {
  switch (action.type) {
    case "CreateAccount": {
      return {
        createAccount: {}
      };
    }
    case "DeployContract": {
      return {
        deployContract: {
          code: fromBase64(action.codeBase64)
        }
      };
    }
    case "FunctionCall": {
      return {
        functionCall: {
          methodName: action.methodName,
          args: action.argsBase64 ? fromBase64(action.argsBase64) : Buffer.from(JSON.stringify(action.args)),
          gas: BigInt(action.gas),
          deposit: BigInt(action.deposit)
        }
      };
    }
    case "Transfer": {
      return {
        transfer: {
          deposit: BigInt(action.deposit)
        }
      };
    }
    case "Stake": {
      return {
        stake: {
          stake: BigInt(action.stake),
          publicKey: {
            ed25519Key: {
              data: keyFromString(action.publicKey)
            }
          }
        }
      };
    }
    case "AddKey": {
      return {
        addKey: {
          publicKey: {
            ed25519Key: {
              data: keyFromString(action.publicKey)
            }
          },
          accessKey: {
            nonce: BigInt(action.accessKey.nonce),
            permission: action.accessKey.permission === "FullAccess" ? { fullAccess: {} } : {
              functionCall: {
                allowance: action.accessKey.allowance ? BigInt(action.accessKey.allowance) : null,
                receiverId: action.accessKey.receiverId,
                methodNames: action.accessKey.methodNames
              }
            }
          }
        }
      };
    }
    case "DeleteKey": {
      return {
        deleteKey: {
          publicKey: {
            ed25519Key: {
              data: keyFromString(action.publicKey)
            }
          }
        }
      };
    }
    case "DeleteAccount": {
      return {
        deleteAccount: {
          beneficiaryId: action.beneficiaryId
        }
      };
    }
    case "SignedDelegate": {
      return {
        signedDelegate: {
          delegateAction: mapActionForBorsh(action.delegateAction),
          signature: {
            ed25519Signature: (0, import_base58_js.base58_to_binary)(action.signature)
          }
        }
      };
    }
    default: {
      throw new Error("Not implemented action: " + action.type);
    }
  }
}
var SCHEMA = new class BorshSchema {
  Ed25519Signature = {
    struct: {
      data: { array: { type: "u8", len: 64 } }
    }
  };
  Secp256k1Signature = {
    struct: {
      data: { array: { type: "u8", len: 65 } }
    }
  };
  Signature = {
    enum: [
      { struct: { ed25519Signature: this.Ed25519Signature } },
      { struct: { secp256k1Signature: this.Secp256k1Signature } }
    ]
  };
  Ed25519Data = {
    struct: {
      data: { array: { type: "u8", len: 32 } }
    }
  };
  Secp256k1Data = {
    struct: {
      data: { array: { type: "u8", len: 64 } }
    }
  };
  PublicKey = {
    enum: [
      { struct: { ed25519Key: this.Ed25519Data } },
      { struct: { secp256k1Key: this.Secp256k1Data } }
    ]
  };
  FunctionCallPermission = {
    struct: {
      allowance: { option: "u128" },
      receiverId: "string",
      methodNames: { array: { type: "string" } }
    }
  };
  FullAccessPermission = {
    struct: {}
  };
  AccessKeyPermission = {
    enum: [
      { struct: { functionCall: this.FunctionCallPermission } },
      { struct: { fullAccess: this.FullAccessPermission } }
    ]
  };
  AccessKey = {
    struct: {
      nonce: "u64",
      permission: this.AccessKeyPermission
    }
  };
  CreateAccount = {
    struct: {}
  };
  DeployContract = {
    struct: {
      code: { array: { type: "u8" } }
    }
  };
  FunctionCall = {
    struct: {
      methodName: "string",
      args: { array: { type: "u8" } },
      gas: "u64",
      deposit: "u128"
    }
  };
  Transfer = {
    struct: {
      deposit: "u128"
    }
  };
  Stake = {
    struct: {
      stake: "u128",
      publicKey: this.PublicKey
    }
  };
  AddKey = {
    struct: {
      publicKey: this.PublicKey,
      accessKey: this.AccessKey
    }
  };
  DeleteKey = {
    struct: {
      publicKey: this.PublicKey
    }
  };
  DeleteAccount = {
    struct: {
      beneficiaryId: "string"
    }
  };
  ClassicAction = {
    enum: [
      { struct: { createAccount: this.CreateAccount } },
      { struct: { deployContract: this.DeployContract } },
      { struct: { functionCall: this.FunctionCall } },
      { struct: { transfer: this.Transfer } },
      { struct: { stake: this.Stake } },
      { struct: { addKey: this.AddKey } },
      { struct: { deleteKey: this.DeleteKey } },
      { struct: { deleteAccount: this.DeleteAccount } }
    ]
  };
  DelegateAction = {
    struct: {
      senderId: "string",
      receiverId: "string",
      actions: { array: { type: this.ClassicAction } },
      nonce: "u64",
      maxBlockHeight: "u64",
      publicKey: this.PublicKey
    }
  };
  SignedDelegate = {
    struct: {
      delegateAction: this.DelegateAction,
      signature: this.Signature
    }
  };
  Action = {
    enum: [
      { struct: { createAccount: this.CreateAccount } },
      { struct: { deployContract: this.DeployContract } },
      { struct: { functionCall: this.FunctionCall } },
      { struct: { transfer: this.Transfer } },
      { struct: { stake: this.Stake } },
      { struct: { addKey: this.AddKey } },
      { struct: { deleteKey: this.DeleteKey } },
      { struct: { deleteAccount: this.DeleteAccount } },
      { struct: { signedDelegate: this.SignedDelegate } }
    ]
  };
  Transaction = {
    struct: {
      signerId: "string",
      publicKey: this.PublicKey,
      nonce: "u64",
      receiverId: "string",
      blockHash: { array: { type: "u8", len: 32 } },
      actions: { array: { type: this.Action } }
    }
  };
  SignedTransaction = {
    struct: {
      transaction: this.Transaction,
      signature: this.Signature
    }
  };
}();

// src/adapters/near.ts
var walletUrl = (networkId) => networkId === "testnet" ? "https://testnet.mynearwallet.com" : "https://app.mynearwallet.com";
function createNearAdapter() {
  return {
    async signIn({ networkId, contractId, callbackUrl, publicKey }) {
      const url = new URL(`${walletUrl(networkId)}/login`);
      url.searchParams.set("contract_id", contractId);
      url.searchParams.set("public_key", publicKey);
      url.searchParams.set("success_url", callbackUrl);
      url.searchParams.set("failure_url", callbackUrl);
      return {
        url: url.toString(),
        state: {
          publicKey,
          networkId
        }
      };
    },
    async sendTransactions({ state, transactions, callbackUrl }) {
      console.log(
        "sendTransactions",
        JSON.stringify({ state, transactions, callbackUrl })
      );
      if (!state?.accountId) {
        throw new Error("Not signed in");
      }
      const url = new URL("sign", walletUrl(state?.networkId));
      transactions = transactions.map(({ signerId, receiverId, actions }) => {
        if (signerId && signerId !== state.accountId) {
          throw new Error("Invalid signer");
        }
        return {
          signerId: state.accountId,
          receiverId,
          actions,
          publicKey: `ed25519:${(0, import_base58_js.binary_to_base58)(new Uint8Array(32))}`,
          nonce: 0,
          blockHash: (0, import_base58_js.binary_to_base58)(new Uint8Array(32))
        };
      });
      url.searchParams.set(
        "transactions",
        transactions.map((transaction) => serializeTransaction(transaction)).map((serialized) => Buffer.from(serialized).toString("base64")).join(",")
      );
      url.searchParams.set("callbackUrl", callbackUrl);
      return { url: url.toString() };
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createNearAdapter
});
//# sourceMappingURL=near.js.map
