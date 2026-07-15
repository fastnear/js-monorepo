import pkg from "./package.json";
import { createFastNearTsupConfig } from "../../scripts/tsup-config";

const globalName = "near";

const footer = `
try {
  Object.defineProperty(globalThis, '${globalName}', {
    value: ${globalName},
    enumerable: true,
    configurable: false,
  });
} catch (error) {
  console.error('Could not define global "near" object', error);
  throw error;
}

if (typeof globalThis !== 'undefined' && typeof globalThis.$$ === 'undefined') {
  globalThis.$$ = near.utils.convertUnit;
}

if (typeof window !== 'undefined' && typeof window.$$ === 'undefined') {
  window.$$ = near.utils.convertUnit;
}

if (typeof globalThis.nearWallet !== 'undefined') {
  near.useWallet(globalThis.nearWallet);
}
`;

export default createFastNearTsupConfig({
  manifest: pkg,
  bannerName: "API",
  globalName,
  footer,
  iifePlatform: "browser",
});
