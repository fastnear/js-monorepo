import { describe, expect, it } from "vitest";
import { toConnectorAction } from "./connector-actions.js";

describe("toConnectorAction AddKey", () => {
  it("normalizes the legacy flat FunctionCall permission for near-connect", () => {
    expect(toConnectorAction({
      type: "AddKey",
      publicKey: "ed25519:11111111111111111111111111111111",
      accessKey: {
        nonce: 0,
        permission: "FunctionCall",
        receiverId: "contract.testnet",
        methodNames: ["ping"],
        allowance: "10",
      },
    })).toEqual({
      type: "AddKey",
      params: {
        publicKey: "ed25519:11111111111111111111111111111111",
        accessKey: {
          nonce: 0,
          permission: {
            receiverId: "contract.testnet",
            methodNames: ["ping"],
            allowance: "10",
          },
        },
      },
    });
  });

  it("preserves the normalized object permission", () => {
    const permission = {
      receiverId: "contract.testnet",
      methodNames: [],
      allowance: null,
    };
    const converted = toConnectorAction({
      type: "AddKey",
      publicKey: "ed25519:11111111111111111111111111111111",
      accessKey: { nonce: 0, permission },
    }) as any;

    expect(converted.params.accessKey.permission).toBe(permission);
  });
});
