import { describe, expect, it } from "vitest";
import {
  prepareDelegateActionsForWallet,
  validateBlockHeightTtl,
} from "./delegate-actions.js";

const transfer = {
  receiverId: "token.near",
  actions: [{ type: "Transfer", deposit: "1" } as any],
};

describe("delegate action timeout bridge", () => {
  it("preserves the requested TTL while converting flat actions", () => {
    expect(
      prepareDelegateActionsForWallet(
        [{ ...transfer, blockHeightTtl: 300 }],
        { signDelegateActionsWithTtl: true },
      ),
    ).toEqual([
      {
        receiverId: "token.near",
        blockHeightTtl: 300,
        actions: [{ type: "Transfer", params: { deposit: "1" } }],
      },
    ]);
  });

  it("does not require the new capability for legacy requests", () => {
    expect(prepareDelegateActionsForWallet([transfer])).toHaveLength(1);
  });

  it("requires an explicitly advertised timeout-aware capability", () => {
    expect(() =>
      prepareDelegateActionsForWallet([{ ...transfer, blockHeightTtl: 300 }]),
    ).toThrow("signDelegateActionsWithTtl");
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid TTL %s",
    (ttl) => {
      expect(() => validateBlockHeightTtl(ttl)).toThrow(
        "positive safe integer",
      );
    },
  );
});
