import {
  generateSigner,
  verifyHash,
} from "../dist/esm/index.js";

const iterations = Number.parseInt(process.env.ML_DSA_65_BENCH_ITERATIONS ?? "10", 10);
if (!Number.isSafeInteger(iterations) || iterations < 1) {
  throw new Error("ML_DSA_65_BENCH_ITERATIONS must be a positive integer");
}

const hash = new Uint8Array(32);
const samples = {
  keygenMs: [],
  signMs: [],
  verifyMs: [],
};

const heapBefore = process.memoryUsage().heapUsed;
for (let index = 0; index < iterations; index += 1) {
  let start = performance.now();
  const signer = generateSigner();
  samples.keygenMs.push(performance.now() - start);

  start = performance.now();
  const signature = signer.signHash(hash);
  samples.signMs.push(performance.now() - start);

  start = performance.now();
  if (!verifyHash({ hash, signature, publicKey: signer.publicKey })) {
    throw new Error("Benchmark signature did not verify");
  }
  samples.verifyMs.push(performance.now() - start);
  signer.destroy();
}
const heapAfter = process.memoryUsage().heapUsed;

const stats = (values) => ({
  min: Math.min(...values),
  mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  max: Math.max(...values),
});

console.log(JSON.stringify({
  schemaVersion: 1,
  algorithm: "ML-DSA-65",
  runtime: {
    name: "node",
    version: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  iterations,
  milliseconds: {
    keygen: stats(samples.keygenMs),
    sign: stats(samples.signMs),
    verify: stats(samples.verifyMs),
  },
  heapDeltaBytes: heapAfter - heapBefore,
}, null, 2));
