import {
  fromBase58,
  privateKeyFromRandom,
  publicKeyFromPrivate,
  signHash
} from "@fastnear/utils";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { SignatureResult, WalletTxResult } from "./near";

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
  logoutBridgeService?: string;
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

type WsClientMessage = {
  Auth: {
    network: string; // e.g., "mainnet", "testnet"
    account_id: string;
    app_public_key: string;
    nonce: number;
    signature: string;
  };
};

type LogoutInfo = {
  nonce: number;
  signature: string;
  caused_by: "User" | "App";
};

type WsServerMessage =
  | { Error: { message: string } }
  | { Success: { message: string } }
  | {
    LoggedOut: {
      network: string;
      account_id: string;
      app_public_key: string;
      logout_info: LogoutInfo;
    };
  };

type SessionStatus = "Active" | { LoggedOut: LogoutInfo };


class LogoutWebSocket {
  private static instance: LogoutWebSocket | null = null;
  private ws: WebSocket | null = null;
  private network: string;
  private accountId: string;
  private appPrivateKey: string;
  private userLogoutPublicKey: string;
  private logoutBridgeServiceUrl: string;
  private intentionallyClosed = false;
  private authFailedPermanently = false;
  private logger: Console;

  private constructor(
    network: string,
    accountId: string,
    appPrivateKey: string,
    userLogoutPublicKey: string,
    logoutBridgeServiceUrl: string,
    logger: Console
  ) {
    this.network = network;
    this.accountId = accountId;
    this.appPrivateKey = appPrivateKey;
    this.userLogoutPublicKey = userLogoutPublicKey;
    this.logoutBridgeServiceUrl = logoutBridgeServiceUrl;
    this.logger = logger;
  }

