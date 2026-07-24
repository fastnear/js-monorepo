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

export interface NearAccessKey {
  nonce?: NearInteger;
  permission: "FullAccess" | "FunctionCall" | NearFunctionCallPermission;
  receiverId?: string;
  methodNames?: string[];
  allowance?: NearInteger | null;
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

export type NearClassicAction =
  | NearCreateAccountAction
  | NearDeployContractAction
  | NearFunctionCallAction
  | NearTransferAction
  | NearStakeAction
  | NearAddKeyAction
  | NearDeleteKeyAction
  | NearDeleteAccountAction;

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

export type NearAction = NearClassicAction | NearSignedDelegateAction;

export interface PlainTransaction {
  signerId: string;
  publicKey: NearPublicKey;
  nonce: NearInteger;
  receiverId: string;
  blockHash: string;
  actions: NearAction[];
}

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

export function mapTransaction(jsonTransaction: PlainTransaction) {
  return {
    signerId: jsonTransaction.signerId,
    publicKey: mapPublicKey(jsonTransaction.publicKey),
    nonce: BigInt(jsonTransaction.nonce),
    receiverId: jsonTransaction.receiverId,
    blockHash: fromBase58(jsonTransaction.blockHash),
    actions: jsonTransaction.actions.map(mapAction),
  };
}

export function serializeTransaction(jsonTransaction: PlainTransaction) {
  const transaction = mapTransaction(jsonTransaction);
  return borshSerialize(SCHEMA.Transaction, transaction);
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

  return borshSerialize(SCHEMA.SignedTransaction, plainSignedTransaction);
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
      const permission = action.accessKey.permission;
      if (
        permission !== "FullAccess" &&
        permission !== "FunctionCall" &&
        (permission == null || typeof permission !== "object")
      ) {
        throw new Error(`Unsupported access-key permission: ${String(permission)}`);
      }
      const functionCall =
        typeof permission === "object" ? permission : action.accessKey;
      if (
        permission !== "FullAccess" &&
        typeof functionCall.receiverId !== "string"
      ) {
        throw new Error("Function-call access keys require a receiverId");
      }

      return {
        addKey: {
          publicKey: mapPublicKey(action.publicKey),
          accessKey: {
            nonce: BigInt(action.accessKey.nonce ?? 0),
            permission:
              permission === "FullAccess"
                ? { fullAccess: {} }
                : {
                  functionCall: {
                    allowance: functionCall.allowance != null
                      ? toNearAmount(functionCall.allowance)
                      : null,
                    receiverId: functionCall.receiverId,
                    methodNames: functionCall.methodNames ?? [],
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
      const delegate = action.delegateAction;
      if (action.publicKey && action.publicKey !== delegate.publicKey) {
        throw new Error(
          "SignedDelegate publicKey must match delegateAction.publicKey",
        );
      }
      return {
        signedDelegate: {
          delegateAction: {
            senderId: delegate.senderId,
            receiverId: delegate.receiverId,
            actions: delegate.actions.map(mapAction),
            nonce: BigInt(delegate.nonce),
            maxBlockHeight: BigInt(delegate.maxBlockHeight),
            publicKey: mapPublicKey(delegate.publicKey),
          },
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

/** Map a flat DelegateAction into the borsh chain-schema shape. */
function mapDelegateAction(delegate: NearDelegateAction) {
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
  throw new Error(`parseSignedDelegate: unknown access-key permission "${variant}"`);
}

/** Invert `mapAction` for the eight ClassicAction variants a delegate can carry. */
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
