import type { NEP413Message, NearPublicKeyHandle } from "@fastnear/utils";

export interface AccessKeyWithError {
  result: {
    nonce: number | string;
    permission?: AccessKeyPermissionView;
    error?: string;
  };
}

export interface FunctionCallPermissionView {
  allowance: string | null;
  receiver_id: string;
  method_names: string[];
}

/**
 * Gas key (protocol 85+): a prepaid yoctoNEAR `balance` that pays this key's
 * gas, and `num_nonces` independent nonce lanes (see `queryGasKeyNonces`).
 */
export interface GasKeyInfoView {
  balance: string;
  num_nonces: number;
}

export type AccessKeyPermissionView =
  | "FullAccess"
  | { FunctionCall: FunctionCallPermissionView }
  | { GasKeyFullAccess: GasKeyInfoView }
  // RPC flattens the (GasKeyInfo, FunctionCallPermission) tuple into one object.
  | { GasKeyFunctionCall: GasKeyInfoView & FunctionCallPermissionView };

/** `query` / `view_gas_key_nonces`: one nonce per lane, in lane order. */
export interface GasKeyNoncesResponse {
  result: {
    nonces: Array<number | string>;
    block_height?: number;
    block_hash?: string;
    error?: string;
  };
}

export interface AccessKeyInfoView {
  /** Full classical key, or an ml-dsa-65-hash: handle for ML-DSA-65. */
  public_key: NearPublicKeyHandle;
  access_key: {
    nonce: number | string;
    permission: AccessKeyPermissionView;
  };
}

export interface AccessKeyListResponse {
  result: {
    keys: AccessKeyInfoView[];
    /** Pagination cursor: present when truncated; pass it as `afterKey` for the next page. */
    last_key?: NearPublicKeyHandle | null;
    block_height?: number;
    block_hash?: string;
  };
}

export interface RpcStatusResponse {
  result: {
    protocol_version: number;
    latest_protocol_version?: number;
    [key: string]: any;
  };
}

export interface BlockView {
  result: {
    header: {
      hash: string;
      height: number;
      timestamp_nanosec: string;
    };
  };
}

export interface LastKnownBlock {
  header: {
    hash: string;
    timestamp_nanosec: string;
  };
}

export interface AccessKeyView {
  nonce: number;
  permission: any;
}

export interface FastNearRpcAccountView {
  amount: string;
  locked?: string;
  storage_usage?: number;
  code_hash?: string;
  block_height?: number;
  block_hash?: string;
  [key: string]: any;
}

export interface FastNearRpcQueryAccountResponse {
  result: FastNearRpcAccountView;
  [key: string]: any;
}

export interface FastNearRecipeViewAccountResult extends FastNearRpcAccountView {}

export interface RecipeViewContractParams {
  contractId: string;
  methodName: string;
  args?: any;
  argsBase64?: string;
  blockId?: string;
  // Every `near.recipes.*` takes a per-call network override. The read
  // recipes accepted one at runtime but never declared it, so TypeScript
  // callers could not pass what the catalog documents.
  network?: "mainnet" | "testnet";
}

export interface RecipeViewAccountParams {
  accountId: string;
  blockId?: string;
  network?: "mainnet" | "testnet";
}

export type RecipeViewAccountInput = string | RecipeViewAccountParams;

export interface RecipeInspectTransactionParams {
  txHash: string;
  accountId?: string;
  network?: "mainnet" | "testnet";
}

export type RecipeInspectTransactionInput = string | RecipeInspectTransactionParams;

export interface RecipeFunctionCallParams {
  receiverId: string;
  methodName: string;
  args?: Record<string, any>;
  argsBase64?: string;
  gas?: string;
  deposit?: string;
  waitUntil?: string;
  // Routes the call through the per-network slot in `@fastnear/api@1.1.1+`
  // so a page holding parallel mainnet+testnet sessions can dispatch to
  // either without flipping `near.config()`. Falls back to the active
  // network when omitted.
  network?: "mainnet" | "testnet";
}

export interface RecipeTransferParams {
  receiverId: string;
  amount: string;
  waitUntil?: string;
  network?: "mainnet" | "testnet";
}

export interface RecipeConnectParams {
  contractId?: string;
  excludedWallets?: string[];
  features?: Record<string, boolean>;
  // When set, opens the wallet picker scoped to this network — otherwise
  // falls back to `near.config().networkId`. With @fastnear/wallet 1.1.0+
  // the per-network sessions live alongside each other on the same page.
  network?: "mainnet" | "testnet";
  // NEP-413 message signed in the same wallet popup as sign-in. Requires a
  // wallet advertising the `signInAndSignMessage` feature; the picker is
  // filtered to those, so omit `walletId` when using this.
  signMessageParams?: {
    message: string;
    recipient: string;
    nonce: Uint8Array;
  };
}

export interface FastNearRecipeDiscoveryEntry {
  id: string;
  api: string;
  title: string;
}

