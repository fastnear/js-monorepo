import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
  resolve: {
    alias: {
      "@fastnear/borsh": path.resolve(__dirname, "packages/borsh/src"),
      "@fastnear/borsh-schema": path.resolve(
        __dirname,
        "packages/borsh-schema/src",
      ),
      "@fastnear/utils": path.resolve(__dirname, "packages/utils/src"),
      "@fastnear/api": path.resolve(__dirname, "packages/api/src"),
      "@fastnear/ml-dsa-65": path.resolve(
        __dirname,
        "packages/ml-dsa-65/src",
      ),
      "@fastnear/x402/facilitator": path.resolve(
        __dirname,
        "packages/x402/src/facilitator.ts",
      ),
      "@fastnear/x402/server": path.resolve(
        __dirname,
        "packages/x402/src/server.ts",
      ),
      "@fastnear/x402/node": path.resolve(
        __dirname,
        "packages/x402/src/node.ts",
      ),
      "@fastnear/x402": path.resolve(
        __dirname,
        "packages/x402/src/index.ts",
      ),
    },
  },
});
