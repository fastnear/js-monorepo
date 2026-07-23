# @fastnear/borsh

Lean [Borsh](https://borsh.io/) serializer/deserializer for NEAR Protocol. Zero dependencies.

API-compatible with the [`borsh`](https://www.npmjs.com/package/borsh) npm package for the subset of schemas NEAR uses.

## Supported types

`u8`, `u16`, `u32`, `u64`, `u128`, `string`, `struct`, `enum`, `array` (fixed + dynamic), `option`

## Wide integers are strings

`u64` and `u128` **decode to decimal strings by default** (`u8`/`u16`/`u32` stay JS numbers). This keeps decoded values JSON-safe (`JSON.stringify` throws on a `bigint`) and consistent with NEAR JSON-RPC, which returns amounts as strings. `serialize` accepts `string | number | bigint`, so a decoded value re-encodes to identical bytes with no conversion:

```js
const schema = { struct: { deposit: "u128" } };
const bytes = serialize(schema, { deposit: 250n });   // bigint | number | string all fine
const value = deserialize(schema, bytes);             // { deposit: "250" }  ← string
JSON.stringify(value);                                 // works — no BigInt in sight
serialize(schema, value);                              // identical bytes

// Opt into native bigint when you need arithmetic:
deserialize(schema, bytes, { bigints: "bigint" });     // { deposit: 250n }
```

> **Breaking in 2.0.0:** decode previously returned `bigint` for `u64`/`u128`. If you relied on that, pass `{ bigints: "bigint" }` or wrap values in `BigInt(...)`.

## Install

```bash
npm install @fastnear/borsh
```

## Usage

```js
import { serialize, deserialize } from "@fastnear/borsh";

const schema = { struct: { name: "string", age: "u8" } };

const encoded = serialize(schema, { name: "Alice", age: 30 });
const decoded = deserialize(schema, encoded);
```

## Browser (IIFE)

```html
<script src="https://cdn.jsdelivr.net/npm/@fastnear/borsh/dist/umd/browser.global.js"></script>
<script>
  // Available as window.NearBorsh
  const { serialize, deserialize } = NearBorsh;
</script>
```

## Part of the FastNear JS monorepo

See the [project-level README](https://github.com/fastnear/js-monorepo) for more info.
