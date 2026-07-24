# @fastnear examples

Two example sites demonstrating the `@fastnear/*` packages.

## Static HTML (`examples/static/`)

No build tools — just `<script>` tags loading IIFE bundles. All JS is inline.

| Page | Network | Wallet | What it shows |
|---|---|---|---|
| `index.html` | — | No | Landing page linking to the demos |
| `view-only.html` | mainnet | No | `near.view()` — fetch wNEAR token metadata |
| `greeter.html` | testnet | Yes | Read/write greeting, NEP-413 message signing, event log |
| `berryclub.html` | mainnet | Yes | Session keys, pixel board, buy tokens, balances |
| `x402.html` | testnet | Yes | x402 pay-per-request over NEAR (`@fastnear/x402`) |

### Run

```sh
cd examples/static
python3 -m http.server
# open http://localhost:8000
```

### Loading `@fastnear/*` from a CDN — pinning and SRI

- **Do not put Subresource Integrity (`integrity` + `crossorigin`) on the
  `@fastnear/*` script tags.** An SRI hash freezes exact bytes, so it breaks
  every consumer on the next publish. Most examples float a major range
  (`@1`) so a publish propagates without editing HTML; `x402.html` is the
  exception and pins an exact version, because the testnet wallet-smoke
  harness rewrites its two exact tags to local bundles — but neither style
  takes SRI. Every `@fastnear/*` package shares one version, so keep the tags
  in a page consistent with each other.
- **Do put SRI on genuinely third-party, version-pinned CDN scripts** you add
  (a specific charting lib, say): `integrity="sha384-…"` plus
  `crossorigin="anonymous"`. Fonts are the exception — Google Fonts serves
  user-agent-dependent CSS, which SRI cannot cover.

SRI is not the lever for the supply-chain risk people usually mean here; that
is publish-token hygiene, 2FA, and provenance on the npm side. Track that
separately if we pursue it.

## Next.js App Router (`examples/nextjs/`)

TypeScript with server components doing `near.view()` at request time (SSR). Client components handle wallet and transactions.

| Route | Rendering | What it shows |
|---|---|---|
| `/` | Server | Landing page |
| `/view-only` | Server | SSR view call — data is in the HTML, no client JS |
| `/greeter` | Server + Client | Server-fetched greeting, client wallet for writes |
| `/berryclub` | Server + Client | Server-fetched board, client wallet for draw/buy |

### Run

```sh
cd examples/nextjs
npm install
npm run dev
# open http://localhost:3000
```
