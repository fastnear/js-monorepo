/**
 * Protocol types for NEAR Intents (the verifier contract `intents.near`,
 * the 1Click swap API, and the solver relay).
 *
 * Sources of truth:
 * - 1Click OpenAPI: https://1click.chaindefuser.com/docs/v0/openapi.yaml
 * - Verifier docs:  https://docs.near-intents.org/integration/verifier-contract
 * - Solver relay:   https://docs.near-intents.org/integration/market-makers/message-bus/rpc.md
 */

/** The NEAR Intents verifier contract (mainnet). */
export const INTENTS_CONTRACT_ID = "intents.near";

/** Hosted 1Click swap API base URL. */
export const ONE_CLICK_BASE_URL = "https://1click.chaindefuser.com";

/** Hosted solver relay JSON-RPC endpoint. */
export const SOLVER_RELAY_URL = "https://solver-relay-v2.chaindefuser.com/rpc";

/**
 * A multi-token id inside the verifier's NEP-245 ledger:
 * `nep141:<contract>`, `nep171:<contract>:<token_id>`, or
 * `nep245:<contract>:<token_id>`.
 */
export type IntentsTokenId = string;

// ---------------------------------------------------------------------------
// Intent types executed by intents.near
// ---------------------------------------------------------------------------

/**
 * Trade intent: per-token balance deltas for the signer. Negative amounts are
 * paid by the signer, positive amounts are received. The verifier requires all
 * diffs in a batch to sum to zero per token, so a counterparty (solver) signs
 * the mirror diff.
 */
export interface TokenDiffIntent {
  intent: "token_diff";
  diff: Record<IntentsTokenId, string>;
  memo?: string;
  referral?: string;
}

/** Internal ledger transfer to another intents.near account. */
export interface TransferIntent {
  intent: "transfer";
  receiver_id: string;
  tokens: Record<IntentsTokenId, string>;
  memo?: string;
}

/**
 * Withdraw a NEP-141 token out of the verifier. `token` is the plain token
 * contract id (no `nep141:` prefix). Omit `msg` for refundable ft_transfer
 * semantics; passing `msg` switches to ft_transfer_call with no refund.
 */
export interface FtWithdrawIntent {
  intent: "ft_withdraw";
  token: string;
  receiver_id: string;
  amount: string;
  memo?: string;
  msg?: string;
  storage_deposit?: string;
}

export interface NftWithdrawIntent {
  intent: "nft_withdraw";
  token: string;
  receiver_id: string;
  token_id: string;
  memo?: string;
  msg?: string;
  storage_deposit?: string;
}

export interface MtWithdrawIntent {
  intent: "mt_withdraw";
  token: string;
  receiver_id: string;
  token_ids: string[];
  amounts: string[];
  memo?: string;
  msg?: string;
  storage_deposit?: string;
}

/** The only way to withdraw native NEAR: unwraps internal wNEAR on exit. */
export interface NativeWithdrawIntent {
  intent: "native_withdraw";
  receiver_id: string;
  amount: string;
}

/**
 * Pay a NEP-145 storage_deposit on a token contract from the signer's
 * internal wNEAR balance (registers a receiver before a withdrawal lands).
 */
export interface StorageDepositIntent {
  intent: "storage_deposit";
  contract_id: string;
  account_id: string;
  amount: string;
}

export type Intent =
  | TokenDiffIntent
  | TransferIntent
  | FtWithdrawIntent
  | NftWithdrawIntent
  | MtWithdrawIntent
  | NativeWithdrawIntent
  | StorageDepositIntent;

/**
 * The inner message that gets signed. For the `nep413` standard this JSON
 * string becomes the NEP-413 `message`, while the verifying contract and
 * replay nonce live in the NEP-413 envelope (`recipient` / `nonce`).
 */
export interface IntentMessage {
  signer_id: string;
  /** ISO-8601 timestamp after which the signed intent is invalid. */
  deadline: string;
  intents: Intent[];
}

// ---------------------------------------------------------------------------
// Signed payloads (MultiPayload)
// ---------------------------------------------------------------------------

