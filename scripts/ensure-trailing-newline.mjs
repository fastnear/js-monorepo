import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];

if (!file) {
  throw new Error("Usage: node scripts/ensure-trailing-newline.mjs <file>");
}

const source = readFileSync(file, "utf8");

if (!source.endsWith("\n")) {
  writeFileSync(file, `${source}\n`);
}