  private async connect() {
    if (this.authFailedPermanently) {
      this.logger.warn("LogoutWebSocket: Permanent authentication failure. Not attempting to connect.");
      // Ensure the static instance is cleared if we are in this state and connect is somehow called.
      if (LogoutWebSocket.instance === this) {
        LogoutWebSocket.instance = null;
      }
      return;
    }
    const wsUrl = this.logoutBridgeServiceUrl
      .replace("https://", "wss://")
      .replace("http://", "ws://");
    this.ws = new WebSocket(`${wsUrl}/api/subscribe`);

    this.ws.onopen = async () => {
      if (!this.ws) {
        return;
      }

      const nonce = Date.now();
      const messageText = `subscribe|${nonce}`;
      const messageBytes = new TextEncoder().encode(messageText);

      const appPublicKeyString = publicKeyFromPrivate(this.appPrivateKey);
      const signatureBase58 = signHash(messageBytes, this.appPrivateKey, { returnBase58: true }) as string;
      const signatureString = `ed25519:${signatureBase58}`;

      const authMessage: WsClientMessage = {
        Auth: {
          network: this.network,
          account_id: this.accountId,
          app_public_key: appPublicKeyString,
          nonce,
          signature: signatureString,
        },
      };

      this.ws.send(JSON.stringify(authMessage));
    };

    this.ws.onmessage = async (event) => {
      const message = JSON.parse(event.data as string) as WsServerMessage;

      if ("Success" in message) {
        this.logger.log("LogoutWebSocket:", message.Success.message);
      } else if ("Error" in message) {
        this.logger.error("LogoutWebSocket error:", message.Error.message);
        if (message.Error.message.toLowerCase().includes("invalid signature")) {
          this.logger.error(
            "LogoutWebSocket: Authentication failed with 'Invalid signature'. Stopping reconnection attempts for this instance."
          );
          this.authFailedPermanently = true;
          this.intentionallyClosed = true; // Signal that this closure is intentional to prevent reconnect
          this.ws?.close(); // Close the WebSocket connection
        }
      } else if ("LoggedOut" in message) {
        const { logout_info: logoutInfo } = message.LoggedOut;
        this.logger.log("LogoutWebSocket: Received logout notification:", logoutInfo);

        if (
          logoutInfo.nonce > Date.now() ||
          logoutInfo.nonce < Date.now() - 1000 * 60 * 5 // 5 minutes tolerance
        ) {
          this.logger.error("LogoutWebSocket: Invalid logout nonce:", logoutInfo.nonce);
          return;
        }

        const appPublicKeyString = publicKeyFromPrivate(this.appPrivateKey);
        const verifyMessageText = `logout|${logoutInfo.nonce}|${this.accountId}|${appPublicKeyString}`;
        const verifyMessageBytes = new TextEncoder().encode(verifyMessageText);
        const hashToVerifyBytes = sha256(verifyMessageBytes);

        const sigParts = logoutInfo.signature.split(":");
        if (sigParts.length !== 2 || (sigParts[0] !== "ed25519" && sigParts[0] !== "secp256k1")) {
          this.logger.error("LogoutWebSocket: Invalid signature format:", logoutInfo.signature);
          return;
        }
        const sigData = sigParts[1];
        const signatureBytes = fromBase58(sigData);

        let effectiveVerifyKey: string;
        if (logoutInfo.caused_by === "User") {
          effectiveVerifyKey = this.userLogoutPublicKey;
        } else if (logoutInfo.caused_by === "App") {
          effectiveVerifyKey = appPublicKeyString;
        } else {
          this.logger.error("LogoutWebSocket: Unknown logout cause:", logoutInfo.caused_by);
          return;
        }

        // Convert effectiveVerifyKey string (e.g., "ed25519:...") to Uint8Array
        let publicKeyBytes: Uint8Array;
        const base58PublicKey = effectiveVerifyKey.substring("ed25519:".length);
            publicKeyBytes = fromBase58(base58PublicKey);
        
        const isValid = ed25519.verify(signatureBytes, verifyMessageBytes, publicKeyBytes);

        if (!isValid) {
          this.logger.error("LogoutWebSocket: Invalid logout signature");
          return;
        }

        this.logger.log(
          "LogoutWebSocket: Valid logout message received. Clearing storage and reloading."
        );
        window.localStorage.removeItem(STORAGE_KEY);
        this.intentionallyClosed = true;
        this.close();
        window.location.reload();
      }
    };

    this.ws.onclose = () => {
      this.logger.log("LogoutWebSocket: Connection closed.");
      // If auth failed permanently for this instance, OR if it was intentionally closed for other reasons,
      // do not attempt to reconnect.
      if (this.authFailedPermanently || this.intentionallyClosed) {
        // If this instance is the current static instance, nullify it.
        // This handles the case where an auth failure leads to closure.
        if (LogoutWebSocket.instance === this) {
          LogoutWebSocket.instance = null;
        }
      } else {
        this.logger.log("LogoutWebSocket: Attempting to reconnect in 500ms...");
        setTimeout(() => this.connect(), 500);
      }
    };

    this.ws.onerror = (error) => {
      this.logger.error("LogoutWebSocket: Error:", error);
    };
  }

  public static initialize(
    network: string,
    accountId: string,
    appPrivateKey: string,
    userLogoutPublicKey: string,
    logoutBridgeServiceUrl: string,
    logger: Console
  ): LogoutWebSocket {
    if (LogoutWebSocket.instance) {
      const inst = LogoutWebSocket.instance;
      if (
        inst.network === network &&
        inst.accountId === accountId &&
        inst.appPrivateKey === appPrivateKey && // This is dataToSave.key
        inst.userLogoutPublicKey === userLogoutPublicKey &&
        inst.logoutBridgeServiceUrl === logoutBridgeServiceUrl &&
        !inst.authFailedPermanently // Don't reuse if previously failed auth
      ) {
        // Instance exists, parameters match, and not in a failed state
        return inst;
      } else {
        // Parameters differ, or previous instance failed auth. Close old and create new.
        inst.logger.log(
          "LogoutWebSocket: Re-initializing due to changed parameters or previous auth failure."
        );
        inst.close(); // This sets intentionallyClosed and onclose will nullify LogoutWebSocket.instance
        LogoutWebSocket.instance = null; // Explicitly nullify here to be sure for immediate recreation
      }
    }

    // Create and connect new instance
    LogoutWebSocket.instance = new LogoutWebSocket(
      network,
      accountId,
      appPrivateKey,
      userLogoutPublicKey,
      logoutBridgeServiceUrl,
      logger
    );
    LogoutWebSocket.instance.connect(); // Connect the new instance
    return LogoutWebSocket.instance;
  }

