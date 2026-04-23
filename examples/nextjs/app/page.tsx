import Link from "next/link";

export default function Home() {
  return (
    <div className="container">
      <h1>@fastnear + Next.js</h1>
      <p className="subtitle">
        App Router demos — server-side view calls, client-side wallet
      </p>

      <Link href="/view-only" className="card">
        <h2>View Only</h2>
        <p>
          Server component fetches wNEAR token metadata at request time — no
          loading spinners, data is in the HTML.
        </p>
        <span className="tag">mainnet</span>{" "}
        <span className="tag">SSR</span>
      </Link>

      <Link href="/greeter" className="card">
        <h2>Greeter</h2>
        <p>
          Server-fetched initial greeting + client wallet for setting a new
          greeting and signing messages.
        </p>
        <span className="tag">testnet</span>{" "}
        <span className="tag">wallet</span>{" "}
        <span className="tag">SSR + client</span>
      </Link>

      <Link href="/berryclub" className="card">
        <h2>Berry Club</h2>
        <p>
          Server-fetched pixel board + client wallet for drawing pixels and
          buying tokens with session keys.
        </p>
        <span className="tag">mainnet</span>{" "}
        <span className="tag">wallet</span>{" "}
        <span className="tag">session keys</span>
      </Link>
    </div>
  );
}
