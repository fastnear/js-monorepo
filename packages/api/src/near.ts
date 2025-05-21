import {
  bytesToBase64,
  canSignWithLAK,
  fromBase64,
  lsGet,
  lsSet,
  parseJsonFromBytes,
  PlainTransaction,
  privateKeyFromRandom,
  serializeSignedTransaction,
  serializeTransaction,
  signHash,
  toBase58,
  toBase64,
  tryParseJson
} from "@fastnear/utils";
import Big from "big.js";

import {
  _adapter,
  _state,
  DEFAULT_NETWORK_ID,
  getTxHistory,
  NETWORKS,
  update,
  updateTxHistory,
} from "./state.js";

import {
  getConfig,
  resetTxHistory,
  setConfig,
} from "./state.js";

import * as reExportAllUtils from "@fastnear/utils";
import { sha256 } from "@noble/hashes/sha2";
import * as stateExports from "./state.js";
import { type EventsType } from "./state.js";

Big.DP = 27;
export const MaxBlockDelayMs = 1000 * 60 * 60 * 6; // 6 hours

export interface AccessKeyWithError {
  result: {
    nonce: number;
    permission?: any;
    error?: string;
  }
}

export interface WalletTxResult {
  url?: string;
  outcomes?: Array<{ transaction: { hash: string } }>;
  rejected?: boolean;
  error?: string;
}

export interface BlockView {
  result: {
    header: {
      hash: string;
      timestamp_nanosec: string;
    }
  }
}

// The structure it's saved to in storage
export interface LastKnownBlock {
  header: {
    hash: string;
    timestamp_nanosec: string;
  }
}

export function withBlockId(params: Record<string, any>, blockId?: string) {
  if (blockId === "final" || blockId === "optimistic") {
    return { ...params, finality: blockId };
  }
  return blockId ? { ...params, block_id: blockId } : { ...params, finality: "optimistic" };
}

export async function sendRpc(method: string, params: Record<string, any> | any[]) {
  const config = getConfig();
  if (!config?.nodeUrl) {
    throw new Error("fastnear: getConfig() returned invalid config: missing nodeUrl.");
  }
  const response = await fetch(config.nodeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `fastnear-${Date.now()}`,
      method,
      params,
    }),
  });
  const result = await response.json();
  if (result.error) {
    throw new Error(JSON.stringify(result.error));
  }
  return result;
}

export function afterTxSent(txId: string) {
  const txHistory = getTxHistory();
  sendRpc("tx", {
    tx_hash: txHistory[txId]?.txHash,
    sender_account_id: txHistory[txId]?.tx?.signerId,
    wait_until: "EXECUTED_OPTIMISTIC",
  })
    .then(result => {
      const successValue = result?.result?.status?.SuccessValue;
      updateTxHistory({
        txId,
        status: "Executed",
        result,
        successValue: successValue ? tryParseJson(fromBase64(successValue)) : undefined,
        finalState: true,
      });
    })
    .catch((error) => {
      updateTxHistory({
        txId,
        status: "ErrorAfterIncluded",
        error: tryParseJson(error.message) ?? error.message,
        finalState: true,
      });
    });
}

export async function sendTxToRpc(signedTxBase64: string, waitUntil: string | undefined, txId: string) {
  // default to "INCLUDED"
  // see options: https://docs.near.org/api/rpc/transactions#tx-status-result
  waitUntil = waitUntil || "INCLUDED";

  try {
    const sendTxRes = await sendRpc("send_tx", {
      signed_tx_base64: signedTxBase64,
      wait_until: waitUntil,
    });

    updateTxHistory({ txId, status: "Included", finalState: false });
    afterTxSent(txId);

    return sendTxRes;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    updateTxHistory({
      txId,
      status: "Error",
      error: tryParseJson(errorMessage) ?? errorMessage,
      finalState: false,
    });
    throw new Error(errorMessage);
  }
}

export interface AccessKeyView {
  nonce: number;
  permission: any;
}

