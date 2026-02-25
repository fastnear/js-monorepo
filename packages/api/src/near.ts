import Big from "big.js";
import {
  lsSet,
  lsGet,
  tryParseJson,
  fromBase64,
  toBase64,
  canSignWithLAK,
  toBase58,
  parseJsonFromBytes,
  signHash,
  publicKeyFromPrivate,
  serializeTransaction,
  serializeSignedTransaction, bytesToBase64, PlainTransaction,
} from "@fastnear/utils";

import type { NEP413Message } from "@fastnear/utils";

import {
  _state,
  DEFAULT_NETWORK_ID,
  NETWORKS,
  getWalletProvider,
  setWalletProvider,
  getTxHistory,
  update,
  updateTxHistory,
} from "./state.js";

import type { WalletProvider } from "./state.js";

import {
  getConfig,
  setConfig,
  resetTxHistory,
} from "./state.js";

import { sha256 } from "@noble/hashes/sha2";
import * as reExportAllUtils from "@fastnear/utils";
import * as stateExports from "./state.js";

Big.DP = 27;
export const MaxBlockDelayMs = 1000 * 60 * 60 * 6; // 6 hours

export interface AccessKeyWithError {
  result: {
    nonce: number;
    permission?: any;
    error?: string;
  }
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
    .then( result => {
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

export const getPublicKeyForContract = (opts?: any) => {
  return publicKey();
}

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

export const requestSignIn = async ({
  contractId,
  excludedWallets,
  features,
}: {
  contractId?: string;
  excludedWallets?: string[];
  features?: Record<string, boolean>;
} = {}) => {
  const provider = getWalletProvider();
  if (!provider) {
    throw new Error("No wallet provider set. Call useWallet() first or load the @fastnear/wallet IIFE bundle.");
  }

  // Disconnect if already connected
  if (provider.isConnected()) {
    await provider.disconnect();
  }

  const result = await provider.connect({
    contractId,
    network: getConfig().networkId,
    excludedWallets,
    features,
  });

  if (!result) {
    // User rejected
    return;
  }

  update({ accountId: result.accountId });
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

export const signOut = async () => {
  const provider = getWalletProvider();
  if (provider?.isConnected()) {
    await provider.disconnect();
  }
  update({ accountId: null, privateKey: null, contractId: null });
  setConfig(NETWORKS[DEFAULT_NETWORK_ID]);
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

  const pubKey = _state.publicKey ?? "";
  const privKey = _state.privateKey;
  const txId = generateTxId();

  // If no local private key, or the receiver doesn't match the access key contract,
  // or the actions aren't signable with a limited access key, delegate to the wallet
  if (!privKey || receiverId !== _state.accessKeyContractId || !canSignWithLAK(actions)) {
    const jsonTx = { signerId, receiverId, actions };
    updateTxHistory({ status: "Pending", txId, tx: jsonTx, finalState: false });

    try {
      const provider = getWalletProvider();
      if (!provider?.isConnected()) {
        throw new Error("Must sign in");
      }

      const result = await provider.sendTransaction(jsonTx);

      if (!result) {
        // User rejected
        updateTxHistory({ txId, status: "RejectedByUser", finalState: true });
        return { rejected: true };
      }

      if (result.outcomes?.length) {
        result.outcomes.forEach((r: any) =>
          updateTxHistory({
            txId,
            status: "Executed",
            result: r,
            txHash: r.transaction?.hash,
            finalState: true,
          })
        );
      }

      return result;
    } catch (err) {
      console.error('fastnear: error sending tx using wallet provider:', err)
      updateTxHistory({
        txId,
        status: "Error",
        error: tryParseJson((err as Error).message),
        finalState: true,
      });

      return Promise.reject(err);
    }
  }

  // Local signing path (limited access key)
  let nonce = lsGet("nonce") as number | null;
  if (nonce == null) {
    const accessKey = await queryAccessKey({ accountId: signerId, publicKey: pubKey });
    if (accessKey.result.error) {
      throw new Error(`Access key error: ${accessKey.result.error} when attempting to get nonce for ${signerId} for public key ${pubKey}`);
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
    publicKey: pubKey,
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

/**
 * Signs a NEP-413 message using the connected wallet.
 */
export const signMessage = async (message: NEP413Message) => {
  const provider = getWalletProvider();
  if (!provider?.isConnected()) {
    throw new Error("Must sign in");
  }
  if (!provider.signMessage) {
    throw new Error("Connected wallet does not support signMessage");
  }
  return provider.signMessage(message);
};

/**
 * Set the wallet provider used by the API for signing and sending transactions.
 * Automatically called in IIFE builds when globalThis.nearWallet is present.
 */
export const useWallet = (provider: WalletProvider): void => {
  setWalletProvider(provider);
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

export const event = state['events'];
delete state['events'];

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

  stakeNEAR: ({amount, publicKey}: { amount: string; publicKey: string }) => ({
    type: "Stake",
    stake: amount,
    publicKey,
  }),

  addFullAccessKey: ({publicKey}: { publicKey: string }) => ({
    type: "AddKey",
    publicKey: publicKey,
    accessKey: {permission: "FullAccess"},
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

  deleteKey: ({publicKey}: { publicKey: string }) => ({
    type: "DeleteKey",
    publicKey,
  }),

  deleteAccount: ({beneficiaryId}: { beneficiaryId: string }) => ({
    type: "DeleteAccount",
    beneficiaryId,
  }),

  createAccount: () => ({
    type: "CreateAccount",
  }),

  deployContract: ({codeBase64}: { codeBase64: string }) => ({
    type: "DeployContract",
    codeBase64,
  }),
};
