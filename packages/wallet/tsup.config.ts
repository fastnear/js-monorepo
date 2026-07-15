import pkg from "./package.json";
import { createFastNearTsupConfig } from "../../scripts/tsup-config";

const globalName = "nearWallet";

const footer = `
try {
  Object.defineProperty(globalThis, '${globalName}', {
    value: ${globalName},
    enumerable: true,
    configurable: false,
  });
} catch (error) {
  console.error('Could not define global "nearWallet" object', error);
  throw error;
}

if (typeof globalThis.near !== 'undefined' && globalThis.near.useWallet) {
  globalThis.near.useWallet(${globalName});
}
`;

export default createFastNearTsupConfig({
  manifest: pkg,
  bannerName: "Wallet Connector",
  globalName,
  footer,
  iifePlatform: "browser",
});