/**
 * Generates a mock transaction ID.
 *
 * This function creates a pseudo-unique transaction ID for testing or
 * non-production use. It combines the current timestamp with a
 * random component for uniqueness.
 *
 * **Note:** This is not cryptographically secure and should not be used
 * for actual transaction processing.
 *
 * @returns {string} A mock transaction ID in the format `tx-{timestamp}-{random}`
 */
export function generateTxId(): string {
  const randomPart = crypto.getRandomValues(new Uint32Array(2)).join("");
  return `tx-${Date.now()}-${parseInt(randomPart, 10).toString(36)}`;
}

export const accountId = () => _state.accountId;
export const publicKey = () => _state.publicKey;

export const config = (newConfig?: Record<string, any>) => {
  const current = getConfig();
  if (newConfig) {
    if (newConfig.networkId && current.networkId !== newConfig.networkId) {
      setConfig(newConfig.networkId);
      update({ accountId: null, privateKey: null, lastWalletId: null });
      lsSet("block", null);
      resetTxHistory();
    }
    setConfig({ ...getConfig(), ...newConfig });
  }
  return getConfig();
};

export const authStatus = (): string | Record<string, any> => {
  if (!_state.accountId) {
    return "SignedOut";
  }
  return "SignedIn";
};

// this is an intentional stub
// and it's probably partially done, to help ease future features
// for now we'll assume each web end user has one keypair in storage
// for every contract they wish to interact with
// later, it may be prudent to hold multiple, but until then this function
// just returns the access key as if it were among others in the array.
// we're pretending like we really thought about which access key we're returning
// based on the opts argument. this allows us to fill this logic in later.
export const getPublicKeyForContract = (opts?: any) => {
  return publicKey();
}

// returns details on the selected:
// network, wallet, and explorer details as well as
// sending account, contract, and selected public key
export const selected = () => {
  const network = getConfig().networkId;
  const nodeUrl = getConfig().nodeUrl;
  const walletUrl = getConfig().walletUrl;
  const helperUrl = getConfig().helperUrl;
  const explorerUrl = getConfig().explorerUrl;

  const account = accountId();
  const contract = _state.accessKeyContractId;
  const publicKey = getPublicKeyForContract();

  return {
    network,
    nodeUrl,
    walletUrl,
    helperUrl,
    explorerUrl,
    account,
    contract,
    publicKey
  }
}

export const requestSignIn = async ({ contractId }: { contractId: string }) => {
  const privateKey = privateKeyFromRandom();
  update({ accessKeyContractId: contractId, accountId: null, privateKey });

  const result = await _adapter.signIn({
    networkId: getConfig().networkId,
    contractId,
  });

  if (result.error) {
    throw new Error(`Wallet error: ${result.error}`);
  }
  // If signIn succeeded, result contains accountId and accounts
  if (result.accountId) {
    // Update local state ONLY with the accountId. Let intear-wallet manage keys.
    update({ accountId: result.accountId, privateKey: null, publicKey: null, accessKeyContractId: contractId });
  } else {
    // This case might indicate an issue if signIn resolves without accountId or error
    console.warn("@fastnear: signIn resolved without accountId or error.");
    update({ accountId: null, privateKey: null, publicKey: null, accessKeyContractId: null }); // Ensure signed out state
  }
};

export const view = async ({
  contractId,
  methodName,
  args,
  argsBase64,
  blockId,
}: {
  contractId: string;
  methodName: string;
  args?: any;
  argsBase64?: string;
  blockId?: string;
}) => {
  const encodedArgs = argsBase64 || (args ? toBase64(JSON.stringify(args)) : "");
  const queryResult = await sendRpc(
    "query",
    withBlockId(
      {
        request_type: "call_function",
        account_id: contractId,
        method_name: methodName,
        args_base64: encodedArgs,
      },
      blockId
    )
  );

  return parseJsonFromBytes(queryResult.result.result);
};

