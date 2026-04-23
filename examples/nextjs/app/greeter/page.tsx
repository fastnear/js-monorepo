import { configureTestnet, near } from "@/lib/near";
import { GreeterClient } from "./client";

// Server component: fetches the initial greeting at request time (SSR)
export default async function GreeterPage() {
  configureTestnet();

  const initialGreeting = await near.view({
    contractId: "greeter.testnet",
    methodName: "get_greeting",
  });

  return (
    <div className="container">
      <h1>Greeter</h1>
      <p className="subtitle">
        Server-fetched greeting + client wallet on testnet
      </p>
      <GreeterClient initialGreeting={initialGreeting || "(empty)"} />
    </div>
  );
}
