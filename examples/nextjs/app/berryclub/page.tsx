import { configureMainnet, near } from "@/lib/near";
import { BerryclubClient } from "./client";

const CONTRACT_ID = "berryclub.ek.near";
const BOARD_SIZE = 50;

// Server component: fetches the board and total supply at request time (SSR)
export default async function BerryclubPage() {
  configureMainnet();

  const [lines, totalSupply] = await Promise.all([
    near.view({
      contractId: CONTRACT_ID,
      methodName: "get_lines",
      args: { lines: [...Array(BOARD_SIZE).keys()] },
    }),
    near.view({
      contractId: CONTRACT_ID,
      methodName: "ft_total_supply",
      args: {},
    }),
  ]);

  return (
    <div className="container">
      <h1>Berry Club</h1>
      <p className="subtitle">
        Server-fetched board + client wallet on mainnet
      </p>
      <BerryclubClient
        initialLines={lines}
        initialTotalSupply={totalSupply}
      />
    </div>
  );
}
