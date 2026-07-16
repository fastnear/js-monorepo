#!/usr/bin/env node

import { verifyPublishedX402 } from "./published-x402-helpers.mjs";

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error(
    "Usage: yarn smoke:x402:published <exact-version> (for example, 1.5.0-beta.0)",
  );
  process.exit(1);
}

try {
  const result = await verifyPublishedX402(args[0]);
  console.log(
    `@fastnear/x402@${result.version}: npm integrity, ${result.nodeEntrypoints} CJS/ESM entrypoints, and ${result.iifeBytes}-byte immutable jsDelivr IIFE verified`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
