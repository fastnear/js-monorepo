import pkg from "./package.json";
import { createFastNearTsupConfig } from "../../scripts/tsup-config";

export default createFastNearTsupConfig({
  manifest: pkg,
  bannerName: "Seed Phrase",
  globalName: "NearSeedPhrase",
  // @scure/bip39's wordlist type graph stalls the DTS bundler; this package
  // exposes only its own types, so external type resolution isn't needed.
  dtsResolve: false,
});
