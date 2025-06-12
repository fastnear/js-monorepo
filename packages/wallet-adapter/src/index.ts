import {
  SignatureResult,
  WalletTxResult
} from "fastintear";
import {
  canSignWithLAK,
  privateKeyFromRandom,
  publicKeyFromPrivate,
  signHash
} from "@fastnear/utils";
import { sha256 } from "@noble/hashes/sha2";

const DEFAULT_WALLET_DOMAIN = "https://wallet.intear.tech";
const DEFAULT_LOGOUT_BRIDGE_SERVICE = "https://logout-bridge-service.intear.tech";
const STORAGE_KEY = "_intear_wallet_connected_account";
const POPUP_FEATURES = "width=400,height=700";
interface LocalAccount {
  accountId: string;
  publicKey?: string;
}

interface LocalTransaction {
  signerId?: string;
  receiverId: string;
  actions: any[]; // Use 'any' for simplicity
}

export interface SignInResult {
  url?: string;
  accountId?: string;
  error?: string;
}

export interface TransactionResult {
  /** URL to redirect to if needed. */
  url?: string;

  /** Transaction hash if immediately available. */
  hash?: string;

  /** Error message if the transaction failed. */
  error?: string;
}

export interface WalletAdapterConstructor {
  walletUrl?: string;
  targetOrigin?: string;
  onStateUpdate?: (state: any) => void;
  lastState?: any;
  callbackUrl?: string;
}

interface SavedData {
  accounts: LocalAccount[];
  key: string;
  contractId: string;
  methodNames: string[];
  logoutKey: string;
  networkId: string;
}

class IntearAdapterError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "IntearAdapterError";
    if (cause) {
      this.stack += `\nCaused by: ${cause instanceof Error ? cause.stack : String(cause)
        }`;
    }
  }
}

async function generateAuthSignature(
  privateKey: string,
  data: string,
  nonce: number
): Promise<string> {
  const messageBytes = new TextEncoder().encode(nonce.toString() + "|" + data);
  const hashBytes = sha256(messageBytes);

  const signature = signHash(hashBytes, privateKey, { returnBase58: true });
  return signature.toString();
}

function assertLoggedIn(): SavedData {
  if (typeof window === 'undefined') {
    throw new IntearAdapterError("Cannot access localStorage in this environment.");
  }
  const savedDataStr = window.localStorage.getItem(STORAGE_KEY);
  if (!savedDataStr) {
    throw new IntearAdapterError("Not signed in (no data found)");
  }
  try {
    const savedData = JSON.parse(savedDataStr) as SavedData;
    if (!savedData || !savedData.accounts || savedData.accounts.length === 0 || !savedData.key) {
      throw new Error("Invalid saved data structure");
    }
    return savedData;
  } catch (e) {
    console.error("Error parsing saved login data, clearing storage.", e);
    window.localStorage.removeItem(STORAGE_KEY);
    throw new IntearAdapterError("Failed to parse login data, please sign in again.", e);
  }
}

