import { serialize as borshSerialize, deserialize as borshDeserialize } from "@fastnear/borsh";
import {
  assertNearValidatorPublicKey,
  decodeNearPublicKey,
  keyFromString,
  keyToString,
  keyTypeFromString,
  NEAR_KEY_DESCRIPTORS,
  sha256,
  type NearKeyType,
  type NearPublicKey,
} from "./crypto.js";
import { base64ToBytes, bytesToBase64, fromBase58, toBase58 } from "./misc.js";
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

/** Maximum nonce lanes a gas key may declare (nearcore `MAX_NONCES_FOR_GAS_KEY`). */
export const MAX_GAS_KEY_NONCES = 1024;

/**
 * Gas-key permission kinds (protocol 85+). A gas key carries a prepaid balance
 * that pays for gas plus `numNonces` independent nonce lanes. `GasKeyFunctionCall`
 * additionally restricts calls like a FunctionCall key, but may not carry an
 * allowance — gas comes from the key balance, so the chain rejects one.
 */
export type NearGasKeyPermissionKind = "GasKeyFullAccess" | "GasKeyFunctionCall";

export const isGasKeyPermission = (
  permission: unknown,
): permission is NearGasKeyPermissionKind =>
  permission === "GasKeyFullAccess" || permission === "GasKeyFunctionCall";

