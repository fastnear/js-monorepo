import {
  binary_to_base58 as toBase58,
  base58_to_binary as fromBase58,
} from "base58-js";
import {
  encode as JsBase64Encode,
  decode as JsBase64Decode,
  fromUint8Array as JsBase64FromUint8Array,
  toUint8Array as JsBase64ToUint8Array
} from 'js-base64';
import { storage } from "./storage.js";

export { toBase58, fromBase58 };

export function toHex(data: Uint8Array): string {
  return Array.from(data)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2) throw new Error('Hex string must be even length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i/2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function base64ToBytes(b64Val: string): Uint8Array {
  return JsBase64ToUint8Array(b64Val);
}

export function bytesToBase64(bytesArr: Uint8Array): string {
  return JsBase64FromUint8Array(bytesArr);
}

export function toBase64(strVal: string) {
  try {
    return JsBase64Encode(strVal);
  } catch (e) {
    console.error('Issue base64 encoding', e);
    return null;
  }
}

export function fromBase64(strVal: string) {
  try {
    return JsBase64Decode(strVal);
  } catch (e) {
    console.error('Issue base64 decoding', e);
    return null;
  }
}

// NEAR unit math lives in the dependency-free ./units.js so it can be pulled
// into size-sensitive bundles without dragging misc's storage/codec imports.
export { convertUnit } from "./units.js";

export function lsSet(key: string, value: any) {
  storage.set(key, value);
}

export function lsGet(key: string): any {
  return storage.get(key);
}

export function deepCopy(obj: any) {
  return JSON.parse(JSON.stringify(obj));
}

export function tryParseJson(...args: any[]) {
  try {
    return JSON.parse(args[0]);
  } catch {
    if (args.length > 1) {
      return args[1];
    }
    return args[0];
  }
}

export function parseJsonFromBytes(bytes: Uint8Array) {
  try {
    const decoder = new TextDecoder();
    return JSON.parse(
      decoder.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    );
  } catch (e) {
    try {
      return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    } catch (e) {
      return bytes;
    }
  }
}

/**
 * NEP-413 standard message payload for wallet signing.
 */
export interface NEP413Message {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string | null;
  state?: string | null;
}

export function canSignWithLAK(
  actions: ReadonlyArray<{
    type: string;
    deposit?: string | number | bigint;
  }>,
) {
  return (
    actions.length === 1 &&
    actions[0].type === "FunctionCall" &&
    BigInt(actions[0]?.deposit ?? "0") === 0n
  );
}
