"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as near from "@fastnear/api";
import * as nearWallet from "@fastnear/wallet";

const CONTRACT_ID = "greeter.testnet";

export function GreeterClient({
  initialGreeting,
}: {
  initialGreeting: string;
}) {
  const [account, setAccount] = useState<string | null>(null);
  const [greeting, setGreeting] = useState(initialGreeting);
  const [newGreeting, setNewGreeting] = useState("");
  const [messageToSign, setMessageToSign] = useState("Hello from my dApp!");
  const [logLines, setLogLines] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const log = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogLines((prev) => [...prev, `${ts}  ${msg}`]);
  }, []);

  useEffect(() => {
    near.config({ networkId: "testnet" });
    near.useWallet(nearWallet);

    near.event.onAccount((accountId: string | null) => {
      setAccount(accountId);
      log(
        `[account] ${accountId ? "Signed in as " + accountId : "Signed out"}`
      );
    });

    near.event.onTx((txStatus: { status: string; txHash?: string }) => {
      log(
        `[tx] ${txStatus.status}${txStatus.txHash ? " — " + txStatus.txHash : ""}`
      );
      if (
        txStatus.status === "Included" ||
        txStatus.status === "Executed"
      ) {
        fetchGreeting();
      }
    });
  }, [log]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  async function fetchGreeting() {
    try {
      const result = await near.view({
        contractId: CONTRACT_ID,
        methodName: "get_greeting",
      });
      setGreeting(result || "(empty)");
    } catch {
      setGreeting("(error)");
    }
  }

  function handleSignIn() {
    near.requestSignIn({ contractId: CONTRACT_ID });
  }

  function handleSignOut() {
    near.signOut();
    setAccount(null);
  }

  async function handleSetGreeting() {
    if (!newGreeting.trim()) {
      log("[ui] Enter a greeting first");
      return;
    }
    try {
      log("[ui] Sending set_greeting...");
      const result = await near.sendTx({
        receiverId: CONTRACT_ID,
        actions: [
          near.actions.functionCall({
            methodName: "set_greeting",
            args: { greeting: newGreeting.trim() },
            gas: "30000000000000",
            deposit: "0",
          }),
        ],
      });
      if (result && (result as { rejected?: boolean }).rejected) {
        log("[ui] Transaction rejected by user");
      }
    } catch {
      log("[ui] Transaction error — see console");
    }
  }

  async function handleSignMessage() {
    if (!messageToSign.trim()) {
      log("[ui] Enter a message");
      return;
    }
    try {
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      log("[ui] Requesting signature...");
      const signed = await near.signMessage({
        message: messageToSign.trim(),
        nonce,
        recipient: "greeter-example.fastnear.com",
      });
      if (signed) {
        log(`[sign] Signed by ${signed.accountId}`);
        log(`[sign] Key: ${signed.publicKey}`);
        log(`[sign] Sig: ${signed.signature.substring(0, 40)}...`);
      } else {
        log("[sign] User rejected");
      }
    } catch {
      log("[sign] Error — see console");
    }
  }

  return (
    <>
      <div className="status-bar">
        {account
          ? `Connected as: ${account}`
          : "Not connected — sign in to send transactions"}
      </div>

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
      </section>

      <section>
        <h2>Current Greeting</h2>
        <div className="value">{greeting}</div>
        <button onClick={fetchGreeting}>Refresh</button>
      </section>

      <section>
        <h2>Set Greeting</h2>
        <input
          type="text"
          value={newGreeting}
          onChange={(e) => setNewGreeting(e.target.value)}
          placeholder="Enter a new greeting..."
        />
        <button
          className="primary"
          onClick={handleSetGreeting}
          disabled={!account}
        >
          Set Greeting
        </button>
      </section>

      <section>
        <h2>Sign Message (NEP-413)</h2>
        <input
          type="text"
          value={messageToSign}
          onChange={(e) => setMessageToSign(e.target.value)}
          placeholder="Message to sign..."
        />
        <button onClick={handleSignMessage} disabled={!account}>
          Sign Message
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
