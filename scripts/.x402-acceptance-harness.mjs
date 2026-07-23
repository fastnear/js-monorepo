// Temporary x402 acceptance harness (delete after use). Env-parameterized.
// Signs an x402 "exact" NEAR payment as the payer and calls a deployed
// facilitator. Default mode /verify (NO broadcast); --settle broadcasts;
// --save=<f>/--replay=<f> capture/replay exact bytes.
import { readFileSync } from "node:fs";
import { createClientNearSigner } from "@x402/near";

const NETWORK = process.env.NETWORK ?? "near:mainnet";
const CHAIN = NETWORK.split(":")[1];
const FACILITATOR = process.env.FACILITATOR ?? "https://x402.mikedotexe.com";
const RPC = process.env.RPC ?? "https://rpc.mainnet.fastnear.com";
const USDC = process.env.ASSET ?? "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const PAYER = process.env.PAYER ?? "mike.near";
const PAYEE = process.env.PAYEE ?? "count.mike.near";
const AMOUNT = process.env.AMOUNT ?? "1000";

const mode = process.argv.includes("--settle") ? "settle" : "verify";
const keyFileArg = process.argv.find((a) => a.startsWith("--apikey="));
const apiKeyFile = keyFileArg ? keyFileArg.slice("--apikey=".length) : null;
const saveArg = process.argv.find((a) => a.startsWith("--save="));
const saveFile = saveArg ? saveArg.slice("--save=".length) : null;
const replayArg = process.argv.find((a) => a.startsWith("--replay="));
const replayFile = replayArg ? replayArg.slice("--replay=".length) : null;
if (!apiKeyFile) {
  console.error("usage: node .x402-acceptance-harness.mjs --apikey=<file> [--settle] [--save=<f>] [--replay=<f>]");
  process.exit(2);
}

const payerKey = JSON.parse(
  readFileSync(`${process.env.HOME}/.near-credentials/${CHAIN}/${PAYER}.json`, "utf8"),
);
const apiKeyRaw = readFileSync(apiKeyFile, "utf8");
const apiKeyMatch = apiKeyRaw.match(/api_key=(\S+)/);
const apiKey = apiKeyMatch ? apiKeyMatch[1] : apiKeyRaw.trim();

const signer = createClientNearSigner({
  accountId: PAYER,
  secretKey: payerKey.private_key,
  rpcUrls: { [NETWORK]: RPC },
});

const paymentRequirements = {
  scheme: "exact",
  network: NETWORK,
  asset: USDC,
  amount: AMOUNT,
  payTo: PAYEE,
  maxTimeoutSeconds: 120,
};

let body;
if (replayFile) {
  body = JSON.parse(readFileSync(replayFile, "utf8"));
} else {
  const signedDelegateAction = await signer.createSignedDelegateAction({
    x402Version: 2,
    paymentRequirements,
  });
  body = {
    x402Version: 2,
    paymentPayload: { x402Version: 2, accepted: paymentRequirements, payload: { signedDelegateAction } },
    paymentRequirements,
  };
  if (saveFile) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(saveFile, JSON.stringify(body));
    console.log(`saved request body -> ${saveFile}`);
  }
}

const endpoint = `${FACILITATOR}/${mode}`;
console.log(`mode=${mode}  ${endpoint}  ${NETWORK}  ${PAYER} -> ${PAYEE}  amount=${AMOUNT}`);
const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch { console.log(text); }