export interface NearAccessKey {
  nonce?: NearInteger;
  permission:
    | "FullAccess"
    | "FunctionCall"
    | NearGasKeyPermissionKind
    | NearFunctionCallPermission;
  receiverId?: string;
  methodNames?: string[];
  allowance?: NearInteger | null;
  /** Gas keys: nonce lanes, 1..MAX_GAS_KEY_NONCES. Required for the GasKey* permissions. */
  numNonces?: number;
  /**
   * Gas keys: yoctoNEAR balance. Must be 0 (omit it) when adding a key — fund it
   * afterwards with TransferToGasKey. Present so keys decoded from chain payloads
   * (parseSignedDelegate) round-trip byte-for-byte.
   */
  balance?: NearInteger;
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

/** Fund a gas key's balance. Any account may send it; `deposit` leaves the sender. */
export interface NearTransferToGasKeyAction {
  type: "TransferToGasKey";
  publicKey: NearPublicKey;
  deposit: NearInteger;
}

/**
 * Move `amount` from a gas key's balance back to its account. Signer must be the
 * owning account, and it cannot ride inside a NEP-366 delegate (protocol 87+).
 */
export interface NearWithdrawFromGasKeyAction {
  type: "WithdrawFromGasKey";
  publicKey: NearPublicKey;
  amount: NearInteger;
}

/** Actions a NEP-366 DelegateAction may carry. */
export type NearClassicAction =
  | NearCreateAccountAction
  | NearDeployContractAction
  | NearFunctionCallAction
  | NearTransferAction
  | NearStakeAction
  | NearAddKeyAction
  | NearDeleteKeyAction
  | NearDeleteAccountAction
  | NearTransferToGasKeyAction;

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

export type NearAction =
  | NearClassicAction
  | NearWithdrawFromGasKeyAction
  | NearSignedDelegateAction;

/** TransactionV1 nonce validation: "monotonic" (nonce > stored) or "strict" (nonce == stored + 1). */
export type NearNonceMode = "monotonic" | "strict";

export interface PlainTransaction {
  signerId: string;
  publicKey: NearPublicKey;
  nonce: NearInteger;
  receiverId: string;
  blockHash: string;
  actions: NearAction[];
  /**
   * Gas keys only: which nonce lane (0..numNonces-1) this transaction advances.
   * Presence selects TransactionV1 with a GasKeyNonce; a gas key cannot sign V0.
   */
  nonceIndex?: number;
  /** TransactionV1 only. Defaults to "monotonic"; any value selects TransactionV1. */
  nonceMode?: NearNonceMode;
}

/** Wire prefix byte of `Transaction::V1` (V0 has none). */
export const TRANSACTION_V1_VERSION = 1;

/** A transaction needs the V1 wire format when it carries any V1-only field. */
export const isTransactionV1 = (tx: PlainTransaction): boolean =>
  tx.nonceIndex !== undefined || tx.nonceMode !== undefined;

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

/**
 * Map a flat transaction into the borsh chain-schema shape. Without V1-only
 * fields the result is the V0 shape (byte-identical to before gas keys); with
 * `nonceIndex` and/or `nonceMode` it is the TransactionV1 shape, including the
 * leading `version` byte the chain hashes and signs.
 */
export function mapTransaction(jsonTransaction: PlainTransaction) {
  const nonce = BigInt(jsonTransaction.nonce);
  const common = {
    signerId: jsonTransaction.signerId,
    publicKey: mapPublicKey(jsonTransaction.publicKey),
    receiverId: jsonTransaction.receiverId,
    blockHash: fromBase58(jsonTransaction.blockHash),
    actions: jsonTransaction.actions.map(mapAction),
  };
  if (!isTransactionV1(jsonTransaction)) {
    return { ...common, nonce };
  }

  const { nonceIndex, nonceMode } = jsonTransaction;
  if (nonceMode !== undefined && nonceMode !== "monotonic" && nonceMode !== "strict") {
    throw new Error(
      `Unsupported nonceMode: ${String(nonceMode)} (expected "monotonic" or "strict")`,
    );
  }
  if (
    nonceIndex !== undefined &&
    (!Number.isInteger(nonceIndex) || nonceIndex < 0 || nonceIndex >= MAX_GAS_KEY_NONCES)
  ) {
    throw new Error(
      `nonceIndex must be an integer in 0..${MAX_GAS_KEY_NONCES - 1}, got ${String(nonceIndex)}`,
    );
  }
  return {
    version: TRANSACTION_V1_VERSION,
    ...common,
    nonce:
      nonceIndex !== undefined
        ? { gasKeyNonce: { nonce, nonceIndex } }
        : { nonce: { nonce } },
    nonceMode: nonceMode === "strict" ? { strict: {} } : { monotonic: {} },
  };
}

export function serializeTransaction(jsonTransaction: PlainTransaction) {
  const transaction = mapTransaction(jsonTransaction);
  const schema = isTransactionV1(jsonTransaction) ? SCHEMA.TransactionV1 : SCHEMA.Transaction;
  return borshSerialize(schema, transaction);
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

  const schema = isTransactionV1(jsonTransaction)
    ? SCHEMA.SignedTransactionV1
    : SCHEMA.SignedTransaction;
  return borshSerialize(schema, plainSignedTransaction);
}

function mapGasKeyInfo(accessKey: NearAccessKey) {
  const numNonces = accessKey.numNonces;
  if (
    !Number.isInteger(numNonces) ||
    (numNonces as number) < 1 ||
    (numNonces as number) > MAX_GAS_KEY_NONCES
  ) {
    throw new Error(
      `Gas keys need numNonces between 1 and ${MAX_GAS_KEY_NONCES}, got ${String(numNonces)}`,
    );
  }
  // The balance is not policed here: AddKey requires 0 (enforced at the api
  // ingress), but a key decoded from a chain payload must re-encode as-is.
  return { balance: toNearAmount(accessKey.balance), numNonces: numNonces as number };
}

function mapFunctionCallPermission(functionCall: {
  receiverId?: string;
  methodNames?: string[];
  allowance?: NearInteger | null;
}) {
  if (typeof functionCall.receiverId !== "string") {
    throw new Error("Function-call access keys require a receiverId");
  }
  return {
    allowance:
      functionCall.allowance != null ? toNearAmount(functionCall.allowance) : null,
    receiverId: functionCall.receiverId,
    methodNames: functionCall.methodNames ?? [],
  };
}

function mapAccessKeyPermission(accessKey: NearAccessKey): object {
  const permission = accessKey.permission;
  if (permission === "FullAccess") {
    return { fullAccess: {} };
  }
  if (permission === "GasKeyFullAccess") {
    return { gasKeyFullAccess: mapGasKeyInfo(accessKey) };
  }
  if (permission === "GasKeyFunctionCall") {
    if (accessKey.allowance != null) {
      throw new Error(
        "GasKeyFunctionCall keys cannot carry an allowance — gas is paid from the gas key balance",
      );
    }
    return {
      gasKeyFunctionCall: {
        gasKeyInfo: mapGasKeyInfo(accessKey),
        functionCall: mapFunctionCallPermission(accessKey),
      },
    };
  }
  if (permission === "FunctionCall") {
    return { functionCall: mapFunctionCallPermission(accessKey) };
  }
  if (permission != null && typeof permission === "object") {
    return { functionCall: mapFunctionCallPermission(permission) };
  }
  throw new Error(`Unsupported access-key permission: ${String(permission)}`);
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
      return {
        addKey: {
          publicKey: mapPublicKey(action.publicKey),
          accessKey: {
            nonce: BigInt(action.accessKey.nonce ?? 0),
            permission: mapAccessKeyPermission(action.accessKey),
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
    case "TransferToGasKey": {
      return {
        transferToGasKey: {
          publicKey: mapPublicKey(action.publicKey),
          deposit: toNearAmount(action.deposit),
        },
      };
    }
    case "WithdrawFromGasKey": {
      return {
        withdrawFromGasKey: {
          publicKey: mapPublicKey(action.publicKey),
          amount: toNearAmount(action.amount),
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
          delegateAction: mapDelegateAction(delegate),
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

/**
 * NEP-461 domain-separation tag for delegate actions (2^30 + 366), written as a
 * little-endian u32 in front of the borsh DelegateAction before hashing. Single-
 * sourced here so the api's local signer and the wallet-adapter's validator
 * can't drift on the prefix.
 */
export const NEP461_DELEGATE_TAG = 2 ** 30 + 366;

/**
 * Reject actions a NEP-366 DelegateAction cannot carry: a nested SignedDelegate
 * (never allowed) and WithdrawFromGasKey, which the chain rejects inside
 * delegates from protocol 87 (`WithdrawFromGasKeyNotAllowedInDelegate`).
 */
export function assertDelegatable(actions: ReadonlyArray<{ type?: unknown }>): void {
  for (const action of actions) {
    const type = action?.type;
    if (type === "SignedDelegate") {
      throw new Error("A NEP-366 DelegateAction cannot carry a nested SignedDelegate");
    }
    if (type === "WithdrawFromGasKey") {
      throw new Error(
        "WithdrawFromGasKey cannot be carried inside a NEP-366 DelegateAction " +
          "(rejected on-chain from protocol 87: WithdrawFromGasKeyNotAllowedInDelegate); " +
          "send it in a direct transaction from the account",
      );
    }
  }
}

/** Map a flat DelegateAction into the borsh chain-schema shape. */
function mapDelegateAction(delegate: NearDelegateAction) {
  assertDelegatable(delegate.actions);
  return {
    senderId: delegate.senderId,
    receiverId: delegate.receiverId,
    actions: delegate.actions.map(mapAction),
    nonce: BigInt(delegate.nonce),
    maxBlockHeight: BigInt(delegate.maxBlockHeight),
    publicKey: mapPublicKey(delegate.publicKey),
  };
}

/** Borsh-serialize a NEP-366 DelegateAction, mapped to the chain schema shape. */
export function serializeDelegateAction(delegate: NearDelegateAction): Uint8Array {
  return new Uint8Array(borshSerialize(SCHEMA.DelegateAction, mapDelegateAction(delegate)));
}

/** Borsh-serialize a NEP-366 SignedDelegate from a flat delegate + signature. */
export function serializeSignedDelegate(
  delegate: NearDelegateAction,
  signature: string | Uint8Array,
): Uint8Array {
  return new Uint8Array(
    borshSerialize(SCHEMA.SignedDelegate, {
      delegateAction: mapDelegateAction(delegate),
      signature: mapSignature(signature, delegate.publicKey),
    }),
  );
}

/**
 * The 32-byte hash a signer authorizes for a delegate action:
 * `sha256(NEP461_DELEGATE_TAG_le_u32 ‖ borsh(DelegateAction))`. Signing this and
 * pairing the signature with the delegate yields a NEP-366 SignedDelegate.
 */
export function delegateSigningHash(delegate: NearDelegateAction): Uint8Array {
  const body = serializeDelegateAction(delegate);
  const prefixed = new Uint8Array(4 + body.length);
  new DataView(prefixed.buffer).setUint32(0, NEP461_DELEGATE_TAG, true);
  prefixed.set(body, 4);
  return sha256(prefixed);
}

// ── parseSignedDelegate: the inverse of serializeSignedDelegate ──────────────
//
// A wallet's `signDelegateActions` hands back borsh bytes (as base64), but
// `relayDelegate` / `actions.signedDelegate` want the flat
// `{ delegateAction, signature }` shape `signDelegate` returns. Borsh-decoding
// those bytes yields the chain-schema shape — enum variants as
// `{ transfer: { … } }`, byte arrays as number[], wide ints as decimal strings,
// keys/signatures as `{ ed25519Key: { data } }`. Feeding that straight back
// into the action builders throws `Not implemented action: undefined`, because
// `mapAction` switches on `.type`, which the borsh shape doesn't carry. So the
// work here is inverting `mapAction` / `mapPublicKey` / `mapSignature` exactly.

// Reverse the descriptor table (keyType -> variant) into variant -> keyType, so
// this can't drift from the forward `mapPublicKey` / `mapSignature`.
const PUBLIC_KEY_VARIANT_TO_TYPE: Record<string, NearKeyType> = Object.fromEntries(
  (Object.entries(NEAR_KEY_DESCRIPTORS) as [NearKeyType, { publicKeyVariant: string }][])
    .map(([keyType, d]) => [d.publicKeyVariant, keyType]),
);
const SIGNATURE_VARIANT_TO_TYPE: Record<string, NearKeyType> = Object.fromEntries(
  (Object.entries(NEAR_KEY_DESCRIPTORS) as [NearKeyType, { signatureVariant: string }][])
    .map(([keyType, d]) => [d.signatureVariant, keyType]),
);

const toBytes = (data: number[] | Uint8Array): Uint8Array =>
  data instanceof Uint8Array ? data : Uint8Array.from(data);

/** Single `{ variant: value }` enum pair from a borsh-decoded enum. */
function enumEntry(obj: unknown): [string, any] {
  if (!obj || typeof obj !== "object") {
    throw new Error(`parseSignedDelegate: expected a borsh enum object, got ${typeof obj}`);
  }
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length !== 1) {
    throw new Error(`parseSignedDelegate: expected exactly one enum variant, got ${entries.length}`);
  }
  return entries[0] as [string, any];
}

function unmapPublicKey(decoded: unknown): NearPublicKey {
  const [variant, value] = enumEntry(decoded);
  const keyType = PUBLIC_KEY_VARIANT_TO_TYPE[variant];
  if (!keyType) throw new Error(`parseSignedDelegate: unknown public-key variant "${variant}"`);
  return keyToString(toBytes(value.data), keyType) as NearPublicKey;
}

function unmapAccessKey(decoded: { nonce: NearInteger; permission: unknown }): NearAccessKey {
  const [variant, value] = enumEntry(decoded.permission);
  if (variant === "fullAccess") {
    return { nonce: decoded.nonce, permission: "FullAccess" };
  }
  if (variant === "functionCall") {
    return {
      nonce: decoded.nonce,
      permission: {
        receiverId: value.receiverId,
        methodNames: value.methodNames ?? [],
        allowance: value.allowance ?? null,
      },
    };
  }
  if (variant === "gasKeyFullAccess") {
    return {
      nonce: decoded.nonce,
      permission: "GasKeyFullAccess",
      numNonces: Number(value.numNonces),
      balance: value.balance,
    };
  }
  if (variant === "gasKeyFunctionCall") {
    return {
      nonce: decoded.nonce,
      permission: "GasKeyFunctionCall",
      numNonces: Number(value.gasKeyInfo.numNonces),
      balance: value.gasKeyInfo.balance,
      receiverId: value.functionCall.receiverId,
      methodNames: value.functionCall.methodNames ?? [],
      allowance: value.functionCall.allowance ?? null,
    };
  }
  throw new Error(`parseSignedDelegate: unknown access-key permission "${variant}"`);
}

/** Invert `mapAction` for the ClassicAction variants a delegate can carry. */
function unmapClassicAction(decoded: unknown): NearClassicAction {
  const [variant, value] = enumEntry(decoded);
  switch (variant) {
    case "createAccount":
      return { type: "CreateAccount" };
    case "deployContract":
      return { type: "DeployContract", codeBase64: bytesToBase64(toBytes(value.code)) };
    case "functionCall":
      // Round-trip the args as base64 (byte-perfect); mapAction re-emits
      // argsBase64 verbatim, so args that aren't valid JSON survive intact.
      return {
        type: "FunctionCall",
        methodName: value.methodName,
        argsBase64: bytesToBase64(toBytes(value.args)),
        gas: value.gas,
        deposit: value.deposit,
      };
    case "transfer":
      return { type: "Transfer", deposit: value.deposit };
    case "stake":
      return { type: "Stake", stake: value.stake, publicKey: unmapPublicKey(value.publicKey) };
    case "addKey":
      return {
        type: "AddKey",
        publicKey: unmapPublicKey(value.publicKey),
        accessKey: unmapAccessKey(value.accessKey),
      };
    case "deleteKey":
      return { type: "DeleteKey", publicKey: unmapPublicKey(value.publicKey) };
    case "deleteAccount":
      return { type: "DeleteAccount", beneficiaryId: value.beneficiaryId };
    case "transferToGasKey":
      return {
        type: "TransferToGasKey",
        publicKey: unmapPublicKey(value.publicKey),
        deposit: value.deposit,
      };
    case "withdrawFromGasKey":
      throw new Error(
        "parseSignedDelegate: WithdrawFromGasKey cannot be carried in a delegate action " +
          "(rejected on-chain from protocol 87)",
      );
    default:
      throw new Error(`parseSignedDelegate: cannot parse delegate action variant "${variant}"`);
  }
}

/**
 * What `parseSignedDelegate` accepts. All of these ultimately carry the borsh
 * bytes a wallet's `signDelegateActions` produced (`BorshSerializedSignedDelegate`
 * or a bare base64 string), plus the `{ signedDelegateActions: [...] }` envelope
 * `nearWallet.signDelegateActions` returns and the `{ borshBase64 }` our own
 * `signDelegate` returns.
 */
export type SignedDelegateInput =
  | string
  | { borshSerializedBase64: string }
  | { borshBase64: string }
  | { signedDelegateActions: unknown[] };

export interface ParsedSignedDelegate {
  delegateAction: NearDelegateAction;
  signature: string;
  signatureBytes: Uint8Array;
  borshBase64: string;
}

/** Pull the borsh base64 out of whatever wallet-shaped envelope carried it. */
function extractBorshBase64(input: SignedDelegateInput): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (typeof o.borshSerializedBase64 === "string") return o.borshSerializedBase64;
    if (typeof o.borshBase64 === "string") return o.borshBase64;
    if (Array.isArray(o.signedDelegateActions)) {
      const entries = o.signedDelegateActions;
      if (entries.length !== 1) {
        throw new Error(
          `parseSignedDelegate: expected exactly one signed delegate, got ${entries.length}. ` +
            `Pass a single entry from signedDelegateActions[].`,
        );
      }
      return extractBorshBase64(entries[0] as SignedDelegateInput);
    }
    if ("delegateHash" in o && "signedDelegate" in o) {
      throw new Error(
        "parseSignedDelegate: the legacy { delegateHash, signedDelegate } wallet result is not " +
          "supported — request the borshSerializedBase64 form via WalletFeatures.signDelegateActions.",
      );
    }
  }
  throw new Error(
    "parseSignedDelegate: unrecognized input; expected a base64 string, " +
      "{ borshSerializedBase64 }, { borshBase64 }, or { signedDelegateActions: [entry] }.",
  );
}

/**
 * Turn a wallet-signed NEP-366 delegate into the `{ delegateAction, signature }`
 * shape `relayDelegate` and `actions.signedDelegate` accept — the inverse of
 * `serializeSignedDelegate`. The output is drop-in equal to `signDelegate`'s
 * structured return, so a wallet-relayed delegate needs no hand-normalization.
 */
export function parseSignedDelegate(input: SignedDelegateInput): ParsedSignedDelegate {
  const inputBase64 = extractBorshBase64(input);
  const inputBytes = base64ToBytes(inputBase64);
  let decoded: {
    delegateAction: {
      senderId: string;
      receiverId: string;
      actions: unknown[];
      nonce: NearInteger;
      maxBlockHeight: NearInteger;
      publicKey: unknown;
    };
    signature: unknown;
  };
  try {
    decoded = borshDeserialize(SCHEMA.SignedDelegate, inputBytes) as typeof decoded;
  } catch (e) {
    // Borsh's own errors ("buffer overrun") leak no context — every other bad
    // path here throws a "parseSignedDelegate: …" message, so match that.
    throw new Error(
      `parseSignedDelegate: could not decode a borsh SignedDelegate (invalid or truncated base64): ${
        (e as Error).message
      }`,
    );
  }
  const da = decoded.delegateAction;
  const [sigVariant, sigValue] = enumEntry(decoded.signature);
  if (!SIGNATURE_VARIANT_TO_TYPE[sigVariant]) {
    throw new Error(`parseSignedDelegate: unknown signature variant "${sigVariant}"`);
  }
  const signatureBytes = toBytes(sigValue.data);
  const delegateAction: NearDelegateAction = {
    senderId: da.senderId,
    receiverId: da.receiverId,
    actions: da.actions.map(unmapClassicAction),
    nonce: da.nonce,
    maxBlockHeight: da.maxBlockHeight,
    publicKey: unmapPublicKey(da.publicKey),
  };

  // Borsh's decoder stops as soon as the schema is satisfied and ignores any
  // trailing bytes, so decoding alone can't tell canonical input from a
  // valid-prefix-plus-garbage buffer. Re-serialize the parsed delegate (borsh
  // is canonical, so this reproduces the exact bytes of any well-formed input)
  // and require it to match — this rejects trailing/non-canonical bytes and
  // makes borshBase64 the guaranteed-canonical forward payload.
  const canonical = serializeSignedDelegate(delegateAction, signatureBytes);
  if (canonical.length !== inputBytes.length || canonical.some((b, i) => b !== inputBytes[i])) {
    throw new Error(
      "parseSignedDelegate: input is not canonical NEP-366 borsh — it has trailing or malformed " +
        "bytes after the SignedDelegate",
    );
  }

  return {
    delegateAction,
    // Bare base58, matching signDelegate — mapSignature pairs it with the
    // delegate's publicKey keyType when it re-serializes.
    signature: toBase58(signatureBytes),
    signatureBytes,
    borshBase64: bytesToBase64(canonical),
  };
}
