import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  credentialMetadataError,
  normalizeHarnessOptions,
  parseHarnessArgs,
  sanitizedRpcUrl,
  transformWalletSmokePage,
} from "./x402-testnet-helpers.mjs";

const required = [
  "--payer", "mike.testnet",
  "--payer-credential", "/tmp/payer.json",
  "--relayer", "relayer.mike.testnet",
  "--relayer-credential", "/tmp/relayer.json",
  "--pay-to", "merchant.mike.testnet",
  "--asset", "wrap.testnet",
  "--amount", "1",
  "--rpc-url", "https://rpc.testnet.fastnear.com/private?token=hidden",
];

describe("x402 testnet harness options", () => {
  it("defaults to the read-only check and strips RPC secrets from display", () => {
    const options = normalizeHarnessOptions(parseHarnessArgs(required));
    expect(options).toMatchObject({
      mode: "check",
      payer: "mike.testnet",
      relayer: "relayer.mike.testnet",
      payTo: "merchant.mike.testnet",
      asset: "wrap.testnet",
      amount: 1n,
    });
    expect(sanitizedRpcUrl(options.rpcUrl)).toBe(
      "https://rpc.testnet.fastnear.com/<redacted-path>",
    );
  });

  it("requires confirmations for execution", () => {
    expect(() => normalizeHarnessOptions(parseHarnessArgs([
      ...required,
      "--execute",
    ]))).toThrow("--confirm-network testnet");

    expect(normalizeHarnessOptions(parseHarnessArgs([
      ...required,
      "--execute",
      "--confirm-network", "testnet",
      "--confirm-payer", "mike.testnet",
      "--confirm-pay-to", "merchant.mike.testnet",
      "--confirm-relayer", "relayer.mike.testnet",
      "--confirm-asset", "wrap.testnet",
      "--confirm-amount", "1",
    ])).mode).toBe("execute");
  });

  it("forbids a local payer key in wallet mode and rejects duplicate flags", () => {
    expect(() => parseHarnessArgs([...required, "--amount", "2"])).toThrow(
      "Option --amount may only be provided once",
    );
    expect(() => normalizeHarnessOptions(parseHarnessArgs([
      ...required,
      "--serve-wallet",
      "--confirm-network", "testnet",
      "--confirm-payer", "mike.testnet",
      "--confirm-pay-to", "merchant.mike.testnet",
      "--confirm-relayer", "relayer.mike.testnet",
      "--confirm-asset", "wrap.testnet",
      "--confirm-amount", "1",
      "--expected-wallet", "Intear Wallet",
    ]))).toThrow("--payer-credential is forbidden");
  });

  it("locks wallet mode to an exact wallet and optional public manifest", () => {
    const withoutPayerCredential = required.filter((_, index) =>
      index !== 2 && index !== 3
    );
    const options = normalizeHarnessOptions(parseHarnessArgs([
      ...withoutPayerCredential,
      "--serve-wallet",
      "--confirm-network", "testnet",
      "--confirm-payer", "mike.testnet",
      "--confirm-pay-to", "merchant.mike.testnet",
      "--confirm-relayer", "relayer.mike.testnet",
      "--confirm-asset", "wrap.testnet",
      "--confirm-amount", "1",
      "--expected-wallet", "Meteor Wallet",
      "--bundle-version", "1.5.0-beta.0",
      "--wallet-manifest", "https://wallets.example.test/candidate.json",
      "--wallet-timeout-seconds", "60",
    ]));
    expect(options).toMatchObject({
      mode: "serve-wallet",
      expectedWallet: "Meteor Wallet",
      bundleVersion: "1.5.0-beta.0",
      walletManifest: "https://wallets.example.test/candidate.json",
      walletTimeoutSeconds: 60,
    });
  });

  it("accepts only exact published bundle versions in wallet mode", () => {
    const withoutPayerCredential = required.filter((_, index) =>
      index !== 2 && index !== 3
    );
    const walletArgs = [
      ...withoutPayerCredential,
      "--serve-wallet",
      "--confirm-network", "testnet",
      "--confirm-payer", "mike.testnet",
      "--confirm-pay-to", "merchant.mike.testnet",
      "--confirm-relayer", "relayer.mike.testnet",
      "--confirm-asset", "wrap.testnet",
      "--confirm-amount", "1",
      "--expected-wallet", "Meteor Wallet",
    ];

    for (const version of [
      "next",
      "^1.5.0",
      "v1.5.0",
      "1.5",
      "01.5.0",
      "1.5.0-beta..0",
      "1.5.0-01",
    ]) {
      expect(() => normalizeHarnessOptions(parseHarnessArgs([
        ...walletArgs,
        "--bundle-version", version,
      ])), version).toThrow("--bundle-version must be an exact semver");
    }

    expect(() => normalizeHarnessOptions(parseHarnessArgs([
      ...required,
      "--bundle-version", "1.5.0",
    ]))).toThrow("--bundle-version is only valid with --serve-wallet");
  });

  it("rejects broad credential modes", () => {
    const metadata = {
      isFile: () => true,
      mode: 0o100644,
      uid: 501,
      size: 200,
    };
    expect(credentialMetadataError(metadata, 501)).toContain("mode 644");
    metadata.mode = 0o100600;
    expect(credentialMetadataError(metadata, 501)).toBeNull();
  });

  it("locks the served page to local bundles and escaped fixture data", () => {
    const html = `
      <script src="https://cdn.jsdelivr.net/npm/@fastnear/wallet@next/dist/umd/browser.global.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/@fastnear/x402@next/dist/umd/browser.global.js"></script>
      </head>`;
    const result = transformWalletSmokePage(html, { payer: "<mike.testnet>" });
    expect(result).toContain("/bundles/wallet.js");
    expect(result).toContain("/bundles/x402.js");
    expect(result).toContain("\\u003cmike.testnet>");
    expect(result).not.toContain("@next");
  });

  it("locks the served page to immutable exact-version CDN bundles", () => {
    const html = `
      <script src="https://cdn.jsdelivr.net/npm/@fastnear/wallet@next/dist/umd/browser.global.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/@fastnear/x402@next/dist/umd/browser.global.js"></script>
      </head>`;
    const result = transformWalletSmokePage(
      html,
      { payer: "mike.testnet" },
      "1.5.0-beta.0",
    );
    expect(result).toContain(
      "https://cdn.jsdelivr.net/npm/@fastnear/wallet@1.5.0-beta.0/dist/umd/browser.global.js",
    );
    expect(result).toContain(
      "https://cdn.jsdelivr.net/npm/@fastnear/x402@1.5.0-beta.0/dist/umd/browser.global.js",
    );
    expect(result).not.toContain("/bundles/wallet.js");
    expect(result).not.toContain("@next");
  });

  it("never displays RPC query strings, credentials, or path tokens", () => {
    expect(sanitizedRpcUrl(new URL(
      "https://user:secret@rpc.example.test/v1/path-key?apiKey=query-key",
    ))).toBe("https://rpc.example.test/<redacted-path>");
    expect(sanitizedRpcUrl(new URL("https://rpc.example.test/"))).toBe(
      "https://rpc.example.test",
    );
  });

  it("transforms the repository's real wallet page", async () => {
    const html = await readFile(new URL("../examples/static/x402.html", import.meta.url), "utf8");
    const result = transformWalletSmokePage(html, {
      payer: "mike.testnet",
      expectedWallet: "Intear Wallet",
    });
    expect(result).toContain("globalThis.__FASTNEAR_X402_SMOKE__");
    expect(result).toContain("/bundles/wallet.js");
    expect(result).toContain("/bundles/x402.js");
    expect(result).toContain("id=\"smoke-fixture\"");
  });
});
