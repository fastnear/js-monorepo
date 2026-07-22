import pkg from "./package.json";
import { createFastNearTsupConfig } from "../../scripts/tsup-config";

export default createFastNearTsupConfig({
  manifest: pkg,
  bannerName: "intents",
  globalName: "nearIntents",
  moduleEntries: {
    index: "src/index.ts",
    relay: "src/relay.ts",
    node: "src/node.ts",
  },
});
