// @todo low-priority: i thought we were using meer-api-js and @meer-js/ packages
//    seems to be working fine. will likely compile down better and might mean the tsup config
//    can be simplified in terms of which modules it thinks is external and stuff, anyway.
import { connect, KeyPair } from "near-api-js";
import { EMeteorWalletSignInType, MeteorWallet } from "@fastnear/meteorwallet-sdk";
import { mapActionForWalletSelector } from "../utils/actionToWalletSelector.js";
import { PublicKey } from "@near-js/crypto";
import { keyStores } from "near-api-js";

async function createMeteorWalletInstance({ networkId = "mainnet" }): Promise<MeteorWallet> {
  const keyStore = new keyStores.BrowserLocalStorageKeyStore(
    window.localStorage,
    "_meteor_wallet"
  );

  const near = await connect({
    keyStore,
    networkId,
    nodeUrl: networkId === "mainnet"
      ? "https://rpc.mainnet.near.org"
      : "https://rpc.testnet.near.org",
  });

  return new MeteorWallet({ near, appKeyPrefix: "near_app" });
}

export function createMeteorAdapter() {
  return {
    async signIn({ networkId, contractId, publicKey }) {
      const parsedPublicKey = PublicKey.from(publicKey);
      const keyPair = KeyPair.fromString(parsedPublicKey.toString());
      const wallet = await createMeteorWalletInstance({ networkId });

      const response = await wallet.requestSignIn({
        contract_id: contractId,
        type: EMeteorWalletSignInType.ALL_METHODS,
        keyPair,
      });

      if (!response?.success || !response.payload?.accountId) {
        throw new Error("Meteor Wallet sign-in failed");
      }

      return {
        state: {
          accountId: response.payload.accountId,
          publicKey: parsedPublicKey.toString(),
          networkId,
        },
      };
    },

    async sendTransactions({ state, transactions }) {
      if (!state?.accountId) {
        throw new Error("Not signed in");
      }

      const wallet = await createMeteorWalletInstance({
        networkId: state.networkId,
      });

      try {
        const response = await wallet.requestSignTransactions({
          transactions: transactions.map(({ signerId, receiverId, actions }) => {
            if (signerId && signerId !== state.accountId) {
              throw new Error("Invalid signer");
            }
            return {
              signerId: state.accountId,
              receiverId,
              actions: actions.map(mapActionForWalletSelector),
            };
          }),
        });

        return { outcomes: response };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        if (
          errorMessage === "User cancelled the action" ||
          errorMessage === "User closed the window before completing the action"
        ) {
          return { rejected: true };
        }
        console.error("Transaction error:", error);
        throw new Error(errorMessage);
      }
    },
  };
}
