import * as near from "@fastnear/api";

/**
 * Configure for mainnet. Call this in server components before near.view().
 * Safe to call multiple times — it's a no-op if already configured.
 */
export function configureMainnet() {
  near.config({ networkId: "mainnet" });
}

/**
 * Configure for testnet. Call this in server components before near.view().
 */
export function configureTestnet() {
  near.config({ networkId: "testnet" });
}

export { near };