export interface ExplainedAction {
  kind: "action";
  type: string;
  params: Record<string, any>;
  methodName?: string | null;
  gas?: string | null;
  deposit?: string | null;
  args?: any;
  argsBase64?: string | null;
  publicKey?: string | null;
  stake?: string | null;
  beneficiaryId?: string | null;
  accessKey?: any;
  codeBase64?: string | null;
  codeLength?: number | null;
  /** WithdrawFromGasKey. */
  amount?: string | null;
  /** AddKey with a gas-key permission. */
  numNonces?: number | null;
}

export interface ExplainedTransaction {
  kind: "transaction";
  signerId?: string | null;
  receiverId: string;
  actionCount: number;
  actions: ExplainedAction[];
}

export interface ExplainedError {
  kind: "rpc_error" | "wallet_error" | "transport_error" | "error";
  code: string | number | null;
  name: string | null;
  message: string;
  data: any;
  retryable: boolean;
}

export interface FastNearApiAccountState {
  balance: string;
  locked?: string;
  storage_usage?: number;
  code_hash?: string;
  block_height?: number;
  block_hash?: string;
  [key: string]: any;
}

export interface FastNearApiTokenBalance {
  contract_id?: string;
  ft_id?: string;
  symbol?: string;
  balance?: string;
  balance_yocto?: string;
  decimals?: number;
  [key: string]: any;
}

export interface FastNearApiNftContractHolding {
  contract_id?: string;
  nft_contract_id?: string;
  tokens?: any[];
  [key: string]: any;
}

export interface FastNearApiStakingPoolPosition {
  pool_id?: string;
  contract_id?: string;
  staked_balance?: string;
  unstaked_balance?: string;
  can_withdraw?: boolean;
  [key: string]: any;
}

export interface FastNearApiPublicKeyAccount {
  account_id: string;
  public_key?: string;
  access_key?: any;
  [key: string]: any;
}

export interface FastNearApiFtTopAccount {
  account_id: string;
  balance?: string;
  human_balance?: string;
  [key: string]: any;
}

export interface FastNearApiV1AccountFullResponse {
  account_id: string;
  state: FastNearApiAccountState;
  tokens: FastNearApiTokenBalance[];
  nfts: FastNearApiNftContractHolding[];
  pools: FastNearApiStakingPoolPosition[];
  [key: string]: any;
}

export interface FastNearApiV1AccountFtResponse {
  account_id?: string;
  tokens: FastNearApiTokenBalance[];
  page_token?: string | null;
  resume_token?: string | null;
  [key: string]: any;
}

export interface FastNearApiV1AccountNftResponse {
  account_id?: string;
  nfts: FastNearApiNftContractHolding[];
  page_token?: string | null;
  resume_token?: string | null;
  [key: string]: any;
}

export interface FastNearApiV1AccountStakingResponse {
  account_id?: string;
  pools: FastNearApiStakingPoolPosition[];
  page_token?: string | null;
  resume_token?: string | null;
  [key: string]: any;
}

export interface FastNearApiV1PublicKeyResponse {
  public_key?: string;
  accounts: FastNearApiPublicKeyAccount[];
  [key: string]: any;
}

export interface FastNearApiV1PublicKeyAllResponse {
  public_key?: string;
  accounts: FastNearApiPublicKeyAccount[];
  transactions?: any[];
  [key: string]: any;
}

export interface FastNearApiV1FtTopResponse {
  token_id?: string;
  accounts: FastNearApiFtTopAccount[];
  page_token?: string | null;
  [key: string]: any;
}

export interface FastNearTxExecutionOutcome {
  block_hash?: string;
  block_height?: number;
  id?: string;
  logs?: string[];
  outcome?: any;
  proof?: any[];
  executor_id?: string;
  status?: any;
  tokens_burnt?: string;
  [key: string]: any;
}

export interface FastNearTxTransactionRecord {
  hash: string;
  signer_id: string;
  receiver_id: string;
  actions?: any[];
  /** Present when the transaction was signed with a gas key (TransactionV1). */
  nonce_index?: number;
  /** Present for TransactionV1 in strict mode; omitted when monotonic. */
  nonce_mode?: "monotonic" | "strict";
  [key: string]: any;
}

export interface FastNearTxReceiptRow {
  receipt_id?: string;
  receipt?: any;
  execution_outcome?: FastNearTxExecutionOutcome;
  [key: string]: any;
}

export interface FastNearTxTransactionRow {
  transaction: FastNearTxTransactionRecord;
  execution_outcome: FastNearTxExecutionOutcome;
  receipts: FastNearTxReceiptRow[];
  [key: string]: any;
}

export interface FastNearTxBlockRow {
  block_height?: number;
  block_hash?: string;
  transactions?: FastNearTxTransactionRow[];
  receipts?: FastNearTxReceiptRow[];
  [key: string]: any;
}

