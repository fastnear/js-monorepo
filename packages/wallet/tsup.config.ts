import { defineConfig } from 'tsup'
/* @ts-ignore */
// we'll get this package's name and version for the banner
import pkg from './package.json'

const globalName = 'nearWallet'
const friendlyPackageName = 'Wallet Connector'

// Aids in certain guards on the global's mutability
const footerRedefiningGlobal = `
Object.defineProperty(globalThis, '${globalName}', {
  value: ${globalName},
  enumerable: true,
  configurable: false,
});

// Auto-wire with @fastnear/api if it loaded first
if (typeof globalThis.near !== 'undefined' && globalThis.near.useWallet) {
  globalThis.near.useWallet(${globalName});
}
`

export default defineConfig([
  {
    entry: ['src/**/*.ts'],
    outDir: 'dist/cjs',
    format: ['cjs'],
    splitting: false,
    bundle: false,
    dts: {
      resolve: true,
      entry: 'src/index.ts',
    },
    sourcemap: true,
    minify: false,
    clean: true,
    keepNames: true,
    banner: {
      js: `/* ⋈ 🏃🏻💨 FastNear ${friendlyPackageName} - CJS (${pkg.name} version ${pkg.version}) */\n` +
        `/* https://www.npmjs.com/package/${pkg.name}/v/${pkg.version} */`,
    },
  },
  {
    entry: ['src/**/*.ts'],
    outDir: 'dist/esm',
    format: ['esm'],
    shims: true,
    splitting: false,
    bundle: false,
    dts: {
      resolve: true,
      entry: 'src/index.ts',
    },
    sourcemap: true,
    minify: false,
    clean: true,
    keepNames: true,
    banner: {
      js: `/* ⋈ 🏃🏻💨 FastNear ${friendlyPackageName} - ESM (${pkg.name} version ${pkg.version}) */\n` +
        `/* https://www.npmjs.com/package/${pkg.name}/v/${pkg.version} */`,
    },
  },
  {
    entry: {
      browser: 'src/index.ts',
    },
    outDir: 'dist/umd',
    format: ['iife'],
    globalName,
    sourcemap: true,
    minify: false,
    splitting: false,
    bundle: true,
    dts: false,
    clean: true,
    keepNames: true,
    platform: 'browser',
    // WalletConnect dependencies use require("events") which esbuild can't
    // statically resolve. Alias it to the browser polyfill.
    alias: {
      events: 'events',
    },
    esbuildOptions(options) {
      // Exclude @walletconnect/sign-client from the IIFE bundle.
      // The connector uses a dynamic import() so WC is only loaded when
      // walletConnect options are provided. This drops the IIFE from ~900KB
      // to ~100KB. Bundled apps (CJS/ESM) resolve WC normally at build time.
      options.external = [...(options.external || []), '@walletconnect/sign-client'];
    },
    banner: {
      js: `/* ⋈ 🏃🏻💨 FastNear ${friendlyPackageName} - IIFE/UMD (${pkg.name} version ${pkg.version}) */\n` +
        `/* https://www.npmjs.com/package/${pkg.name}/v/${pkg.version} */`,
    },
    footer: {
      js: footerRedefiningGlobal,
    }
  },
])
