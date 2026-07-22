// Free NEAR Intents smoke: local NEP-413 signing round-trip plus live,
// keyless, zero-commitment reads against the hosted 1Click API (and an
// optional solver-relay probe). Never moves funds and needs no credentials.
//
// Usage:
//   yarn build:intents-smoke-deps && node scripts/smoke-intents-dry.mjs
//   node scripts/smoke-intents-dry.mjs --offline   # skip network probes
import process from "node:process";

import {
  base64ToBytes,
  fromBase58,
  privateKeyFromRandom,
  verifyNep413Signature,
} from "@fastnear/utils";
import {
  createOneClickClient,
  createSolverRelayClient,
} from "@fastnear/intents";
import { createLocalIntentSigner } from "@fastnear/intents/node";

const offline = process.argv.includes("--offline");
const failures = [];
const note = (label, detail) => console.log(`✓ ${label}${detail ? ` — ${detail}` : ""}`);
const warn = (label, detail) => console.log(`⚠ ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label, error) => {
  failures.push(label);
  console.error(`✗ ${label}`);
  console.error(error);
};

// 1. Local signing round-trip: the exact bytes intents.near would verify.
try {
  const privateKey = privateKeyFromRandom();
  const signer = createLocalIntentSigner({
    accountId: "smoke.near",
    privateKey,
  });
  const signed = await signer.signIntents({
    intents: [
      {
        intent: "token_diff",
        diff: { "nep141:usdc.near": "-1000000", "nep141:usdt.near": "1000000" },
      },
    ],
  });

  if (signed.standard !== "nep413") throw new Error("wrong standard");
  if (signed.payload.recipient !== "intents.near") throw new Error("wrong recipient");
  if (!signed.signature.startsWith("ed25519:")) {
    throw new Error(`signature not re-encoded: ${signed.signature.slice(0, 16)}`);
  }
  const verified = verifyNep413Signature({
    publicKey: signed.public_key,
    signature: fromBase58(signed.signature.slice("ed25519:".length)),
    message: signed.payload.message,
    nonce: base64ToBytes(signed.payload.nonce),
    recipient: signed.payload.recipient,
  });
  if (!verified) throw new Error("NEP-413 signature failed verification");
  note("local NEP-413 intent signing round-trip", "MultiPayload verified");
} catch (error) {
  fail("local NEP-413 intent signing round-trip", error);
}

if (!offline) {
  const oneClick = createOneClickClient();

  // 2. Live token discovery (free, keyless).
  let tokens = [];
  try {
    tokens = await oneClick.tokens();
    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new Error("empty token list");
    }
    const wnear = tokens.find((token) => token.assetId === "nep141:wrap.near");
    if (!wnear) throw new Error("nep141:wrap.near missing from /v0/tokens");
    note("1Click GET /v0/tokens", `${tokens.length} assets, wrap.near present`);
  } catch (error) {
    fail("1Click GET /v0/tokens", error);
  }

  // 3. Live dry-run quote (free preview: no deposit address, no commitment).
  try {
    const usd = tokens.find(
      (token) => token.blockchain === "near" && token.symbol === "USDC",
    );
    const destination = usd ?? tokens.find((token) => token.assetId !== "nep141:wrap.near");
    const quote = await oneClick.quote({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: "nep141:wrap.near",
      destinationAsset: destination.assetId,
      amount: "1000000000000000000000000", // 1 wNEAR
      depositType: "ORIGIN_CHAIN",
      refundTo: "smoke.near",
      refundType: "ORIGIN_CHAIN",
      recipient: destination.blockchain === "near" ? "smoke.near" : destination.contractAddress ?? "smoke.near",
      recipientType: destination.blockchain === "near" ? "DESTINATION_CHAIN" : "INTENTS",
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (!quote?.quote?.amountOut) throw new Error("quote missing amountOut");
    if (quote.quote.depositAddress) {
      throw new Error("dry quote unexpectedly allocated a depositAddress");
    }
    note(
      "1Click POST /v0/quote (dry)",
      `1 wNEAR → ${quote.quote.amountOutFormatted ?? quote.quote.amountOut} ${destination.symbol}`,
    );
  } catch (error) {
    fail("1Click POST /v0/quote (dry)", error);
  }

  // 4. Solver relay probe — quotes may legitimately be empty/denied without a
  //    partner API key, so anything but a transport failure is informative.
  try {
    const relay = createSolverRelayClient();
    const quotes = await relay.quote({
      defuse_asset_identifier_in: "nep141:wrap.near",
      defuse_asset_identifier_out:
        "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      exact_amount_in: "1000000000000000000000000",
    });
    if (Array.isArray(quotes) && quotes.length > 0) {
      note("solver relay quote", `${quotes.length} solver quote(s) received keyless`);
    } else {
      warn("solver relay quote", "reachable; no quotes returned (may require an API key)");
    }
  } catch (error) {
    warn("solver relay quote", `unavailable keyless: ${error?.message ?? error}`);
  }
}

if (failures.length > 0) {
  console.error(`\nSmoke failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`\nIntents dry smoke passed${offline ? " (offline mode)" : ""}.`);
