// Funded NEAR Intents mainnet smoke: one micro swap (wNEAR → USDC on NEAR)
// end to end through the 1Click API. Spends real tokens — env-gated and
// check-only by default. Never run in CI.
//
// Usage:
//   NEAR_INTENTS_SMOKE_ACCOUNT_ID=you.near \
//   NEAR_INTENTS_SMOKE_PRIVATE_KEY=ed25519:... \
//   node scripts/smoke-intents-mainnet.mjs               # read-only preflight
//   node scripts/smoke-intents-mainnet.mjs --execute     # move real funds
//
// Optional:
//   NEAR_INTENTS_SMOKE_AMOUNT  yocto-wNEAR input (default 0.05 wNEAR)
import process from "node:process";

import {
  actions,
  config,
  queryAccessKey,
  sendTx,
  view,
} from "@fastnear/api";
import {
  publicKeyFromPrivate,
  signerFromPrivateKey,
} from "@fastnear/utils";
import { createOneClickClient } from "@fastnear/intents";

const ACCOUNT_ID = process.env.NEAR_INTENTS_SMOKE_ACCOUNT_ID;
const PRIVATE_KEY = process.env.NEAR_INTENTS_SMOKE_PRIVATE_KEY;
const AMOUNT = process.env.NEAR_INTENTS_SMOKE_AMOUNT ?? "50000000000000000000000"; // 0.05 wNEAR
const EXECUTE = process.argv.includes("--execute");
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60_000;
const WNEAR = "wrap.near";
const WNEAR_ASSET = "nep141:wrap.near";
const USDC_NEAR_ASSET =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const FT_TRANSFER_GAS = "30000000000000";

if (!ACCOUNT_ID || !PRIVATE_KEY) {
  console.log(
    "SKIP: set NEAR_INTENTS_SMOKE_ACCOUNT_ID and NEAR_INTENTS_SMOKE_PRIVATE_KEY " +
      "(a funded mainnet account with a full-access key) to run this smoke.",
  );
  process.exit(0);
}

config({ networkId: "mainnet" });
const oneClick = createOneClickClient({
  apiKey: process.env.NEAR_INTENTS_SMOKE_ONE_CLICK_KEY,
});
const step = (label, detail) => console.log(`✓ ${label}${detail ? ` — ${detail}` : ""}`);

// --- Preflight (always) ----------------------------------------------------

const publicKey = publicKeyFromPrivate(PRIVATE_KEY);
const accessKey = await queryAccessKey({
  accountId: ACCOUNT_ID,
  publicKey,
  network: "mainnet",
});
const permission = accessKey?.result?.permission;
if (permission !== "FullAccess") {
  console.error(
    `✗ ${publicKey} is not a FullAccess key on ${ACCOUNT_ID} (permission: ${JSON.stringify(permission)})`,
  );
  process.exit(1);
}
step("full-access key confirmed on-chain", publicKey.slice(0, 24) + "…");

const wnearBalance = BigInt(
  (await view({
    contractId: WNEAR,
    methodName: "ft_balance_of",
    args: { account_id: ACCOUNT_ID },
    network: "mainnet",
  })) ?? "0",
);
step("wNEAR balance", `${wnearBalance} yocto (need ${AMOUNT})`);

const dryQuote = await oneClick.quote({
  dry: true,
  swapType: "EXACT_INPUT",
  slippageTolerance: 100,
  originAsset: WNEAR_ASSET,
  destinationAsset: USDC_NEAR_ASSET,
  amount: AMOUNT,
  depositType: "ORIGIN_CHAIN",
  refundTo: ACCOUNT_ID,
  refundType: "ORIGIN_CHAIN",
  recipient: ACCOUNT_ID,
  recipientType: "DESTINATION_CHAIN",
  deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
});
step(
  "1Click dry quote",
  `${dryQuote.quote.amountInFormatted ?? AMOUNT} wNEAR → ${dryQuote.quote.amountOutFormatted ?? dryQuote.quote.amountOut} USDC`,
);

if (!EXECUTE) {
  console.log(
    "\nPreflight passed. Re-run with --execute to perform the funded micro swap.",
  );
  process.exit(0);
}

// --- Funded execution ------------------------------------------------------

if (wnearBalance < BigInt(AMOUNT)) {
  console.log(`Wrapping ${AMOUNT} yoctoNEAR into wNEAR first…`);
  const wrapResult = await sendTx({
    signerId: ACCOUNT_ID,
    signer: signerFromPrivateKey(PRIVATE_KEY),
    receiverId: WNEAR,
    actions: [
      actions.functionCall({
        methodName: "near_deposit",
        args: {},
        gas: FT_TRANSFER_GAS,
        deposit: AMOUNT,
      }),
    ],
    waitUntil: "FINAL",
    network: "mainnet",
  });
  step("wrapped NEAR", wrapResult?.transaction?.hash ?? "(submitted)");
}

const committed = await oneClick.quote({
  ...dryQuote.quoteRequest,
  dry: false,
  deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
});
const depositAddress = committed.quote.depositAddress;
if (!depositAddress) {
  console.error("✗ committed quote did not return a depositAddress");
  process.exit(1);
}
step("committed quote", `depositAddress ${depositAddress}`);

const transferResult = await sendTx({
  signerId: ACCOUNT_ID,
  signer: signerFromPrivateKey(PRIVATE_KEY),
  receiverId: WNEAR,
  actions: [
    actions.functionCall({
      methodName: "ft_transfer",
      args: { receiver_id: depositAddress, amount: AMOUNT },
      gas: FT_TRANSFER_GAS,
      deposit: "1",
    }),
  ],
  waitUntil: "FINAL",
  network: "mainnet",
});
const depositTxHash = transferResult?.transaction?.hash;
step("deposit sent", depositTxHash ?? "(submitted)");

if (depositTxHash) {
  await oneClick.submitDeposit({ txHash: depositTxHash, depositAddress });
  step("deposit tx reported to 1Click");
}

const deadline = Date.now() + POLL_TIMEOUT_MS;
let finalStatus = null;
while (Date.now() < deadline) {
  const status = await oneClick.status({ depositAddress });
  console.log(`  … status: ${status.status}`);
  if (["SUCCESS", "REFUNDED", "FAILED"].includes(status.status)) {
    finalStatus = status;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

if (!finalStatus) {
  console.error(`✗ swap did not reach a terminal status within ${POLL_TIMEOUT_MS / 60000} minutes`);
  process.exit(1);
}
if (finalStatus.status !== "SUCCESS") {
  console.error(
    `✗ swap ended ${finalStatus.status}: ${JSON.stringify(finalStatus.swapDetails ?? {}, null, 2)}`,
  );
  process.exit(1);
}

const details = finalStatus.swapDetails ?? {};
step(
  "swap SUCCESS",
  `${details.amountInFormatted ?? AMOUNT} wNEAR → ${details.amountOutFormatted ?? details.amountOut} USDC`,
);
console.log(`  intent hashes: ${JSON.stringify(details.intentHashes ?? [])}`);
console.log(`  near txs:      ${JSON.stringify(details.nearTxHashes ?? [])}`);
console.log("\nFunded mainnet smoke passed.");
