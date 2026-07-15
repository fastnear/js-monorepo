# `@fastnear/x402` testnet QA

This repository has one guarded harness for the local-key and browser-wallet release gates. It uses the public `@fastnear/x402` factories, an in-process facilitator, a loopback seller, and a transaction-inspecting RPC proxy. Check-only mode is read-only and cannot submit a transaction.

## Read-only preflight

This fixture transfers one atomic unit of `wrap.testnet`. Substitute another testnet NEP-141 token only after funding the payer and registering the recipient for that token's storage.

```bash
yarn smoke:x402:testnet -- \
  --check-only \
  --payer mike.testnet \
  --payer-credential ~/.near-credentials/testnet/mike.testnet.json \
  --relayer relayer.mike.testnet \
  --relayer-credential ~/.near-credentials/testnet/relayer.mike.testnet.json \
  --pay-to merchant.mike.testnet \
  --asset wrap.testnet \
  --amount 1 \
  --rpc-url https://rpc.testnet.fastnear.com
```

Credential files must be regular, user-owned files with no group or other permissions (`chmod 600` or `chmod 400`). The preflight verifies the testnet chain ID, final-state full-access keys, token contract, payer balance, recipient storage, relayer balance, facilitator discovery, and the seller's x402 v2 challenge. It prints no secrets, payment headers, or signed delegates.

## One local-key settlement

Run this only after the read-only preflight passes. State-changing mode requires exact confirmations for every actor and payment field.

```bash
yarn smoke:x402:testnet -- \
  --execute \
  --payer mike.testnet \
  --payer-credential ~/.near-credentials/testnet/mike.testnet.json \
  --relayer relayer.mike.testnet \
  --relayer-credential ~/.near-credentials/testnet/relayer.mike.testnet.json \
  --pay-to merchant.mike.testnet \
  --asset wrap.testnet \
  --amount 1 \
  --rpc-url https://rpc.testnet.fastnear.com \
  --confirm-network testnet \
  --confirm-payer mike.testnet \
  --confirm-pay-to merchant.mike.testnet \
  --confirm-relayer relayer.mike.testnet \
  --confirm-asset wrap.testnet \
  --confirm-amount 1
```

The harness permits exactly one `send_tx`, checks the serialized inner delegate and outer relayer transaction before forwarding it, waits for `FINAL`, reconciles exact token and nonce deltas, and proves a sequential replay is rejected without another submission. If submission becomes ambiguous, it prints a `near tx-status` reconciliation command and never retries automatically.

## Intear and Meteor gates

Omit the payer credential and use `--serve-wallet` with the same confirmations:

```bash
yarn smoke:x402:testnet -- \
  --serve-wallet \
  --payer mike.testnet \
  --relayer relayer.mike.testnet \
  --relayer-credential ~/.near-credentials/testnet/relayer.mike.testnet.json \
  --pay-to merchant.mike.testnet \
  --asset wrap.testnet \
  --amount 1 \
  --rpc-url https://rpc.testnet.fastnear.com \
  --confirm-network testnet \
  --confirm-payer mike.testnet \
  --confirm-pay-to merchant.mike.testnet \
  --confirm-relayer relayer.mike.testnet \
  --confirm-asset wrap.testnet \
  --confirm-amount 1 \
  --expected-wallet "Intear Wallet"
```

Open the printed `127.0.0.1` URL, connect the exact configured account and wallet, and click Pay. The page uses the locally built wallet and x402 IIFEs, fixes the network and payment fields, never auto-connects or auto-pays, and closes its one-shot server after final reconciliation. Run it separately with `--expected-wallet "Intear Wallet"` and `--expected-wallet "Meteor Wallet"`; the exact value must match `nearWallet.walletName()` for the candidate manifest.

The browser session expires after 15 minutes by default. `--wallet-timeout-seconds` accepts 1 through 3600. To test an unpublished near-connect manifest, pass its public HTTPS URL with `--wallet-manifest`; embedded credentials and query strings are rejected because the browser receives the URL.

By default, wallet mode serves the locally built wallet and x402 IIFEs. To run the same gate against published release artifacts, add an exact package version such as `--bundle-version 1.5.0-beta.0`. The page then loads both IIFEs from immutable, exact-version jsDelivr URLs. Tags, ranges, partial versions, and malformed prerelease versions are rejected; `--bundle-version` is only valid with `--serve-wallet`.

Use the installed `near` CLI only for operator setup, balance inspection, and `near tx-status` reconciliation. The payment itself goes through the package's official local signer or wallet bridge and upstream reference relayer.
