import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

export const MAX_PAYMENT_AMOUNT = 1_000_000n;
export const MAX_TIMEOUT_SECONDS = 300;

const OPTION_DEFINITIONS = {
  "check-only": { type: "boolean" },
  execute: { type: "boolean" },
  "serve-wallet": { type: "boolean" },
  help: { type: "boolean" },
  payer: { type: "string" },
  "payer-credential": { type: "string" },
  relayer: { type: "string" },
  "relayer-credential": { type: "string" },
  "pay-to": { type: "string" },
  asset: { type: "string" },
  amount: { type: "string" },
  "rpc-url": { type: "string" },
  port: { type: "string" },
  "confirm-network": { type: "string" },
  "confirm-payer": { type: "string" },
  "confirm-pay-to": { type: "string" },
  "confirm-relayer": { type: "string" },
  "confirm-asset": { type: "string" },
  "confirm-amount": { type: "string" },
  "expected-wallet": { type: "string" },
  "bundle-version": { type: "string" },
  "wallet-manifest": { type: "string" },
  "wallet-timeout-seconds": { type: "string" },
};

const EXACT_SEMVER =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const EXACT_SEMVER_SOURCE =
  "(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
const WALLET_CDN =
  "https://cdn.jsdelivr.net/npm/@fastnear/wallet@next/dist/umd/browser.global.js";
const X402_CDN =
  "https://cdn.jsdelivr.net/npm/@fastnear/x402@next/dist/umd/browser.global.js";
const WALLET_CDN_RE = new RegExp(
  `https://cdn\\.jsdelivr\\.net/npm/@fastnear/wallet@(?:next|${EXACT_SEMVER_SOURCE})/dist/umd/browser\\.global\\.js`,
);
const X402_CDN_RE = new RegExp(
  `https://cdn\\.jsdelivr\\.net/npm/@fastnear/x402@(?:next|${EXACT_SEMVER_SOURCE})/dist/umd/browser\\.global\\.js`,
);

function exactBundleVersion(value) {
  if (typeof value !== "string" || !EXACT_SEMVER.test(value)) {
    throw new Error(
      "--bundle-version must be an exact semver such as 1.5.0 or 1.5.0-beta.0",
    );
  }
  return value;
}

