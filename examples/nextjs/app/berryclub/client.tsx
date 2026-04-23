"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as near from "@fastnear/api";
import * as nearWallet from "@fastnear/wallet";

const CONTRACT_ID = "berryclub.ek.near";
const BOARD_SIZE = 50;

function intToColor(c: number): string {
  return `#${(c >>> 0).toString(16).padStart(6, "0")}`;
}

function decodeLine(line: string): string[] {
  const binary = atob(line);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  const pixels: string[] = [];
  for (let i = 4; i < buf.length; i += 8) {
    const color =
      buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24);
    pixels.push(intToColor(color));
  }
  return pixels;
}

function renderBoard(lines: string[]): string[] {
  return lines.flatMap((line) => decodeLine(line));
}

export function BerryclubClient({
  initialLines,
  initialTotalSupply,
}: {
  initialLines: string[];
  initialTotalSupply: string;
}) {
  const [account, setAccount] = useState<string | null>(null);
  const [pixels, setPixels] = useState<string[]>(() =>
    renderBoard(initialLines)
  );
  const [totalSupply, setTotalSupply] = useState(initialTotalSupply);
  const [balance, setBalance] = useState<string | null>(null);
  const [pixelColor, setPixelColor] = useState("#00ff00");
  const [logLines, setLogLines] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const cu = near.utils.convertUnit;

  const log = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogLines((prev) => [...prev, `${ts}  ${msg}`]);
  }, []);

  useEffect(() => {
    near.config({ networkId: "mainnet" });
    near.useWallet(nearWallet);

    near.event.onAccount((accountId: string | null) => {
      setAccount(accountId);
      log(
        `[account] ${accountId ? "Signed in as " + accountId : "Signed out"}`
      );
      if (accountId) loadBalance(accountId);
    });

    near.event.onTx((txStatus: { status: string; txHash?: string }) => {
      const hash = txStatus.txHash
        ? txStatus.txHash.slice(0, 12) + "..."
        : "";
      log(`[tx] ${txStatus.status}${hash ? " — " + hash : ""}`);
      if (
        txStatus.status === "Included" ||
        txStatus.status === "Executed"
      ) {
        loadBoard();
        loadBalance(near.accountId());
      }
    });
  }, [log]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  async function loadBoard() {
    try {
      const lines = await near.view({
        contractId: CONTRACT_ID,
        methodName: "get_lines",
        args: { lines: [...Array(BOARD_SIZE).keys()] },
      });
      setPixels(renderBoard(lines));
    } catch (err) {
      console.error("Failed to load board:", err);
    }
  }

  async function loadBalance(accountId: string | null) {
    try {
      const supply = await near.view({
        contractId: CONTRACT_ID,
        methodName: "ft_total_supply",
        args: {},
      });
      setTotalSupply(supply);

      if (accountId) {
        const acct = await near.view({
          contractId: CONTRACT_ID,
          methodName: "get_account",
          args: { account_id: accountId },
        });
        setBalance(
          acct && !isNaN(acct.avocado_balance)
            ? `${(parseFloat(acct.avocado_balance) / 1e18).toFixed(4)} avocados`
            : "0.0000 avocados"
        );
      } else {
        setBalance(null);
      }
    } catch (err) {
      console.error("Failed to load balance:", err);
    }
  }

  function handleSignIn() {
    near.requestSignIn({ contractId: CONTRACT_ID });
  }

  function handleSignOut() {
    near.signOut();
    setAccount(null);
    setBalance(null);
  }

  async function handleDraw() {
    const color = parseInt(pixelColor.replace("#", ""), 16) || 0x00ff00;
    const x = Math.floor(Math.random() * BOARD_SIZE);
    const y = Math.floor(Math.random() * BOARD_SIZE);

    try {
      log(`[ui] Drawing pixel at (${x}, ${y})...`);
      await near.sendTx({
        receiverId: CONTRACT_ID,
        actions: [
          near.actions.functionCall({
            methodName: "draw",
            args: { pixels: [{ x, y, color }] },
            gas: cu("100 Tgas"),
            deposit: "0",
          }),
        ],
      });
    } catch {
      log("[ui] Draw error — see console");
    }
  }

  async function handleBuy() {
    try {
      log("[ui] Buying tokens (0.1 NEAR)...");
      await near.sendTx({
        receiverId: CONTRACT_ID,
        actions: [
          near.actions.functionCall({
            methodName: "buy_tokens",
            args: {},
            gas: cu("100 Tgas"),
            deposit: cu("0.1 NEAR"),
          }),
        ],
      });
    } catch {
      log("[ui] Buy error — see console");
    }
  }

  const supplyDisplay = totalSupply
    ? `${(parseFloat(totalSupply) / 1e18).toFixed(4)} avocados`
    : "—";

  return (
    <>
      <div className="status-bar">
        {account
          ? `Connected as: ${account}`
          : "Not connected — sign in to draw and buy tokens"}
      </div>

      <section>
        <h2>Pixel Board (50 &times; 50)</h2>
        <div className="pixel-board">
          {pixels.map((color, i) => (
            <div
              key={i}
              className="pixel"
              style={{ background: color }}
            />
          ))}
        </div>
        <button onClick={loadBoard}>Refresh Board</button>
      </section>

      <section>
        <h2>Authentication</h2>
        <div className="row">
          <button
            className="primary"
            onClick={handleSignIn}
            disabled={!!account}
          >
            Sign In
          </button>
          <button
            className="danger"
            onClick={handleSignOut}
            disabled={!account}
          >
            Sign Out
          </button>
        </div>
        <p className="note">
          Signs in with a <strong>session key</strong> scoped to{" "}
          <code>berryclub.ek.near</code>. Drawing uses the session key (no
          popup). Buying tokens requires a deposit and goes through the
          wallet.
        </p>
      </section>

      <section>
        <h2>Draw Pixel</h2>
        <div className="row">
          <label>Color:</label>
          <input
            type="text"
            value={pixelColor}
            onChange={(e) => setPixelColor(e.target.value)}
            style={{ width: 100 }}
          />
          <button
            className="primary"
            onClick={handleDraw}
            disabled={!account}
          >
            Draw Random Pixel
          </button>
        </div>
      </section>

      <section>
        <h2>Buy Tokens</h2>
        <button className="accent" onClick={handleBuy} disabled={!account}>
          Buy 25 Avocados (0.1 NEAR)
        </button>
      </section>

      <section>
        <h2>Balances</h2>
        <table className="metadata-table">
          <tbody>
            <tr>
              <td>Total supply</td>
              <td>{supplyDisplay}</td>
            </tr>
            <tr>
              <td>Your balance</td>
              <td>{balance ?? "(sign in to view)"}</td>
            </tr>
          </tbody>
        </table>
        <button
          onClick={() => loadBalance(account)}
          style={{ marginTop: 8 }}
        >
          Refresh
        </button>
      </section>

      <section>
        <h2>Event Log</h2>
        <div className="log" ref={logRef}>
          {logLines.length
            ? logLines.join("\n")
            : "(events will appear here)"}
        </div>
      </section>
    </>
  );
}
