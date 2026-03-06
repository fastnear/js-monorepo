import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
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
    },
  },
});