/**
 * A NEP-413-signed intent as `intents.near`, the solver relay, and 1Click
 * accept it. Note the encodings: `nonce` is base64 of 32 bytes, while
 * `signature` and `public_key` are `ed25519:<base58>` strings — NOT the
 * base64 signature NEAR wallets return.
 */
export interface SignedIntentNep413 {
  standard: "nep413";
  payload: {
    message: string;
    nonce: string;
    recipient: string;
    callbackUrl?: string;
  };
  public_key: string;
  signature: string;
}

/**
 * Any signed payload standard the verifier accepts. This package produces
 * `nep413`; the other variants (erc191, tip191, raw_ed25519, webauthn,
 * ton_connect, sep53) are documented pass-through shapes.
 */
export type SignedIntent =
  | SignedIntentNep413
  | { standard: string; [key: string]: unknown };

/**
 * An unsigned NEP-413 payload, as returned by 1Click's generate-intent
 * endpoint (nonce is base64 of 32 bytes when it arrives as a string).
 */
export interface UnsignedNep413Payload {
  message: string;
  nonce: string | Uint8Array;
  recipient: string;
  callbackUrl?: string;
}

/**
 * What signPayload accepts: a bare unsigned payload or the
 * { standard, payload } wrapper 1Click's generate-intent returns.
 */
export type GeneratedUnsignedIntent =
  | UnsignedNep413Payload
  | { standard: string; payload: UnsignedNep413Payload };

export interface SignPayloadOptions {
  /**
   * The verifying contract the payload's recipient must equal. Defaults to
   * intents.near — a server response naming any other recipient throws
   * instead of being signed. Set explicitly to sign for a different
   * (e.g. staging) verifier deployment.
   */
  expectedRecipient?: string;
}

/** The signer surface shared by the wallet and local-key implementations. */
export interface IntentSigner {
  /** Build and sign an intent message this client composes itself. */
  signIntents(params: SignIntentsParams): Promise<SignedIntentNep413>;
  /**
   * Sign a pre-built NEP-413 payload verbatim — the 1Click generate-intent
   * flow, where the server chooses the message, nonce, and recipient. The
   * recipient is pinned to intents.near unless options.expectedRecipient
   * overrides it, so a malicious or buggy server cannot redirect the
   * signature to another contract.
   */
  signPayload(
    payload: GeneratedUnsignedIntent,
    options?: SignPayloadOptions,
  ): Promise<SignedIntentNep413>;
}

export interface SignIntentsParams {
  intents: Intent[];
  /** Defaults to the connected wallet account / the local signer account. */
  signerId?: string;
  /** ISO-8601; defaults to 5 minutes from now. */
  deadline?: string;
  /** 32 bytes; defaults to crypto-random. */
  nonce?: Uint8Array;
  /** Defaults to intents.near. Override only for a different verifier deployment. */
  verifyingContract?: string;
}

// ---------------------------------------------------------------------------
// 1Click API shapes (v0)
// ---------------------------------------------------------------------------

export type OneClickSwapType =
  | "EXACT_INPUT"
  | "EXACT_OUTPUT"
  | "FLEX_INPUT"
  | "ANY_INPUT";

export type OneClickDepositType =
  | "ORIGIN_CHAIN"
  | "INTENTS"
  | "CONFIDENTIAL_INTENTS";

export type OneClickRecipientType =
  | "DESTINATION_CHAIN"
  | "INTENTS"
  | "CONFIDENTIAL_INTENTS";

export type OneClickDepositMode = "SIMPLE" | "MEMO";

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  priceUpdatedAt?: string;
  contractAddress?: string;
  coingeckoId?: string;
}

export interface OneClickAppFee {
  /** intents.near account that collects the fee. */
  recipient: string;
  /** Basis points. */
  fee: number;
}