function required(values, name) {
  const value = values[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required --${name} option`);
  }
  return value;
}

function expandHome(filename) {
  if (filename === "~") return os.homedir();
  if (filename.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), filename.slice(2));
  }
  return filename;
}

function namedTestnetAccount(value, label) {
  if (!value.endsWith(".testnet") || value.length > 64) {
    throw new Error(`${label} must be a named .testnet account`);
  }
  return value;
}

function testnetAsset(value) {
  if (
    (value.endsWith(".testnet") && value.length <= 64) ||
    /^[0-9a-f]{64}$/.test(value)
  ) {
    return value;
  }
  throw new Error("--asset must be a named .testnet or 64-character implicit account");
}

function parsePort(value) {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("--port must be an integer from 0 through 65535");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error("--port must be an integer from 0 through 65535");
  }
  return port;
}

export function parseHarnessArgs(argv) {
  const parsed = parseArgs({
    args: argv,
    options: OPTION_DEFINITIONS,
    strict: true,
    allowPositionals: false,
    tokens: true,
  });

  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) {
      throw new Error(`Option --${token.name} may only be provided once`);
    }
    seen.add(token.name);
  }

  return parsed.values;
}

export function normalizeHarnessOptions(values) {
  if (values.help) return { mode: "help" };

  const selectedModes = [
    values["check-only"] ? "check" : null,
    values.execute ? "execute" : null,
    values["serve-wallet"] ? "serve-wallet" : null,
  ].filter(Boolean);
  if (selectedModes.length > 1) {
    throw new Error("Choose only one of --check-only, --execute, or --serve-wallet");
  }
  const mode = selectedModes[0] ?? "check";

  const payer = namedTestnetAccount(required(values, "payer"), "--payer");
  const relayer = namedTestnetAccount(required(values, "relayer"), "--relayer");
  const payTo = namedTestnetAccount(required(values, "pay-to"), "--pay-to");
  if (new Set([payer, relayer, payTo]).size !== 3) {
    throw new Error("Payer, relayer, and recipient must be three distinct accounts");
  }

  const asset = testnetAsset(required(values, "asset"));
  const amountText = required(values, "amount");
  if (!/^[1-9][0-9]*$/.test(amountText)) {
    throw new Error("--amount must be a positive integer in atomic token units");
  }
  const amount = BigInt(amountText);
  if (amount > MAX_PAYMENT_AMOUNT) {
    throw new Error(
      `--amount exceeds this harness's hard cap of ${MAX_PAYMENT_AMOUNT} atomic units`,
    );
  }

  const rpcUrl = new URL(required(values, "rpc-url"));
  if (rpcUrl.protocol !== "https:") {
    throw new Error("--rpc-url must use HTTPS");
  }
  if (rpcUrl.username || rpcUrl.password) {
    throw new Error("--rpc-url must not contain embedded credentials");
  }
  rpcUrl.hash = "";

  const payerCredential = values["payer-credential"];
  if (mode === "serve-wallet") {
    if (payerCredential !== undefined) {
      throw new Error("--payer-credential is forbidden with --serve-wallet");
    }
  } else if (typeof payerCredential !== "string" || payerCredential.length === 0) {
    throw new Error("Missing required --payer-credential option");
  }

  const relayerCredential = required(values, "relayer-credential");
  const port = values.port === undefined ? 0 : parsePort(values.port);
  if (mode !== "serve-wallet" && values.port !== undefined) {
    throw new Error("--port is only valid with --serve-wallet");
  }

  let expectedWallet;
  let bundleVersion;
  let walletManifest;
  let walletTimeoutSeconds;
  if (mode === "serve-wallet") {
    expectedWallet = required(values, "expected-wallet");
    if (expectedWallet.length > 100 || /[\r\n]/.test(expectedWallet)) {
      throw new Error("--expected-wallet must be a single wallet name of 100 characters or fewer");
    }
    if (values["bundle-version"] !== undefined) {
      bundleVersion = exactBundleVersion(values["bundle-version"]);
    }
    if (values["wallet-manifest"] !== undefined) {
      const manifestUrl = new URL(values["wallet-manifest"]);
      if (
        manifestUrl.protocol !== "https:" ||
        manifestUrl.username ||
        manifestUrl.password ||
        manifestUrl.search
      ) {
        throw new Error("--wallet-manifest must be an HTTPS URL without credentials or a query string");
      }
      manifestUrl.hash = "";
      walletManifest = manifestUrl.href;
    }
    const timeoutText = values["wallet-timeout-seconds"] ?? "900";
    if (!/^[1-9][0-9]*$/.test(timeoutText)) {
      throw new Error("--wallet-timeout-seconds must be an integer from 1 through 3600");
    }
    walletTimeoutSeconds = Number(timeoutText);
    if (!Number.isSafeInteger(walletTimeoutSeconds) || walletTimeoutSeconds > 3_600) {
      throw new Error("--wallet-timeout-seconds must be an integer from 1 through 3600");
    }
  } else {
    for (const name of [
      "expected-wallet",
      "bundle-version",
      "wallet-manifest",
      "wallet-timeout-seconds",
    ]) {
      if (values[name] !== undefined) {
        throw new Error(`--${name} is only valid with --serve-wallet`);
      }
    }
  }

  if (mode === "check") {
    for (const name of [
      "confirm-network",
      "confirm-payer",
      "confirm-pay-to",
      "confirm-relayer",
      "confirm-asset",
      "confirm-amount",
    ]) {
      if (values[name] !== undefined) {
        throw new Error(`--${name} is only valid for a state-changing mode`);
      }
    }
  } else {
    if (values["confirm-network"] !== "testnet") {
      throw new Error("State-changing modes require --confirm-network testnet");
    }
    if (values["confirm-payer"] !== payer) {
      throw new Error("--confirm-payer must exactly match --payer");
    }
    if (values["confirm-pay-to"] !== payTo) {
      throw new Error("--confirm-pay-to must exactly match --pay-to");
    }
    if (values["confirm-relayer"] !== relayer) {
      throw new Error("--confirm-relayer must exactly match --relayer");
    }
    if (values["confirm-asset"] !== asset) {
      throw new Error("--confirm-asset must exactly match --asset");
    }
    if (values["confirm-amount"] !== amountText) {
      throw new Error("--confirm-amount must exactly match --amount");
    }
  }

  return {
    mode,
    payer,
    payerCredential: payerCredential
      ? path.resolve(expandHome(payerCredential))
      : undefined,
    relayer,
    relayerCredential: path.resolve(expandHome(relayerCredential)),
    payTo,
    asset,
    amount,
    amountText,
    rpcUrl,
    port,
    expectedWallet,
    bundleVersion,
    walletManifest,
    walletTimeoutSeconds,
  };
}

export function sanitizedRpcUrl(url) {
  return url.pathname === "/" ? url.origin : `${url.origin}/<redacted-path>`;
}

export function credentialMetadataError(metadata, currentUid) {
  if (!metadata.isFile()) return "Credential path is not a regular file";
  if ((metadata.mode & 0o077) !== 0) {
    return `Credential permissions are too broad (mode ${(metadata.mode & 0o777).toString(8)})`;
  }
  if (currentUid !== undefined && metadata.uid !== currentUid) {
    return "Credential file is not owned by the current user";
  }
  if (metadata.size > 64 * 1024) return "Credential file is unexpectedly large";
  return null;
}

export function transformWalletSmokePage(html, config, bundleVersion) {
  const serialized = JSON.stringify(config).replaceAll("<", "\\u003c");
  const injection = `<script>globalThis.__FASTNEAR_X402_SMOKE__=${serialized};</script>`;
  const version = bundleVersion === undefined
    ? undefined
    : exactBundleVersion(bundleVersion);
  const walletBundle = version === undefined
    ? "/bundles/wallet.js"
    : WALLET_CDN.replace("@next/", `@${version}/`);
  const x402Bundle = version === undefined
    ? "/bundles/x402.js"
    : X402_CDN.replace("@next/", `@${version}/`);

  if (!WALLET_CDN_RE.test(html) || !X402_CDN_RE.test(html) || !html.includes("</head>")) {
    throw new Error("The static x402 page no longer matches the wallet-smoke template");
  }

  return html
    .replace(WALLET_CDN_RE, walletBundle)
    .replace(X402_CDN_RE, x402Bundle)
    .replace("</head>", `${injection}\n</head>`);
}
