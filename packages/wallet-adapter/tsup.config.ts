import pkg from "./package.json";
import { createFastNearTsupConfig } from "../../scripts/tsup-config";

export default createFastNearTsupConfig({
  manifest: pkg,
  bannerName: "Wallet Adapters",
  globalName: "nearWalletAdapters",
});
