import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  assertTarballIntegrity,
  exactPublishedVersion,
  extractTarEntry,
  verifyPublishedX402,
} from "./published-x402-helpers.mjs";

function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function makeTarball(entries) {
  const parts = [];
  for (const [name, value] of entries) {
    const body = Buffer.from(value);
    parts.push(tarHeader(name, body.length), body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

const version = "1.5.0-beta.0";
const iife = `var nearX402 = {
  createFastNearWalletSigner() {},
  createNearPaymentFetch() {},
  createNearX402Client() {},
};
Object.defineProperty(globalThis, "nearX402", {
  value: nearX402,
  enumerable: true,
  configurable: false,
});
`;

function fixtureModuleSource(target) {
  if (target.endsWith("/browser.global.js")) return iife;
  const probes = target.includes("/facilitator.")
    ? ["createNearFacilitator"]
    : target.includes("/server.")
      ? ["createNearResourceServer"]
      : target.includes("/node.")
        ? ["createLocalNearSigner"]
        : [
            "createFastNearWalletSigner",
            "createNearPaymentFetch",
            "createNearX402Client",
          ];
  if (target.endsWith(".cjs")) {
    return probes.map((probe) => `exports.${probe} = function ${probe}() {};`).join("\n");
  }
  return probes.map((probe) => `export function ${probe}() {}`).join("\n");
}

function fixture() {
  const manifest = {
    name: "@fastnear/x402",
    version,
    main: "./dist/cjs/index.cjs",
    module: "./dist/esm/index.js",
    types: "./dist/esm/index.d.ts",
    browser: "./dist/umd/browser.global.js",
    exports: {
      ".": {
        require: "./dist/cjs/index.cjs",
        import: "./dist/esm/index.js",
        types: "./dist/esm/index.d.ts",
      },
      "./node": {
        require: "./dist/cjs/node.cjs",
        import: "./dist/esm/node.js",
        types: "./dist/esm/node.d.ts",
      },
      "./server": {
        require: "./dist/cjs/server.cjs",
        import: "./dist/esm/server.js",
        types: "./dist/esm/server.d.ts",
      },
      "./facilitator": {
        require: "./dist/cjs/facilitator.cjs",
        import: "./dist/esm/facilitator.js",
        types: "./dist/esm/facilitator.d.ts",
      },
    },
    peerDependencies: { "@fastnear/wallet": "1.5.0-beta.0" },
    peerDependenciesMeta: { "@fastnear/wallet": { optional: true } },
  };
  const files = new Set([
    manifest.main,
    manifest.module,
    manifest.types,
    manifest.browser,
  ]);
  for (const entry of Object.values(manifest.exports)) {
    for (const target of Object.values(entry)) files.add(target);
  }
  const tarball = makeTarball([
    ["package/package.json", `${JSON.stringify(manifest)}\n`],
    ...[...files].map((target) => [
      `package/${target.slice(2)}`,
      fixtureModuleSource(target),
    ]),
  ]);
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  const shasum = createHash("sha1").update(tarball).digest("hex");
  const tarballUrl =
    `https://registry.npmjs.org/@fastnear/x402/-/x402-${version}.tgz`;
  const metadata = {
    name: "@fastnear/x402",
    version,
    dist: { tarball: tarballUrl, integrity, shasum },
  };
  return { tarball, tarballUrl, metadata };
}

describe("published x402 verifier", () => {
  it("accepts only an exact semver", () => {
    expect(exactPublishedVersion("1.5.0")).toBe("1.5.0");
    expect(exactPublishedVersion(version)).toBe(version);
    for (const invalid of ["latest", "next", "^1.5.0", "v1.5.0", "1.5"]) {
      expect(() => exactPublishedVersion(invalid), invalid).toThrow("exact semver");
    }
  });

  it("extracts entries and verifies npm integrity metadata", () => {
    const { tarball, metadata } = fixture();
    expect(
      JSON.parse(extractTarEntry(tarball, "package/package.json").toString()),
    ).toMatchObject({ name: "@fastnear/x402", version });
    expect(() =>
      assertTarballIntegrity(
        tarball,
        metadata.dist.integrity,
        metadata.dist.shasum,
      )
    ).not.toThrow();
    expect(() =>
      assertTarballIntegrity(tarball, "sha512-bad", metadata.dist.shasum)
    ).toThrow("dist.integrity");
  });

  it("compares the exact jsDelivr IIFE with the verified npm tarball", async () => {
    const { tarball, tarballUrl, metadata } = fixture();
    const urls = [];
    const fetchMock = async (url) => {
      urls.push(url);
      if (url.includes("registry.npmjs.org/@fastnear%2Fx402/")) {
        return new Response(JSON.stringify(metadata));
      }
      if (url === tarballUrl) return new Response(tarball);
      if (url.includes("cdn.jsdelivr.net/")) return new Response(iife);
      return new Response("missing", { status: 404 });
    };

    const result = await verifyPublishedX402(version, fetchMock);
    expect(result).toMatchObject({ version, tarballUrl, iifeBytes: iife.length });
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain(version);
    expect(urls[2]).toContain(`@fastnear/x402@${version}/`);
  });

  it("rejects CDN bytes that differ from npm", async () => {
    const { tarball, tarballUrl, metadata } = fixture();
    const fetchMock = async (url) => {
      if (url.includes("registry.npmjs.org/@fastnear%2Fx402/")) {
        return new Response(JSON.stringify(metadata));
      }
      if (url === tarballUrl) return new Response(tarball);
      return new Response(`${iife}\n// drift`);
    };

    await expect(verifyPublishedX402(version, fetchMock)).rejects.toThrow(
      "jsDelivr IIFE bytes differ",
    );
  });
});