export class WalletAdapter {
  #walletUrl: string;
  #logoutBridgeService: string;
  #onStateUpdate?: (state: any) => void;
  constructor({
    walletUrl = DEFAULT_WALLET_DOMAIN,
    targetOrigin,
    onStateUpdate,
    lastState,
    callbackUrl,
    logoutBridgeService = DEFAULT_LOGOUT_BRIDGE_SERVICE,
  }: WalletAdapterConstructor & {
    logoutBridgeService?: string;
  } = {}) {
    this.#walletUrl = walletUrl;
    this.#logoutBridgeService = logoutBridgeService;
    this.#onStateUpdate = onStateUpdate;
    console.log("Intear Popup WalletAdapter initialized. URL:", this.#walletUrl);
  }


  async signIn({ contractId, methodNames, networkId }: { contractId: string; methodNames?: string[]; networkId: string; }): Promise<{ accountId: string, accounts: LocalAccount[], error?: string }> {
    console.log("WalletAdapter: signIn", { contractId, methodNames, networkId });
    const privateKey = privateKeyFromRandom();

    return new Promise((resolve, reject) => {
      const popup = window.open(`${this.#walletUrl}/connect`, "_blank", POPUP_FEATURES);
      if (!popup) {
        return reject(new IntearAdapterError("Popup was blocked"));
      }

      let done = false;
      const listener = async (event: MessageEvent) => {
        if (event.origin !== new URL(this.#walletUrl).origin) {
          return;
        }
        if (!event.data || !event.data.type) {
          return;
        }

        console.log("Message from connect popup", event.data);
        switch (event.data.type) {
          case "ready": {
            const origin = location.origin || "file://local-html-file";
            const message = JSON.stringify({ origin });
            const nonce = Date.now();
            const signatureString = await generateAuthSignature(privateKey, message, nonce);
            const publicKey = publicKeyFromPrivate(privateKey);
            popup.postMessage(
              {
                type: "signIn",
                data: {
                  contractId: contractId,
                  methodNames: methodNames,
                  publicKey: publicKey,
                  networkId: networkId,
                  nonce,
                  message,
                  signature: signatureString,
                },
              },
              this.#walletUrl
            );
            break;
          }
          case "connected": {
            done = true;
            popup.close();
            window.removeEventListener("message", listener);

            const accounts = event.data.accounts as LocalAccount[];
            if (!accounts || accounts.length === 0) {
              return reject(new IntearAdapterError("No accounts returned from wallet"));
            }
            const functionCallKeyAdded = event.data.functionCallKeyAdded;
            const logoutKey = event.data.logoutKey;

            const dataToSave: SavedData = {
              accounts,
              key: privateKey,
              contractId: functionCallKeyAdded ? contractId : "",
              methodNames: functionCallKeyAdded ? (methodNames ?? []) : [],
              logoutKey: logoutKey,
              networkId: networkId,
            };
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));

            const newState = { accountId: accounts[0].accountId, networkId };
            this.#onStateUpdate?.(newState);

            resolve({ accountId: accounts[0].accountId, accounts });
            break;
          }
          case "error": {
            done = true;
            popup.close();
            window.removeEventListener("message", listener);
            reject(new IntearAdapterError(event.data.message || "Unknown error from wallet popup"));
            break;
          }
        }
      };

      window.addEventListener("message", listener);
      const checkPopupClosed = setInterval(() => {
        if (popup.closed) {
          window.removeEventListener("message", listener);
          clearInterval(checkPopupClosed);
          if (!done) {
            reject(new IntearAdapterError("Sign-in canceled - popup closed by user"));
          }
        }
      }, 100);
    });
  }

  async signOut(): Promise<void> {
    console.log("WalletAdapter: signOut");
    window.localStorage.removeItem(STORAGE_KEY);
    this.#onStateUpdate?.({ accountId: null, networkId: null });
  }

  getState(): { accountId: string | null; networkId: string | null; publicKey?: string | null } {
    try {
      const savedData = assertLoggedIn();
      return {
        accountId: savedData.accounts[0].accountId,
        networkId: savedData.networkId,
        publicKey: publicKeyFromPrivate(savedData.key),
      };
    } catch (e) {
      return { accountId: null, networkId: null, publicKey: null };
    }
  }

  setState(state: any): void {
    console.warn("WalletAdapter: setState called, but state is primarily managed in localStorage for this adapter.");
    this.#onStateUpdate?.(state);
  }

