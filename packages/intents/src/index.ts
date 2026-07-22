/**
 * @fastnear/intents — NEAR Intents (intents.near) for end users and agents:
 * a zero-dependency 1Click swap client, NEP-413 intent signing (wallet and
 * local-key), verifier deposit/withdraw/balance helpers, and a solver-relay
 * JSON-RPC client.
 *
 * Browser-safe: this root entry never touches private keys. The local-key
 * signer lives in @fastnear/intents/node.
 */
export * from "./types.js";
export * from "./one-click.js";
export * from "./signing.js";
export * from "./verifier.js";
export * from "./relay.js";