export interface OneClickQuoteRequest {
  /** true = price preview only (no depositAddress); false commits the quote. */
  dry: boolean;
  swapType: OneClickSwapType;
  /** Basis points, e.g. 100 = 1%. */
  slippageTolerance: number;
  originAsset: string;
  destinationAsset: string;
  /** Base units of the exact side selected by swapType. */
  amount: string;
  depositType: OneClickDepositType;
  refundTo: string;
  refundType: OneClickDepositType;
  recipient: string;
  recipientType: OneClickRecipientType;
  /** ISO-8601. */
  deadline: string;
  depositMode?: OneClickDepositMode;
  referral?: string;
  quoteWaitingTimeMs?: number;
  appFees?: OneClickAppFee[];
  insured?: boolean;
  connectedWallets?: unknown[];
  sessionId?: string;
  virtualChainRecipient?: string;
  virtualChainRefundRecipient?: string;
  customRecipientMsg?: string;
}

export interface OneClickQuote {
  depositAddress?: string;
  depositMemo?: string;
  chainDepositAddresses?: Array<{ chain: string; depositAddress?: string; memo?: string }>;
  amountIn: string;
  amountInFormatted?: string;
  amountInUsd?: string;
  minAmountIn?: string;
  amountOut: string;
  amountOutFormatted?: string;
  amountOutUsd?: string;
  minAmountOut?: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate?: number;
  refundFee?: string;
  withdrawFee?: string;
  virtualChainRecipient?: string;
  virtualChainRefundRecipient?: string;
  customRecipientMsg?: string;
}

export interface OneClickQuoteResponse {
  correlationId?: string;
  timestamp: string;
  /** Server-signed quote (verifiable per the 1Click docs). */
  signature: string;
  quoteRequest: OneClickQuoteRequest;
  quote: OneClickQuote;
}

export type OneClickStatus =
  | "KNOWN_DEPOSIT_TX"
  | "PENDING_DEPOSIT"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export interface OneClickStatusResponse {
  correlationId?: string;
  quoteResponse: OneClickQuoteResponse;
  status: OneClickStatus;
  updatedAt: string;
  swapDetails?: {
    intentHashes?: string[];
    nearTxHashes?: string[];
    originChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
    destinationChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
    amountIn?: string;
    amountInFormatted?: string;
    amountInUsd?: string;
    amountOut?: string;
    amountOutFormatted?: string;
    amountOutUsd?: string;
    slippage?: number;
    depositedAmount?: string;
    refundedAmount?: string;
    refundReason?: string;
    withdrawFee?: string;
    referral?: string;
  };
}

export interface OneClickSubmitDepositRequest {
  txHash: string;
  depositAddress: string;
  nearSenderAccount?: string;
  memo?: string;
}

export type OneClickSigningStandard =
  | "nep413"
  | "erc191"
  | "raw_ed25519"
  | "webauthn"
  | "ton_connect"
  | "sep53"
  | "tip191";

export interface OneClickGenerateIntentRequest {
  signerId: string;
  depositAddress: string;
  standard?: OneClickSigningStandard;
}

export interface OneClickGenerateIntentResponse {
  /** Unsigned payload to sign — pass it to an IntentSigner's signPayload. */
  intent: GeneratedUnsignedIntent;
  correlationId?: string;
}

export interface OneClickSubmitIntentResponse {
  intentHash: string;
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Solver relay JSON-RPC shapes
// ---------------------------------------------------------------------------

export interface RelayQuoteParams {
  defuse_asset_identifier_in: IntentsTokenId;
  defuse_asset_identifier_out: IntentsTokenId;
  exact_amount_in?: string;
  exact_amount_out?: string;
  /** Milliseconds; relay default is 60000. */
  min_deadline_ms?: number;
}

export interface RelayQuote {
  quote_hash: string;
  defuse_asset_identifier_in: IntentsTokenId;
  defuse_asset_identifier_out: IntentsTokenId;
  amount_in: string;
  amount_out: string;
  expiration_time: string;
}

export type RelayIntentStatus =
  | "PENDING"
  | "TX_BROADCASTED"
  | "SETTLED"
  | "NOT_FOUND_OR_NOT_VALID";

export interface RelayPublishResult {
  status: string;
  intent_hash: string;
}

export interface RelayStatusResult {
  intent_hash: string;
  status: RelayIntentStatus;
  status_details?: string;
  data?: { hash?: string };
  filled_amounts?: string[];
}
