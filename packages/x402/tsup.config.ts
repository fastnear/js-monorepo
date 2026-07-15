import pkg from "./package.json";
import { createFastNearTsupConfig } from "../../scripts/tsup-config";

export default createFastNearTsupConfig({
  manifest: pkg,
  bannerName: "x402",
  globalName: "nearX402",
  moduleEntries: {
    index: "src/index.ts",
    node: "src/node.ts",
    server: "src/server.ts",
    facilitator: "src/facilitator.ts",
  },
});