  async sendTransactions({ transactions }: { transactions: LocalTransaction[] }): Promise<WalletTxResult> {
    console.log("WalletAdapter: sendTransactions", { transactions });
    const savedData = assertLoggedIn(); // Throws if not logged in
    const privateKey = savedData.key;
    const accountId = savedData.accounts[0].accountId;
    const networkId = savedData.networkId; // Use saved networkId

    const canSignLocally = transactions.every(
      (tx) => tx.receiverId === savedData.contractId &&
        tx.signerId === accountId &&
        canSignWithLAK(tx.actions)
    );

    return new Promise(async (resolve, reject) => {
      const popup = window.open(`${this.#walletUrl}/send-transactions`, "_blank", POPUP_FEATURES);
      if (!popup) {
        return reject(new IntearAdapterError("Popup was blocked"));
      }

      let done = false;
      const listener = async (event: MessageEvent) => {
        if (event.origin !== new URL(this.#walletUrl).origin) return;
        if (!event.data || !event.data.type) return;

        console.log("Message from send-transactions popup", event.data);
        switch (event.data.type) {
          case "ready": {
            const transactionsString = JSON.stringify(transactions);
            const nonce = Date.now();
            const signatureString = await generateAuthSignature(privateKey, transactionsString, nonce);
            const publicKey = publicKeyFromPrivate(privateKey);
            popup.postMessage(
              {
                type: "signAndSendTransactions",
                data: {
                  transactions: transactionsString,
                  accountId: accountId,
                  publicKey: publicKey,
                  nonce: nonce,
                  signature: signatureString,
                },
              },
              this.#walletUrl
            );
            break;
          }
          case "sent": {
            done = true;
            popup.close();
            window.removeEventListener("message", listener);
            resolve({ outcomes: event.data.outcomes });
            break;
          }
          case "error": {
            done = true;
            popup.close();
            window.removeEventListener("message", listener);
            reject(new IntearAdapterError(event.data.message || "Unknown error from send-transactions popup"));
            break;
          }
        }
      };

      window.addEventListener("message", listener);
      const checkPopupClosed = setInterval(() => {
        if (popup.closed) {
          window.removeEventListener("message", listener);
          clearInterval(checkPopupClosed);
          if (!done) {
            reject(new IntearAdapterError("Transaction canceled - popup closed by user"));
          }
        }
      }, 100);
    });
  }

  async signMessage({ message, nonce, recipient, callbackUrl, state }: { message: string, nonce: Buffer, recipient: string, callbackUrl?: string, state?: string }): Promise<SignatureResult> {
    console.log("WalletAdapter: signMessage", { message, nonce, recipient });
    const savedData = assertLoggedIn();
    const privateKey = savedData.key;
    const accountId = savedData.accounts[0].accountId;

    return new Promise(async (resolve, reject) => {
      const popup = window.open(`${this.#walletUrl}/sign-message`, "_blank", POPUP_FEATURES);
      if (!popup) {
        return reject(new IntearAdapterError("Popup was blocked"));
      }

      let done = false;
      const listener = async (event: MessageEvent) => {
        if (event.origin !== new URL(this.#walletUrl).origin) return;
        if (!event.data || !event.data.type) return;

        console.log("Message from sign-message popup", event.data);
        switch (event.data.type) {
          case "ready": {
            const signMessageString = JSON.stringify({
              message,
              recipient,
              nonce: Array.from(nonce),
              callbackUrl,
              state,
            });
            const authNonce = Date.now();
            const signatureString = await generateAuthSignature(privateKey, signMessageString, authNonce);
            const publicKey = publicKeyFromPrivate(privateKey);
            popup.postMessage(
              {
                type: "signMessage",
                data: {
                  message: signMessageString,
                  accountId: accountId,
                  publicKey: publicKey,
                  nonce: authNonce,
                  signature: signatureString,
                },
              },
              this.#walletUrl
            );
            break;
          }
          case "signed": {
            done = true;
            popup.close();
            window.removeEventListener("message", listener);
            const signatureData = event.data.signature;
            try {
              resolve({
                accountId: signatureData.accountId,
                publicKey: signatureData.publicKey,
                signature: signatureData.signature,
              });
            } catch (e) {
              reject(new IntearAdapterError("Failed to process signature from wallet", e));
            }
            break;
          }
          case "error": {
            done = true;
            popup.close();
            window.removeEventListener("message", listener);
            reject(new IntearAdapterError(event.data.message || "Unknown error from sign-message popup"));
            break;
          }
        }
      };

      window.addEventListener("message", listener);
      const checkPopupClosed = setInterval(() => {
        if (popup.closed) {
          window.removeEventListener("message", listener);
          clearInterval(checkPopupClosed);
          if (!done) {
            reject(new IntearAdapterError("Message signing canceled - popup closed by user"));
          }
        }
      }, 100);
    });
  }

  destroy() {
    console.log("Intear Popup WalletAdapter destroyed.");
  }
}

export default WalletAdapter;