export const queryAccount = async ({
  accountId,
  blockId,
}: {
  accountId: string;
  blockId?: string;
}) => {
  return sendRpc(
    "query",
    withBlockId({ request_type: "view_account", account_id: accountId }, blockId)
  );
};

export const queryBlock = async ({ blockId }: { blockId?: string }): Promise<BlockView> => {
  return sendRpc("block", withBlockId({}, blockId));
};

export const queryAccessKey = async ({
  accountId,
  publicKey,
  blockId,
}: {
  accountId: string;
  publicKey: string;
  blockId?: string;
}): Promise<AccessKeyWithError> => {
  return sendRpc(
    "query",
    withBlockId(
      { request_type: "view_access_key", account_id: accountId, public_key: publicKey },
      blockId
    )
  );
};

export const queryTx = async ({ txHash, accountId }: { txHash: string; accountId: string }) => {
  return sendRpc("tx", [txHash, accountId]);
};

export const localTxHistory = () => {
  return getTxHistory();
};

export const signOut = () => {
  update({ accountId: null, privateKey: null, contractId: null });
  setConfig(NETWORKS[DEFAULT_NETWORK_ID]);
};

/**
 * Interface for signature result from wallet
 */
export interface SignatureResult {
  accountId: string;
  publicKey: string;
  signature: string;
}

/**
 * Sign a message using the connected wallet
 * 
 * @param message - The message to sign
 * @param recipient - The recipient account ID
 * @param nonce - Optional nonce for the message (defaults to random bytes)
 * @param callbackUrl - Optional callback URL
 * @param state - Optional state to include with the message
 * @returns Promise resolving to the signature result
 */
export const signMessage = async ({
  message,
  recipient,
  nonce,
  callbackUrl,
  state,
}: {
  message: string;
  recipient: string;
  nonce?: Uint8Array;
  callbackUrl?: string;
  state?: string;
}): Promise<SignatureResult> => {
  const signerId = _state.accountId;
  if (!signerId) throw new Error("Must sign in");

  // Generate a random nonce if not provided
  // could use near-sign-verify
  const messageNonce = nonce || crypto.getRandomValues(new Uint8Array(32));

  try {

    const result = await _adapter.signMessage({
      message,
      recipient,
      // @ts-ignore - We know the adapter expects Buffer but we're using Uint8Array
      nonce: messageNonce,
      callbackUrl,
      state,
    });

    return {
      accountId: result.accountId,
      publicKey: result.publicKey,
      signature: result.signature
    };
  } catch (err) {
    console.error('fastnear: error signing message using adapter:', err);
    throw err;
  }
};

