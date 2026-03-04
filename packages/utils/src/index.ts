export * from "./crypto.js";
export * from "./transaction.js";
export * from "./misc.js";
export * from "./storage.js";

import { serialize, deserialize } from "@fastnear/borsh";
import * as borshSchema from "@fastnear/borsh-schema";

// exports (or re-exports as well)
const exp = {
  borsh: {
    serialize,
    deserialize
  },
  borshSchema,
}

export { exp }
