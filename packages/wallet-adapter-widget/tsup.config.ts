import { defineConfig } from 'tsup'

const globalName = 'NearWalletAdapterWidget'
const friendlyPackageName = 'Wallet Adapter Widget'

const externalDeps = [
  'near-api-js',
]

export default defineConfig([
  // 1) CJS
  {
    entry: ['src/index.ts'],
    outDir: 'dist/cjs',
    format: ['cjs'],
    bundle: false, // no bundling => direct output
    splitting: false,
    external: externalDeps,
    dts: {
      resolve: true,
      entry: 'src/index.ts',
    },
    sourcemap: true,
    minify: false,
    clean: true,
    keepNames: true,
    banner: {
      js: `/* ⋈ 🏃🏻💨 FastNEAR ${friendlyPackageName} - CJS */`,
    },
  },
  // 2) ESM
  {
    entry: ['src/index.ts'],
    outDir: 'dist/esm',
    format: ['esm'],
    bundle: false,
    splitting: false,
    external: externalDeps,
    dts: {
      resolve: true,
      entry: 'src/index.ts',
    },
    sourcemap: true,
    minify: false,
    clean: true,
    keepNames: true,
    banner: {
      js: `/* ⋈ 🏃🏻💨 FastNEAR ${friendlyPackageName} - ESM */`,
    },
  },
  // 3) IIFE/UMD
  {
    entry: {
      browser: 'src/index.ts',
    },
    outDir: 'dist/umd',
    format: ['iife'],
    globalName,
    bundle: true,
    splitting: false,
    external: externalDeps,
    dts: false,
    sourcemap: true,
    minify: false,
    clean: true,
    keepNames: true,
    banner: {
      js: `/* ⋈ 🏃🏻💨 FastNEAR ${friendlyPackageName} - IIFE/UMD */`,
    },
  },
])
