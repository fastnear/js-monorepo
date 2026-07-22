import {
  decodeNearPrivateKey,
  publicKeyFromPrivate,
  signNep413Message,
} from "@fastnear/utils";
import {
  buildIntentMessage,
  randomNonce,
  toSignedIntent,
  unsignedPayloadParts,
} from "./signing.js";
import {
  INTENTS_CONTRACT_ID,
  type IntentSigner,
  type SignIntentsParams,
  type SignedIntentNep413,
} from "./types.js";

export interface LocalIntentSignerOptions {
  /** The account whose intents this signer authorizes. */
  accountId: string;
  /**
   * A FULL-ACCESS private key for that account ("ed25519:<base58>").
   * NEP-413 forbids FunctionCall-access keys, and the verifier checks the
   * public key is authorized for the account (registered via add_public_key
   * for named accounts, or matching an implicit account id).
   */
  privateKey: string;
}

/**
 * Sign intent messages locally with a raw NEAR key — the server/agent
 * counterpart of createWalletIntentSigner. Keep the private key in
 * server-side secret storage; never ship it to a browser.
 */
export function createLocalIntentSigner({
  accountId,
  privateKey,
}: LocalIntentSignerOptions): IntentSigner {
  if (!accountId) throw new Error("accountId is required");
  // Validates encoding and length up front (throws on malformed keys).
  decodeNearPrivateKey(privateKey);
  const publicKey = publicKeyFromPrivate(privateKey);

  function signParts({
    message,
    nonce,
    recipient,
    callbackUrl,
  }: {
    message: string;
    nonce: Uint8Array;
    recipient: string;
    callbackUrl?: string;
  }): SignedIntentNep413 {
    const { signature } = signNep413Message(
      { message, nonce, recipient, callbackUrl },
      privateKey,
    );
    return toSignedIntent({
      message,
      nonce,
      recipient,
      publicKey,
      signature,
      callbackUrl,
    });
  }

  return {
    async signIntents(params: SignIntentsParams): Promise<SignedIntentNep413> {
      const signerId = params.signerId ?? accountId;
      const message = buildIntentMessage({
        signerId,
        intents: params.intents,
        deadline: params.deadline,
      });
      return signParts({
        message: JSON.stringify(message),
        nonce: params.nonce ?? randomNonce(),
        recipient: params.verifyingContract ?? INTENTS_CONTRACT_ID,
      });
    },

    async signPayload(payload): Promise<SignedIntentNep413> {
      return signParts(unsignedPayloadParts(payload));
    },
  };
}
