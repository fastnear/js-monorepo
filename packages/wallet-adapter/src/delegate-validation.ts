import { deserialize, serialize } from "@fastnear/borsh";
import {
  base64ToBytes,
  bytesToBase64,
  SCHEMA,
  sha256,
} from "@fastnear/utils";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";

export interface SignedDelegateExpectation {
  senderId: string;
  receiverId: string;
  actions: unknown[];
  maxBlockHeight: bigint;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function readBytes(value: unknown, key: string, length: number): Uint8Array | null {
  if (!value || typeof value !== "object") return null;
  const variant = (value as Record<string, unknown>)[key];
  if (!variant || typeof variant !== "object") return null;
  const data = (variant as { data?: unknown }).data;
  if (!Array.isArray(data) && !(data instanceof Uint8Array)) return null;
  const bytes = Uint8Array.from(data as ArrayLike<number>);
  return bytes.length === length ? bytes : null;
}

function verifySignature(signedDelegate: any): boolean {
  const delegateBytes = new Uint8Array(
    serialize(SCHEMA.DelegateAction, signedDelegate.delegateAction),
  );
  const digest = sha256(delegateBytes);
  const edPublicKey = readBytes(signedDelegate.delegateAction?.publicKey, "ed25519Key", 32);
  const edSignature = readBytes(signedDelegate.signature, "ed25519Signature", 64);
  if (edPublicKey && edSignature) {
    return ed25519.verify(edSignature, digest, edPublicKey);
  }

  const secpPublicKey = readBytes(
    signedDelegate.delegateAction?.publicKey,
    "secp256k1Key",
    64,
  );
  const secpSignature = readBytes(signedDelegate.signature, "secp256k1Signature", 65);
  if (secpPublicKey && secpSignature) {
    const uncompressedPublicKey = new Uint8Array(65);
    uncompressedPublicKey[0] = 4;
    uncompressedPublicKey.set(secpPublicKey, 1);
    return secp256k1.verify(
      secpSignature.subarray(0, 64),
      digest,
      uncompressedPublicKey,
      { prehash: false },
    );
  }

  return false;
}

/** Decode, authenticate, and bind a wallet response to the exact request. */
export function validateSignedDelegate(
  encoded: string,
  expected: SignedDelegateExpectation,
): void {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("signed delegate is not canonical base64");
  }

  const bytes = base64ToBytes(encoded);
  if (bytes.length === 0 || bytesToBase64(bytes) !== encoded) {
    throw new Error("signed delegate is not canonical base64");
  }

  const signedDelegate = deserialize(SCHEMA.SignedDelegate, bytes) as any;
  const canonical = new Uint8Array(serialize(SCHEMA.SignedDelegate, signedDelegate));
  if (!bytesEqual(bytes, canonical)) {
    throw new Error("signed delegate contains trailing or non-canonical data");
  }

  const delegate = signedDelegate.delegateAction;
  if (
    delegate?.senderId !== expected.senderId ||
    delegate?.receiverId !== expected.receiverId ||
    delegate?.maxBlockHeight !== expected.maxBlockHeight ||
    typeof delegate?.nonce !== "bigint" ||
    delegate.nonce <= 0n ||
    !Array.isArray(delegate.actions) ||
    delegate.actions.length !== expected.actions.length
  ) {
    throw new Error("signed delegate does not match the requested delegate action");
  }

  for (let index = 0; index < expected.actions.length; index += 1) {
    const actualAction = new Uint8Array(
      serialize(SCHEMA.ClassicAction, delegate.actions[index]),
    );
    const expectedAction = new Uint8Array(
      serialize(SCHEMA.ClassicAction, expected.actions[index]),
    );
    if (!bytesEqual(actualAction, expectedAction)) {
      throw new Error("signed delegate actions do not match the request");
    }
  }

  if (!verifySignature(signedDelegate)) {
    throw new Error("signed delegate signature is invalid");
  }
}
