import pkg from "./package.json";
import { createFastNearTsupConfig } from "../../scripts/tsup-config";

export default createFastNearTsupConfig({
  manifest: pkg,
  bannerName: "Borsh Schema",
  globalName: "NearBorshSchema",
});
