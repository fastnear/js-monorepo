# @fastnear/seed-phrase

BIP-39 seed phrase generation and NEAR key derivation, isolated in its own
package so the bip39 wordlist and HD-derivation code never bloat the zero-dep
`@fastnear/api` core.

Derivation matches [`near-seed-phrase`](https://www.npmjs.com/package/near-seed-phrase)
(and therefore near-cli and NEAR wallets): BIP-39 mnemonic → seed → SLIP-0010
ed25519 at `m/44'/397'/0'` → `ed25519:` key strings.

```js
import { generateSeedPhrase, parseSeedPhrase } from "@fastnear/seed-phrase";

// Create a fresh account key + its recovery phrase.
const { seedPhrase, publicKey, privateKey } = generateSeedPhrase();

// Recover the same keys later (or on another device / tool).
const recovered = parseSeedPhrase(seedPhrase);
// recovered.publicKey === publicKey, recovered.privateKey === privateKey
```

Hand `privateKey` to `near.state.updateAccountState({ accountId, privateKey })`
to sign locally, or `publicKey` to `near.createFundedTestnetAccount({ ... })`
to create a funded testnet account.

## API

- `parseSeedPhrase(seedPhrase, derivationPath = NEAR_DERIVATION_PATH)` →
  `{ seedPhrase, publicKey, privateKey }`. Whitespace/casing are normalized;
  an invalid mnemonic throws.
- `generateSeedPhrase(strength = 128)` → the same shape for a fresh phrase
  (`128` bits → 12 words, `256` → 24 words).
- `NEAR_DERIVATION_PATH` — `"m/44'/397'/0'"`.