export interface FastNearTxTransactionsResponse {
  transactions: FastNearTxTransactionRow[];
  resume_token?: string | null;
  page_token?: string | null;
  [key: string]: any;
}

export interface FastNearTxReceiptResponse {
  receipt?: FastNearTxReceiptRow | null;
  receipts?: FastNearTxReceiptRow[];
  transaction?: FastNearTxTransactionRow | null;
  [key: string]: any;
}

export interface FastNearTxAccountResponse {
  transactions?: FastNearTxTransactionRow[];
  resume_token?: string | null;
  page_token?: string | null;
  [key: string]: any;
}

export interface FastNearTxBlockResponse {
  block?: FastNearTxBlockRow;
  [key: string]: any;
}

export interface FastNearTxBlocksResponse {
  blocks: FastNearTxBlockRow[];
  resume_token?: string | null;
  page_token?: string | null;
  [key: string]: any;
}

export interface FastNearTransfersEntry {
  account_id?: string;
  asset_id?: string;
  human_amount?: string;
  other_account_id?: string;
  transfer_type?: string;
  transaction_id?: string;
  block_height?: number;
  [key: string]: any;
}

export interface FastNearTransfersQueryResponse {
  transfers: FastNearTransfersEntry[];
  resume_token?: string | null;
  [key: string]: any;
}

export interface FastNearNeardataTransaction {
  hash?: string;
  signer_id?: string;
  receiver_id?: string;
  [key: string]: any;
}

export interface FastNearNeardataBlockHeader {
  height: number;
  hash?: string;
  prev_hash?: string;
  timestamp_nanosec?: string;
  [key: string]: any;
}

export interface FastNearNeardataChunk {
  chunk_hash?: string;
  shard_id?: number;
  transactions: FastNearNeardataTransaction[];
  [key: string]: any;
}

export interface FastNearNeardataShard {
  shard_id: number;
  chunk: FastNearNeardataChunk;
  [key: string]: any;
}

export interface FastNearNeardataBlock {
  header: FastNearNeardataBlockHeader;
  [key: string]: any;
}

export interface FastNearNeardataLastBlockFinalResponse {
  block: FastNearNeardataBlock;
  shards: FastNearNeardataShard[];
  [key: string]: any;
}

export interface FastNearNeardataLastBlockOptimisticResponse {
  block: FastNearNeardataBlock;
  shards: FastNearNeardataShard[];
  [key: string]: any;
}

export interface FastNearNeardataBlockResponse {
  block: FastNearNeardataBlock;
  shards: FastNearNeardataShard[];
  [key: string]: any;
}

export interface FastNearNeardataBlockHeadersResponse {
  block: FastNearNeardataBlock;
  shards?: FastNearNeardataShard[];
  [key: string]: any;
}

export interface FastNearNeardataBlockShardResponse {
  block: FastNearNeardataBlock;
  shard: FastNearNeardataShard;
  [key: string]: any;
}

export interface FastNearNeardataBlockChunkResponse {
  block: FastNearNeardataBlock;
  chunk: FastNearNeardataChunk;
  [key: string]: any;
}

export interface FastNearNeardataBlockOptimisticResponse {
  block: FastNearNeardataBlock;
  shards: FastNearNeardataShard[];
  [key: string]: any;
}

export interface FastNearNeardataFirstBlockResponse {
  block: FastNearNeardataBlock;
  [key: string]: any;
}

export interface FastNearNeardataHealthResponse {
  status?: string;
  ok?: boolean;
  [key: string]: any;
}

export interface FastNearKvEntry {
  current_account_id: string;
  predecessor_id: string;
  key: string;
  value: any;
  block_height?: number;
  block_hash?: string;
  timestamp_nanosec?: string;
  [key: string]: any;
}

export interface FastNearKvEntriesResponse {
  entries: FastNearKvEntry[];
  resume_token?: string | null;
  page_token?: string | null;
  [key: string]: any;
}

export interface FastNearKvGetLatestKeyResponse extends FastNearKvEntriesResponse {}

export interface FastNearKvGetHistoryKeyResponse extends FastNearKvEntriesResponse {}

export interface FastNearKvLatestByAccountResponse extends FastNearKvEntriesResponse {}

export interface FastNearKvHistoryByAccountResponse extends FastNearKvEntriesResponse {}

export interface FastNearKvLatestByPredecessorResponse extends FastNearKvEntriesResponse {}

export interface FastNearKvHistoryByPredecessorResponse extends FastNearKvEntriesResponse {}

export interface FastNearKvAllByPredecessorResponse extends FastNearKvEntriesResponse {}

export interface FastNearKvMultiResult {
  entries?: FastNearKvEntry[];
  [key: string]: any;
}

export interface FastNearKvMultiResponse {
  results?: FastNearKvMultiResult[];
  entries?: FastNearKvEntry[];
  [key: string]: any;
}

export type FastNearSignMessageParams = NEP413Message;
