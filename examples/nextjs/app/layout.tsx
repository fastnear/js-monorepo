import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "@fastnear Next.js example",
  description: "NEAR Protocol integration with Next.js App Router",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/" className="brand">
            @fastnear
          </Link>
          <Link href="/view-only">View Only</Link>
          <Link href="/greeter">Greeter</Link>
          <Link href="/berryclub">Berry Club</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
