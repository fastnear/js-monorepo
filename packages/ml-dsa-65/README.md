# `@fastnear/ml-dsa-65`

Opt-in [FIPS 204](https://csrc.nist.gov/pubs/fips/204/final) ML-DSA-65 access-key and transaction-signing support for NEAR Protocol.

This package targets Node.js 20.19+ and modern browsers. It is intentionally separate from `@fastnear/api` and `@fastnear/utils`, so applications that only use Ed25519 or secp256k1 do not download the post-quantum implementation.

> ML-DSA-65 is supported for NEAR account access keys and transaction signatures starting at protocol version 85. Validator, staking, block, and chunk keys remain Ed25519.

## Generate an in-memory signer

```ts
import { generateSigner } from "@fastnear/ml-dsa-65";

const signer = generateSigner();

try {
  // These values are public and may be retained for enrollment and cleanup.
  console.log({
    publicKey: signer.publicKey,             // full 1,952-byte key
    publicKeyHandle: signer.publicKeyHandle, // SHA3-256 list handle
  });

  // Never print or persist exportSeed() or exportSecretKey().
} finally {
  signer.destroy();
}
```

The full `ml-dsa-65:` public key is used to add, query, sign with, and delete an access key. Access-key list responses use the compact `ml-dsa-65-hash:` handle because NEAR stores the SHA3-256 handle on trie. `publicKeyToHandle()` hashes the ASCII domain tag `near:ml-dsa-65-pubkey-hash:v1` followed by the raw public-key bytes so applications can reconcile the two forms.

## Sign explicitly after enrollment

The full public key must already be an authorized access key for `signerId`. The explicit-signer form bypasses FastNear account state and wallets, queries that exact key and permission, reserves a key-scoped nonce, then signs and submits the transaction.

```ts
import {
  actions,
  queryProtocolVersion,
  sendTx,
} from "@fastnear/api";

const protocolVersion = await queryProtocolVersion({ network: "testnet" });
if (protocolVersion < 85) {
  throw new Error(`testnet protocol ${protocolVersion} does not support ML-DSA-65`);
}

await sendTx({
  signerId: "device.testnet",
  signer, // generated or restored in memory; its full public key is enrolled
  receiverId: "device.testnet",
  actions: [actions.transfer("1")],
  waitUntil: "FINAL",
  network: "testnet",
});
```

## Safe testnet enrollment and deletion

Use an existing, authorized classical full-access signer to add and delete the ML-DSA key. Keep this safety-oriented lifecycle testnet-only, put cleanup in `finally`, and never log or persist the generated seed or expanded secret.

```ts
import {
  actions,
  queryAccessKeyList,
  queryProtocolVersion,
  sendTx,
} from "@fastnear/api";
import { generateSigner } from "@fastnear/ml-dsa-65";

export async function withTemporaryMlDsa65Key({
  accountId,
  classicalSigner,
  run,
  saveRecovery,
  removeRecovery,
}) {
  if (!accountId.endsWith(".testnet")) {
    throw new Error("This lifecycle recipe is testnet-only");
  }
  if (await queryProtocolVersion({ network: "testnet" }) < 85) {
    throw new Error("ML-DSA-65 is not active on the selected RPC");
  }

  const signer = generateSigner();
  const publicRecovery = {
    network: "testnet",
    accountId,
    publicKey: signer.publicKey,
    publicKeyHandle: signer.publicKeyHandle,
  };
  let addAttempted = false;

  async function deleteWithFinalizedBarrier() {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        // Submit even when one read says the key is absent. A finalized
        // classical transaction prevents an ambiguous earlier AddKey from
        // landing later with the same or a lower nonce.
        await sendTx({
          signerId: accountId,
          signer: classicalSigner,
          receiverId: accountId,
          actions: [actions.deleteKey({ publicKey: signer.publicKey })],
          waitUntil: "FINAL",
          network: "testnet",
        });
        const list = await queryAccessKeyList({
          accountId,
          blockId: "final",
          network: "testnet",
        });
        const stillPresent = list.result.keys.some(
          (entry) => entry.public_key === publicRecovery.publicKeyHandle,
        );
        if (!stillPresent) return;
        lastError = new Error("ML-DSA-65 key remains after finalized deletion");
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("Could not establish ML-DSA-65 key absence");
  }

  try {
    // Implement these callbacks with durable application storage. On Node,
    // create the public-only file with mode 0600. Never include secret bytes.
    await saveRecovery(publicRecovery);
    addAttempted = true;
    await sendTx({
      signerId: accountId,
      signer: classicalSigner,
      receiverId: accountId,
      actions: [actions.addFullAccessKey({ publicKey: signer.publicKey })],
      waitUntil: "FINAL",
      network: "testnet",
    });

    return await run(signer);
  } finally {
    try {
      if (addAttempted) {
        await deleteWithFinalizedBarrier();
        await removeRecovery(publicRecovery);
      }
    } finally {
      signer.destroy();
    }
  }
}
```

`saveRecovery` and `removeRecovery` are application-supplied durable-storage callbacks. For operational smoke tests, the record should contain only the network, account ID, full public key, and public-key handle; create a Node file with mode `0600`. Cleanup deliberately submits a finalized classical DeleteKey transaction even if one read says the key is absent, because an AddKey response can be lost before its transaction lands. Remove the public-only record only after that nonce barrier and a final-state absence check. If cleanup fails, retain the record and use the classical full-access signer to retry later.

## Reconcile the full key and hash handle

```ts
import {
  queryAccessKey,
  queryAccessKeyList,
} from "@fastnear/api";
import { publicKeyToHandle } from "@fastnear/ml-dsa-65";

const fullPublicKey = signer.publicKey;
const handle = publicKeyToHandle(fullPublicKey);
const [direct, list] = await Promise.all([
  queryAccessKey({
    accountId: "device.testnet",
    publicKey: fullPublicKey,
    network: "testnet",
  }),
  queryAccessKeyList({ accountId: "device.testnet", network: "testnet" }),
]);
const listed = list.result.keys.find((entry) => entry.public_key === handle);

console.log({ direct: direct.result, handle, listed });
```

## Import and export

```ts
import {
  signerFromSeed,
  signerFromSecretKey,
} from "@fastnear/ml-dsa-65";

const signer = signerFromSeed(seedBytes); // exactly 32 bytes
const nearSecret = signer.exportSecretKey(); // ml-dsa-65:<4,032-byte expanded key>
const restored = signerFromSecretKey(nearSecret);
```

`exportSeed()` returns a defensive copy for generated and seed-derived signers. It returns `null` when a signer was imported from an expanded secret key, because that expansion cannot be reversed. Never log or persist seeds or expanded secrets without an application-specific secure storage design.

## Wire-format helpers

The package exports strict, canonical `encode*` and `decode*` pairs for:

- `MlDsa65PublicKey`
- `MlDsa65SecretKey`
- `MlDsa65Signature`
- `MlDsa65PublicKeyHandle`

All decoders require the exact NEAR prefix, exact byte length, valid base58, and canonical round-trip encoding. `signHash()` and `verifyHash()` accept exactly the 32-byte SHA-256 Borsh transaction hash. They use pure randomized ML-DSA with an empty context, not HashML-DSA.

## Resource and security notes

- ML-DSA-65 public keys are 1,952 bytes and signatures are 3,309 bytes, substantially increasing transaction wire size.
- NEAR charges an additional 100 Ggas for each outer or delegated ML-DSA verification.
- `destroy()` performs best-effort zeroization of the package-owned JavaScript buffers. JavaScript runtimes and cryptographic dependencies may retain internal copies, so it is not a hard memory-erasure guarantee.
- The underlying `@noble/post-quantum` implementation describes itself as self-audited and does not claim constant-time side-channel protection. Assess that constraint before using it with high-value keys or hostile co-tenants. The structural async-compatible FastNear signer interface allows a native, WASM, hardware, or HSM signer to replace this backend later.
- Check the RPC's active `protocol_version` before adding or using an ML-DSA-65 key. Node software versions and `latest_protocol_version` are not activation signals.

Run a local machine-readable benchmark with:

```sh
yarn workspace @fastnear/ml-dsa-65 build
yarn workspace @fastnear/ml-dsa-65 benchmark
```
