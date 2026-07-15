import { defineConfig, type Options } from "tsup";

type PackageManifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
};

export interface FastNearTsupOptions {
  manifest: PackageManifest;
  bannerName: string;
  globalName: string;
  footer?: string;
  sourceEntries?: string[];
  iifePlatform?: Options["platform"];
}

export function lockedGlobalFooter(globalName: string): string {
  return `
Object.defineProperty(globalThis, '${globalName}', {
  value: ${globalName},
  enumerable: true,
  configurable: false,
});
`;
}

function banner(manifest: PackageManifest, bannerName: string, format: string): string {
  return `/* ⋈ 🏃🏻💨 FastNear ${bannerName} - ${format} (${manifest.name} version ${manifest.version}) */\n` +
    `/* https://www.npmjs.com/package/${manifest.name}/v/${manifest.version} */`;
}

/**
 * Standard FastNear package build:
 * - CJS bundles package-internal modules into one resolvable entry while
 *   retaining workspace/third-party dependencies as external requires.
 * - ESM remains unbundled and tree-shakeable.
 * - IIFE bundles every dependency into one browser-ready global.
 */
export function createFastNearTsupConfig({
  manifest,
  bannerName,
  globalName,
  footer = lockedGlobalFooter(globalName),
  sourceEntries = ["src/**/*.ts", "!src/**/*.test.ts"],
  iifePlatform,
}: FastNearTsupOptions) {
  return defineConfig([
    {
      entry: { index: "src/index.ts" },
      outDir: "dist/cjs",
      format: ["cjs"],
      bundle: true,
      external: Object.keys(manifest.dependencies ?? {}),
      splitting: false,
      clean: true,
      keepNames: true,
      dts: { resolve: true, entry: "src/index.ts" },
      sourcemap: true,
      minify: false,
      banner: { js: banner(manifest, bannerName, "CJS") },
    },
    {
      entry: sourceEntries,
      outDir: "dist/esm",
      format: ["esm"],
      bundle: false,
      splitting: false,
      clean: true,
      keepNames: true,
      shims: true,
      dts: { resolve: true, entry: "src/index.ts" },
      sourcemap: true,
      minify: false,
      banner: { js: banner(manifest, bannerName, "ESM") },
    },
    {
      entry: { browser: "src/index.ts" },
      outDir: "dist/umd",
      format: ["iife"],
      globalName,
      bundle: true,
      splitting: false,
      clean: true,
      keepNames: true,
      dts: false,
      sourcemap: true,
      minify: false,
      platform: iifePlatform,
      banner: { js: banner(manifest, bannerName, "IIFE/UMD") },
      footer: { js: footer },
    },
  ]);
}