export const sendTx = async ({
  receiverId,
  actions,
  waitUntil,
}: {
  receiverId: string;
  actions: any[];
  waitUntil?: string;
}) => {
  const signerId = _state.accountId;
  if (!signerId) throw new Error("Must sign in");

  const publicKey = _state.publicKey ?? "";
  const privKey = _state.privateKey;
  // this generates a mock transaction ID so we can keep track of each tx
  const txId = generateTxId();

  if (!privKey || receiverId !== _state.accessKeyContractId || !canSignWithLAK(actions)) {
    const jsonTx = { signerId, receiverId, actions };
    updateTxHistory({ status: "Pending", txId, tx: jsonTx, finalState: false });

    const url = new URL(typeof window !== "undefined" ? window.location.href : "");
    url.searchParams.set("txIds", txId);

    // preserve existing url params
    const existingParams = new URLSearchParams(window.location.search);
    existingParams.forEach((value, key) => {
      if (!url.searchParams.has(key)) {
        url.searchParams.set(key, value);
      }
    });

    // we're wanting to preserve URL params that we send in
    // but make sure we're not feeding back error params
    // from a previous failure

    url.searchParams.delete("errorCode");
    url.searchParams.delete("errorMessage");

    try {
      const result: WalletTxResult = await _adapter.sendTransactions({
        transactions: [jsonTx],
      });

      // Resolves with outcomes or rejection
      if (result.outcomes?.length) {
        result.outcomes.forEach((r) =>
          updateTxHistory({
            txId,
            status: "Executed",
            result: r,
            txHash: r.transaction.hash,
            finalState: true,
          })
        );
      } else if (result.rejected) {
        updateTxHistory({ txId, status: "RejectedByUser", finalState: true });
      } else if (result.error) {
        updateTxHistory({
          txId,
          status: "Error",
          error: tryParseJson(result.error),
          finalState: true,
        });
      }

      return result;
    } catch (err) {
      console.error('fastnear: error sending tx using adapter:', err)
      updateTxHistory({
        txId,
        status: "Error",
        error: tryParseJson((err as Error).message),
        finalState: true,
      });

      return Promise.reject(err);
    }
  }

  let nonce = lsGet("nonce") as number | null;
  if (nonce == null) {
    const accessKey = await queryAccessKey({ accountId: signerId, publicKey: publicKey });
    if (accessKey.result.error) {
      throw new Error(`Access key error: ${accessKey.result.error} when attempting to get nonce for ${signerId} for public key ${publicKey}`);
    }
    nonce = accessKey.result.nonce;
    lsSet("nonce", nonce);
  }

  let lastKnownBlock = lsGet("block") as LastKnownBlock | null;
  if (
    !lastKnownBlock ||
    parseFloat(lastKnownBlock.header.timestamp_nanosec) / 1e6 + MaxBlockDelayMs < Date.now()
  ) {
    const latestBlock = await queryBlock({ blockId: "final" });
    lastKnownBlock = {
      header: {
        hash: latestBlock.result.header.hash,
        timestamp_nanosec: latestBlock.result.header.timestamp_nanosec,
      },
    };
    lsSet("block", lastKnownBlock);
  }

  nonce += 1;
  lsSet("nonce", nonce);

  const blockHash = lastKnownBlock.header.hash;

  const plainTransactionObj: PlainTransaction = {
    signerId,
    publicKey,
    nonce,
    receiverId,
    blockHash,
    actions,
  };

  const txBytes = serializeTransaction(plainTransactionObj);
  const txHashBytes = sha256(txBytes);
  const txHash58 = toBase58(txHashBytes);

  const signatureBase58 = signHash(txHashBytes, privKey, { returnBase58: true });
  const signedTransactionBytes = serializeSignedTransaction(plainTransactionObj, signatureBase58);
  const signedTxBase64 = bytesToBase64(signedTransactionBytes);

  updateTxHistory({
    status: "Pending",
    txId,
    tx: plainTransactionObj,
    signature: signatureBase58,
    signedTxBase64,
    txHash: txHash58,
    finalState: false,
  });

  try {
    return await sendTxToRpc(signedTxBase64, waitUntil, txId);
  } catch (error) {
    console.error("Error Sending Transaction:", error, plainTransactionObj, signedTxBase64);
  }
};

// exports
export const exp = {
  utils: {}, // we will map this in a moment, giving keys, for IDE hints
  borsh: reExportAllUtils.exp.borsh,
  borshSchema: reExportAllUtils.exp.borshSchema.getBorshSchema(),
};

for (const key in reExportAllUtils) {
  exp.utils[key] = reExportAllUtils[key];
}

// devx
export const utils = exp.utils;

export const state = {}

for (const key in stateExports) {
  state[key] = stateExports[key];
}

// devx

export const event: EventsType = state['events'];
delete state['events'];

