import { describe, expect, it, vi } from "vitest";
import {
  ftDepositAction,
  ftWithdrawAction,
  mtBalance,
  mtBatchBalances,
  wrapNearAction,
} from "./verifier.js";

describe("ftDepositAction", () => {
  it("builds the ft_transfer_call deposit with 1 yocto and empty msg", () => {
    expect(ftDepositAction({ amount: "1000000" })).toEqual({
      type: "FunctionCall",
      methodName: "ft_transfer_call",
      args: { receiver_id: "intents.near", amount: "1000000", msg: "" },
      gas: "100000000000000",
      deposit: "1",
    });
  });

  it("credits another account via creditTo", () => {
    const action = ftDepositAction({ amount: "1", creditTo: "bob.near" });
    expect(action.args.msg).toBe("bob.near");
  });

  it("rejects creditTo together with msg", () => {
    expect(() =>
      ftDepositAction({ amount: "1", creditTo: "bob.near", msg: "{}" }),
    ).toThrow(/either creditTo or msg/);
  });
});

describe("wrapNearAction", () => {
  it("wraps native NEAR via near_deposit with the amount as deposit", () => {
    const action = wrapNearAction({ amountYocto: "5000000000000000000000000" });
    expect(action.methodName).toBe("near_deposit");
    expect(action.deposit).toBe("5000000000000000000000000");
    expect(action.args).toEqual({});
  });
});

describe("ftWithdrawAction", () => {
  it("builds a refundable withdrawal (no msg) with 1 yocto", () => {
    const action = ftWithdrawAction({
      token: "usdt.tether-token.near",
      receiverId: "alice.near",
      amount: "42",
    });
    expect(action.methodName).toBe("ft_withdraw");
    expect(action.args).toEqual({
      token: "usdt.tether-token.near",
      receiver_id: "alice.near",
      amount: "42",
    });
    expect(action.deposit).toBe("1");
  });

  it("rejects prefixed multi-token ids", () => {
    expect(() =>
      ftWithdrawAction({
        token: "nep141:usdt.tether-token.near",
        receiverId: "a.near",
        amount: "1",
      }),
    ).toThrow(/plain token contract id/);
  });
});

describe("mt balances", () => {
  it("reads one balance via the injected view", async () => {
    const view = vi.fn(async () => "123");
    const balance = await mtBalance({
      accountId: "alice.near",
      tokenId: "nep141:wrap.near",
      view,
    });
    expect(balance).toBe("123");
    expect(view).toHaveBeenCalledWith({
      contractId: "intents.near",
      methodName: "mt_balance_of",
      args: { account_id: "alice.near", token_id: "nep141:wrap.near" },
    });
  });

  it("maps batch results back onto token ids in order", async () => {
    const view = vi.fn(async () => ["1", "2"]);
    const balances = await mtBatchBalances({
      accountId: "alice.near",
      tokenIds: ["nep141:a.near", "nep141:b.near"],
      view,
    });
    expect(balances).toEqual({ "nep141:a.near": "1", "nep141:b.near": "2" });
  });

  it("rejects mismatched batch result lengths", async () => {
    const view = vi.fn(async () => ["1"]);
    await expect(
      mtBatchBalances({
        accountId: "a.near",
        tokenIds: ["nep141:a.near", "nep141:b.near"],
        view,
      }),
    ).rejects.toThrow(/1 results for 2/);
  });
});
