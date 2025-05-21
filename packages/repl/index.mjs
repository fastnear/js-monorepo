import "./setup-mock-window.mjs"
import * as api from "fastintear"
import { start } from "repl";

import util from "util";

const { toBase58 } = api.utils

console.log("REPL going. Try `near.` <tab>");
console.log("Use `v(obj)` to print verbose objects in a readable format.");

let r = start({
  prompt: "» ",
  terminal: true,
  useGlobal: true,
  useColors: true,
  preview: true,
  writer: (output) => util.inspect(deepTransform(output), {
    depth: 10,
    colors: true,
    compact: 3,
    breakLength: 100,
    numericSeparator: true,
    maxArrayLength: 3,
  })
});

// Ensure `r.context` is set before assigning values
if (!r.context) {
  throw new Error("REPL context is not available.");
}

r.context.near = api;

const historyPath = '.fastnear-repl-history';
r.setupHistory(historyPath, (err) => {
  if (err) console.warn('History file setup failed:', err);
});

// Debugging mock transaction
r.context.mockTx = {
  transaction: {
    signerId: "mike.near",
    publicKey: { ed25519Key: { data: new Uint8Array([43, 42, 151, 72, 199, 53, 179, 42, 8, 123, 194, 172, 211, 250, 107, 15, 228, 162, 48, 243, 218, 222, 41, 215, 6, 236, 110, 137, 115, 14, 126, 103]) } },
    nonce: "138915472000056",
    receiverId: "berryclub.ek.near",
    // blockHash: new Uint8Array([9, 200, 86, 207, 242, 138, 105, 234, 157, 248, 62, 2, 163, 22, 134, 158, 174, 99, 12, 51, 240, 88, 111, 127, 61, 177, 43, 18, 234, 171, 103, 253]),
    blockHash: new Uint8Array([85,135,31,232,88,212,73,163,9,119,126,75,46,134,99,103,94,101,197,142,119,95,125,36,69,60,92,84,72,121,190,171]),
    actions: [
      {
        functionCall: {
          methodName: "draw",
          args: new Uint8Array([123, 34, 112, 105, 120, 101, 108, 115, 34, 58, 91, 123, 34, 120, 34, 58, 50, 44, 34, 121, 34, 58, 50, 49, 44, 34, 99, 111, 108, 111, 114, 34, 58, 51, 57, 51, 53, 55, 52, 56, 125, 93, 125]),
          gas: "100000000000000",
          deposit: "0",
        },
      },
    ],
  },
  signature: { ed25519Signature: { data: new Uint8Array([249, 246, 195, 70, 237, 194, 62, 136, 248, 144, 192, 136, 242, 61, 221, 240, 131, 208, 27, 121, 93, 77, 167, 19, 180, 198, 153, 95, 168, 236, 89, 12, 120, 81, 133, 15, 116, 27, 223, 190, 168, 32, 28, 147, 175, 16, 226, 112, 48, 203, 126, 117, 193, 47, 169, 38, 64, 3, 246, 251, 4, 190, 80, 9]) } }
};

const encoder = new TextDecoder("utf-8");

const formatArray = (arr) => {
  if (!(arr instanceof Uint8Array)) return arr;
  return `Uint8Array(${arr.length}) [ ${[...arr.slice(0, 3)].join(", ")}, … ]`;
};

const deepTransform = (input) => {
  if (typeof input !== "object" || input === null) return input;

  if (input instanceof Uint8Array) return formatArray(input);

  const newObj = {};
  for (const key in input) {
    if (key === "args" && input[key] instanceof Uint8Array) {
      try {
        const utf8Decoded = encoder.decode(input[key]);
        const jsonParsed = JSON.parse(utf8Decoded);
        newObj["__argsObject"] = jsonParsed;
      } catch (err) {
        // Silently skip invalid JSON
      }
      newObj[key] = formatArray(input[key]);
    } else if (key === "ed25519Signature" && input[key]?.data instanceof Uint8Array) {
      newObj["__signatureBase58"] = toBase58(input[key].data);
      newObj[key] = deepTransform(input[key]);
    } else if (key === "blockHash" && input[key] instanceof Uint8Array) {
      newObj["__blockHashBase58"] = toBase58(input[key]);
      newObj[key] = formatArray(input[key]);
    } else if (key === "ed25519Key" && input[key]?.data instanceof Uint8Array) {
      newObj["__publicKeyBase58"] = toBase58(input[key].data);
      newObj[key] = deepTransform(input[key]);
    } else {
      newObj[key] = deepTransform(input[key]);
    }
  }
  return newObj;
};

r.context.v = (obj, depth = null) => {
  const transformUint8Arrays = (input) => {
    if (input instanceof Uint8Array) {
      return Array.from(input);
    }
    if (typeof input === "object" && input !== null) {
      if (Array.isArray(input)) {
        return input.map(transformUint8Arrays);
      }
      return Object.fromEntries(
        Object.entries(input).map(([key, value]) => [key, transformUint8Arrays(value)])
      );
    }
    return input;
  };

  const transformedObj = transformUint8Arrays(obj);

  console.log(
    util.inspect(obj, {
      depth: null,
      colors: true,
      maxArrayLength: null,
    })
  );

  console.log("\n------ JSON:\n");
  return JSON.stringify(transformedObj, null, '');
};