// Wallet redirect handling
try {
  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    const accId = url.searchParams.get("account_id");
    const pubKey = url.searchParams.get("public_key");
    const errCode = url.searchParams.get("errorCode");
    const errMsg = url.searchParams.get("errorMessage");
    const decodedErrMsg = errMsg ? decodeURIComponent(errMsg) : null;

    const txHashes = url.searchParams.get("transactionHashes");
    const txIds = url.searchParams.get("txIds");

    if (errCode || errMsg) {
      console.warn(new Error(`Wallet raises:\ncode: ${errCode}\nmessage: ${decodedErrMsg}`));
    }

    if (accId && pubKey) {
      if (pubKey === _state.publicKey) {
        update({ accountId: accId });
      } else {
        // it's possible the end user has a URL param that's old. we'll remove the public_key param
        // if logged out, no need to throw warning
        if (authStatus() === "SignedIn") {
          console.warn("Public key mismatch from wallet redirect", pubKey, _state.publicKey);
        }
        url.searchParams.delete("public_key");
      }
    }

    if (txHashes || txIds) {
      const hashArr = txHashes ? txHashes.split(",") : [];
      const idArr = txIds ? txIds.split(",") : [];
      if (idArr.length > hashArr.length) {
        idArr.forEach((id) => {
          updateTxHistory({ txId: id, status: "RejectedByUser", finalState: true });
        });
      } else if (idArr.length === hashArr.length) {
        idArr.forEach((id, i) => {
          updateTxHistory({
            txId: id,
            status: "PendingGotTxHash",
            txHash: hashArr[i],
            finalState: false,
          });
          afterTxSent(id);
        });
      } else {
        console.error(new Error("Transaction hash mismatch from wallet redirect"), idArr, hashArr);
      }
    }

    // we can consider removing these, but want to be careful because
    // it can be helpful for a dev to have a URL they can debug with
    // we won't want to remove information

    // pretty sure txIds can go, especially if you can tell it's been more than 5 minutes or something
    // public_key sometimes confuses it, so this might only be needed when adding a new access key
    // and perhaps once we've confirmed that the transaction hashes are getting saved to storage
    // (not sure about that section of code) then we can get rid of the transactionHashes, too

    url.searchParams.delete("txIds");
    if (authStatus() === "SignedOut") {
      url.searchParams.delete("errorCode");
      url.searchParams.delete("errorMessage");
    }
    // ^ we've decided these ones make sense to keep

    // I'd like to keep this for posterity. for a bit.
    // url.searchParams.delete("account_id");
    // url.searchParams.delete("public_key");

    // url.searchParams.delete("all_keys");
    // url.searchParams.delete("transactionHashes");
    // window.history.replaceState({}, "", url.toString());
  }
} catch (e) {
  console.error("Error handling wallet redirect:", e);
}

// action helpers
export const actions = {
  functionCall: ({
    methodName,
    gas,
    deposit,
    args,
    argsBase64,
  }: {
    methodName: string;
    gas?: string;
    deposit?: string;
    args?: Record<string, any>;
    argsBase64?: string;
  }) => ({
    type: "FunctionCall",
    methodName,
    args,
    argsBase64,
    gas,
    deposit,
  }),

  transfer: (yoctoAmount: string) => ({
    type: "Transfer",
    deposit: yoctoAmount,
  }),

  stakeNEAR: ({ amount, publicKey }: { amount: string; publicKey: string }) => ({
    type: "Stake",
    stake: amount,
    publicKey,
  }),

  addFullAccessKey: ({ publicKey }: { publicKey: string }) => ({
    type: "AddKey",
    publicKey: publicKey,
    accessKey: { permission: "FullAccess" },
  }),

  addLimitedAccessKey: ({
    publicKey,
    allowance,
    accountId,
    methodNames,
  }: {
    publicKey: string;
    allowance: string;
    accountId: string;
    methodNames: string[];
  }) => ({
    type: "AddKey",
    publicKey: publicKey,
    accessKey: {
      permission: "FunctionCall",
      allowance,
      receiverId: accountId,
      methodNames,
    },
  }),

  deleteKey: ({ publicKey }: { publicKey: string }) => ({
    type: "DeleteKey",
    publicKey,
  }),

  deleteAccount: ({ beneficiaryId }: { beneficiaryId: string }) => ({
    type: "DeleteAccount",
    beneficiaryId,
  }),

  createAccount: () => ({
    type: "CreateAccount",
  }),

  deployContract: ({ codeBase64 }: { codeBase64: string }) => ({
    type: "DeployContract",
    codeBase64,
  }),
};