  public static getInstance(): LogoutWebSocket | null {
    return LogoutWebSocket.instance;
  }

  public close() {
    if (this.ws) {
      this.intentionallyClosed = true;
      this.ws.close();
    }
    LogoutWebSocket.instance = null;
  }
}


async function generateAuthSignature(
  privateKey: string,
  data: string,
  nonce: number
): Promise<string> {
  const messageToSign = nonce.toString() + "|" + data;
  const messageBytes = new TextEncoder().encode(messageToSign);
  const hashBytes = sha256(messageBytes);

  const signatureBase58 = signHash(hashBytes, privateKey, { returnBase58: true }) as string;

  return `ed25519:${signatureBase58}`;
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
  }: WalletAdapterConstructor) {
    this.#walletUrl = walletUrl;
    this.#logoutBridgeService = logoutBridgeService;
    this.#onStateUpdate = onStateUpdate;
    console.log("Intear Popup WalletAdapter initialized. URL:", this.#walletUrl);
    if (typeof window !== 'undefined') {
      this.initializeSession().catch(err => {
        console.error("Error during initial session initialization:", err);
      });
    }
  }

  async signIn({ contractId, methodNames, networkId }: { contractId?: string; methodNames?: string[]; networkId: string; }): Promise<{ accountId: string, accounts: LocalAccount[], privateKey?: string, publicKey?: string, error?: string }> {
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
              contractId: functionCallKeyAdded && contractId ? contractId : "",
              methodNames: functionCallKeyAdded ? (methodNames ?? []) : [],
              logoutKey: logoutKey,
              networkId: networkId,
            };
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));

            const newState = { accountId: accounts[0].accountId, networkId };
            this.#onStateUpdate?.(newState);

            // Ensure any old WebSocket instance is closed before initializing a new one
            LogoutWebSocket.getInstance()?.close();

            LogoutWebSocket.initialize(
              dataToSave.networkId,
              dataToSave.accounts[0].accountId,
              dataToSave.key, // App's LAK private key (this is the appPrivateKey for WS)
              dataToSave.logoutKey, // User's main logout public key from wallet
              this.#logoutBridgeService,
              console
            );

            resolve({
              accountId: accounts[0].accountId,
              accounts,
              privateKey: dataToSave.key,
              publicKey: publicKeyFromPrivate(dataToSave.key)
            });
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
    const savedData = (() => {
      try {
        return assertLoggedIn();
      } catch {
        return null;
      }
    })();

    LogoutWebSocket.getInstance()?.close();

    if (savedData) {
      try {
        const accountId = savedData.accounts[0].accountId;
        const appPrivateKey = savedData.key;
        const appPublicKeyString = publicKeyFromPrivate(appPrivateKey);
        const networkId = savedData.networkId;
        const nonce = Date.now();

        const messageText = `logout|${nonce}|${accountId}|${appPublicKeyString}`;
        const messageBytes = new TextEncoder().encode(messageText);
        const hashBytes = sha256(messageBytes);
        const signatureBase58 = signHash(hashBytes, appPrivateKey, { returnBase58: true }) as string;
        const signatureString = `ed25519:${signatureBase58}`;

        const response = await fetch(`${this.#logoutBridgeService}/api/logout_app/${networkId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: accountId,
            app_public_key: appPublicKeyString,
            nonce,
            signature: signatureString,
          }),
        });
        if (!response.ok) {
          console.error("WalletAdapter: Failed to notify bridge service of logout:", await response.text());
        } else {
          console.log("WalletAdapter: Successfully notified bridge service of logout");
        }
      } catch (e) {
        console.error("WalletAdapter: Error during bridge service logout notification:", e);
      }
    }

    window.localStorage.removeItem(STORAGE_KEY);
    this.#onStateUpdate?.({ accountId: null, networkId: null, publicKey: null });
  }

  // Consider calling this method once when the adapter is instantiated or app loads.
  // For now, getState will also handle this initialization if needed.
  async initializeSession(): Promise<void> {
    let savedData: SavedData;

    try {
      savedData = assertLoggedIn();
    } catch (e) {
      if (e instanceof IntearAdapterError && e.message.includes("Not signed in")) {
      } else {
        console.error("WalletAdapter: Error asserting login state:", e);
      }
      LogoutWebSocket.getInstance()?.close();
      return; 
    }

    // If assertLoggedIn succeeded, savedData is available. Proceed to check session.
    try {
      const accountId = savedData.accounts[0].accountId;
      const appPrivateKey = savedData.key;
      const appPublicKeyString = publicKeyFromPrivate(appPrivateKey);
      const networkId = savedData.networkId;
      const nonce = Date.now();

      const messageText = `check|${nonce}`;
      const messageBytes = new TextEncoder().encode(messageText);
      const signatureBase58 = signHash(messageBytes, appPrivateKey, { returnBase58: true }) as string;
      const signatureString = `ed25519:${signatureBase58}`;

      let sessionConfirmedActive = false;

      try {
        const response = await fetch(
          `${this.#logoutBridgeService}/api/check_logout/${networkId}/${accountId}/${appPublicKeyString}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nonce, signature: signatureString }),
          }
        );

        if (response.ok) {
          const status = (await response.json()) as SessionStatus;
          if (status === "Active") {
            sessionConfirmedActive = true;
          } else { // LoggedOut or other non-Active status from bridge
            const logoutInfo = (status as { LoggedOut: LogoutInfo }).LoggedOut;
            console.log("WalletAdapter: User session logged out per bridge check.", logoutInfo);

            const verifyMessageText = `logout|${logoutInfo.nonce}|${accountId}|${appPublicKeyString}`;
            const verifyMessageBytes = new TextEncoder().encode(verifyMessageText);
            const hashToVerifyBytes = sha256(verifyMessageBytes);
            const sigParts = logoutInfo.signature.split(":");

            if (sigParts.length === 2 && (sigParts[0] === "ed25519" || sigParts[0] === "secp256k1")) {
              const sigData = sigParts[1];
              const signatureBytesToVerify = fromBase58(sigData);
              let effectiveVerifyKey: string;

              if (logoutInfo.caused_by === "User") {
                effectiveVerifyKey = savedData.logoutKey;
              } else if (logoutInfo.caused_by === "App") {
                effectiveVerifyKey = appPublicKeyString;
              } else {
                console.error("WalletAdapter: Unknown logout cause from bridge check:", logoutInfo.caused_by);
                LogoutWebSocket.getInstance()?.close(); // Ensure WS is closed
                return; // Do not proceed to initialize WS
              }

              const base58PublicKeyForBridge = effectiveVerifyKey.substring("ed25519:".length);
              const publicKeyBytesForBridge = fromBase58(base58PublicKeyForBridge);

              const isValid = ed25519.verify(signatureBytesToVerify, verifyMessageBytes, publicKeyBytesForBridge);
              if (isValid) {
                console.log("WalletAdapter: Valid remote logout. Clearing local session.");
                window.localStorage.removeItem(STORAGE_KEY);
                this.#onStateUpdate?.({ accountId: null, networkId: null, publicKey: null });
              } else {
                console.error("WalletAdapter: Invalid signature in remote logout notification. Local data not cleared based on this.");
              }
            } else {
              console.error("WalletAdapter: Invalid signature format in remote logout notification. Local data not cleared.");
            }
            LogoutWebSocket.getInstance()?.close(); // Ensure WS closed if session not active
          }
        } else { // fetch response not OK
          console.error("WalletAdapter: Failed to check logout status with bridge:", await response.text());
          LogoutWebSocket.getInstance()?.close(); // If bridge check fails, close WS
        }
      } catch (fetchError) { // Error during the fetch call itself
        console.error("WalletAdapter: Network error during bridge service logout check:", fetchError);
        LogoutWebSocket.getInstance()?.close(); // If fetch itself fails, close WS
      }

      if (sessionConfirmedActive) {
        LogoutWebSocket.initialize(
            savedData.networkId,
            savedData.accounts[0].accountId,
            savedData.key,
            savedData.logoutKey,
            this.#logoutBridgeService,
            console
        );
      } else {
        LogoutWebSocket.getInstance()?.close(); // Ensure WS closed if not active
      }

    } catch (e) {
      // This outer try-catch handles unexpected errors during the main logic (after savedData is confirmed).
      console.error("WalletAdapter: Unexpected error during session initialization logic:", e);
      LogoutWebSocket.getInstance()?.close(); // Final safety net
    }
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
