import { INTENTS_CONTRACT_ID, type IntentsTokenId } from "./types.js";

/** Gas / deposit defaults for verifier interactions. */
export const FT_TRANSFER_CALL_GAS = "100000000000000"; // 100 TGas
export const WITHDRAW_GAS = "100000000000000"; // 100 TGas
export const WRAP_NEAR_GAS = "30000000000000"; // 30 TGas
export const ONE_YOCTO = "1";

/** wNEAR contract — native NEAR must be wrapped before depositing. */
export const WRAP_NEAR_CONTRACT_ID = "wrap.near";

export interface FunctionCallActionShape {
  type: "FunctionCall";
  params: {
    methodName: string;
    args: Record<string, unknown>;
    gas: string;
    deposit: string;
  };
}

/**
 * Build the `ft_transfer_call` action that deposits a NEP-141 token into the
 * verifier. Apply it ON the token contract:
 *
 *   near.sendTx({ receiverId: "usdt.tether-token.near",
 *                 actions: [ftDepositAction({ amount })] })
 *
 * `msg` semantics (per the verifier docs): "" credits the sender; an
 * account-id string credits that account (`creditTo`); a JSON string enables
 * execute_intents-on-deposit. Native NEAR is rejected by the verifier —
 * wrap it first (see wrapNearAction).
 */
export function ftDepositAction({
  amount,
  creditTo,
  msg,
  verifierId = INTENTS_CONTRACT_ID,
  gas = FT_TRANSFER_CALL_GAS,
}: {
  amount: string;
  creditTo?: string;
  msg?: string;
  verifierId?: string;
  gas?: string;
}): FunctionCallActionShape {
  if (creditTo !== undefined && msg !== undefined) {
    throw new Error("Pass either creditTo or msg, not both");
  }
  return {
    type: "FunctionCall",
    params: {
      methodName: "ft_transfer_call",
      args: {
        receiver_id: verifierId,
        amount,
        msg: msg ?? creditTo ?? "",
      },
      gas,
      deposit: ONE_YOCTO,
    },
  };
}

/**
 * Build the `near_deposit` action that wraps native NEAR into wNEAR.
 * Apply it ON wrap.near:
 *
 *   near.sendTx({ receiverId: "wrap.near",
 *                 actions: [wrapNearAction({ amountYocto })] })
 */
export function wrapNearAction({
  amountYocto,
  gas = WRAP_NEAR_GAS,
}: {
  amountYocto: string;
  gas?: string;
}): FunctionCallActionShape {
  return {
    type: "FunctionCall",
    params: {
      methodName: "near_deposit",
      args: {},
      gas,
      deposit: amountYocto,
    },
  };
}

/**
 * Build the direct-call `ft_withdraw` action that moves a NEP-141 token out
 * of the verifier back to a NEAR account. Apply it ON intents.near. `token`
 * is the plain contract id (no `nep141:` prefix). Omit `msg` so failed
 * withdrawals stay refundable.
 */
export function ftWithdrawAction({
  token,
  receiverId,
  amount,
  memo,
  msg,
  storageDeposit,
  gas = WITHDRAW_GAS,
}: {
  token: string;
  receiverId: string;
  amount: string;
  memo?: string;
  msg?: string;
  storageDeposit?: string;
  gas?: string;
}): FunctionCallActionShape {
  if (token.includes(":")) {
    throw new Error(
      `ft_withdraw takes the plain token contract id, not a prefixed multi-token id: ${token}`,
    );
  }
  return {
    type: "FunctionCall",
    params: {
      methodName: "ft_withdraw",
      args: {
        token,
        receiver_id: receiverId,
        amount,
        ...(memo !== undefined ? { memo } : {}),
        ...(msg !== undefined ? { msg } : {}),
        ...(storageDeposit !== undefined
          ? { storage_deposit: storageDeposit }
          : {}),
      },
      gas,
      deposit: ONE_YOCTO,
    },
  };
}

/** A near.view-compatible function, injected so this package stays api-free. */
export type ViewFunction = (params: {
  contractId: string;
  methodName: string;
  args: Record<string, unknown>;
}) => Promise<unknown>;

/** Read one internal balance from the verifier's NEP-245 ledger. */
export async function mtBalance({
  accountId,
  tokenId,
  view,
  verifierId = INTENTS_CONTRACT_ID,
}: {
  accountId: string;
  tokenId: IntentsTokenId;
  view: ViewFunction;
  verifierId?: string;
}): Promise<string> {
  const result = await view({
    contractId: verifierId,
    methodName: "mt_balance_of",
    args: { account_id: accountId, token_id: tokenId },
  });
  return String(result ?? "0");
}

/**
 * Read many internal balances in one view call. Returns a map keyed by
 * token id (the RPC returns base-unit strings in request order).
 */
export async function mtBatchBalances({
  accountId,
  tokenIds,
  view,
  verifierId = INTENTS_CONTRACT_ID,
}: {
  accountId: string;
  tokenIds: IntentsTokenId[];
  view: ViewFunction;
  verifierId?: string;
}): Promise<Record<IntentsTokenId, string>> {
  const result = (await view({
    contractId: verifierId,
    methodName: "mt_batch_balance_of",
    args: { account_id: accountId, token_ids: tokenIds },
  })) as unknown[];
  if (!Array.isArray(result) || result.length !== tokenIds.length) {
    throw new Error(
      `mt_batch_balance_of returned ${Array.isArray(result) ? result.length : typeof result} results for ${tokenIds.length} token ids`,
    );
  }
  return Object.fromEntries(
    tokenIds.map((tokenId, index) => [tokenId, String(result[index] ?? "0")]),
  );
}
