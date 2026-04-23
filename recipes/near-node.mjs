const DEFAULT_CDN_BASE = "https://js.fastnear.com";
const CDN_BASE = (process.env.FASTNEAR_CDN_BASE || DEFAULT_CDN_BASE).replace(/\/$/, "");
const NEAR_CDN_URL = `${CDN_BASE}/near.js`;

async function readStdin() {
  process.stdin.setEncoding("utf8");

  let source = "";
  for await (const chunk of process.stdin) {
    source += chunk;
  }

  return source;
}

async function fetchNearBundle() {
  const response = await fetch(NEAR_CDN_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${NEAR_CDN_URL}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function getFastnearApiKey() {
  if (typeof process === "undefined" || !process.env) {
    return null;
  }

  const value = process.env.FASTNEAR_API_KEY;
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

async function main() {
  const [{ default: vm }, nearSource, userSource] = await Promise.all([
    import("node:vm"),
    fetchNearBundle(),
    readStdin(),
  ]);

  // Older published UMD bundles still expect a browser-like global.
  if (typeof globalThis.window === "undefined") {
    globalThis.window = globalThis;
  }

  vm.runInThisContext(`${nearSource}\n`, { filename: "near.js" });

  const apiKey = getFastnearApiKey();
  if (apiKey && globalThis.near && typeof globalThis.near.config === "function") {
    globalThis.near.config({ apiKey });
  }

  await vm.runInThisContext(`(async () => {\n${userSource}\n})()`, {
    filename: "user-snippet.js",
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
