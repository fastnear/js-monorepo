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

### Run

```sh
cd examples/static
python3 -m http.server
# open http://localhost:8000
```

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
