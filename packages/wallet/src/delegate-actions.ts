import type {
  SignDelegateActionResult as NearConnectSignDelegateActionResult,
  SignDelegateActionsParams as NearConnectSignDelegateActionsParams,
  WalletManifest as NearConnectWalletManifest,
} from "@fastnear/near-connect/build/types";
import { toConnectorActions } from "./connector-actions.js";

export type WalletManifest = Omit<NearConnectWalletManifest, "features"> & {
  features: NearConnectWalletManifest["features"] & {
    /** The wallet honors blockHeightTtl when constructing NEP-366 delegates. */
    signDelegateActionsWithTtl?: boolean;
  };
};

type NearConnectDelegateAction = NearConnectSignDelegateActionsParams["delegateActions"][number];

export type SignDelegateAction = NearConnectDelegateAction & {
  /** Number of blocks after the wallet's final block at which the delegate expires. */
  blockHeightTtl?: number;
};

export type SignDelegateActionsParams = Omit<
  NearConnectSignDelegateActionsParams,
  "delegateActions"
> & {
  delegateActions: SignDelegateAction[];
};

/** Canonical transport-safe representation returned by timeout-aware wallets. */
export interface BorshSerializedSignedDelegate {
  borshSerializedBase64: string;
}

/**
 * near-connect historically typed structured delegates while some wallet
 * executors returned bare base64 strings. Keep accepting both during the
 * transition to the canonical transport-safe object.
 */
export type SignDelegateActionResult =
  | BorshSerializedSignedDelegate
  | NearConnectSignDelegateActionResult
  | string;

export interface SignDelegateActionsResponse {
  signedDelegateActions: SignDelegateActionResult[];
}

function isFastnearAction(action: unknown): action is { type: string } {
  return (
    typeof action === "object" &&
    action !== null &&
    "type" in action &&
    typeof action.type === "string" &&
    !("params" in action) &&
    action.type !== "CreateAccount"
  );
}

export function validateBlockHeightTtl(blockHeightTtl: number): void {
  if (!Number.isSafeInteger(blockHeightTtl) || blockHeightTtl <= 0) {
    throw new RangeError("blockHeightTtl must be a positive safe integer");
  }
}

/** Prepare requests for near-connect without dropping timeout metadata. */
export function prepareDelegateActionsForWallet(
  delegateActions: SignDelegateAction[],
  features?: Record<string, unknown>,
): SignDelegateAction[] {
  const requiresTimeoutAwareSigning = delegateActions.some(
    ({ blockHeightTtl }) => blockHeightTtl !== undefined,
  );

  for (const { blockHeightTtl } of delegateActions) {
    if (blockHeightTtl !== undefined) validateBlockHeightTtl(blockHeightTtl);
  }

  if (
    requiresTimeoutAwareSigning &&
    features?.signDelegateActionsWithTtl !== true
  ) {
    throw new Error(
      "Connected wallet does not support timeout-aware delegate signing (signDelegateActionsWithTtl)",
    );
  }

  return delegateActions.map((delegateAction) => ({
    ...delegateAction,
    actions: delegateAction.actions.some(isFastnearAction)
      ? toConnectorActions(delegateAction.actions)
      : delegateAction.actions,
  }));
}
