# Migration notes

## 2.0.0 — wide integers decode to strings

`@fastnear/borsh` `deserialize` now returns **decimal strings** for `u64`/`u128`
by default (previously native `bigint`). This makes decoded transactions,
delegate actions, and any NEAR chain struct JSON-safe (`JSON.stringify` throws
on a `bigint`) and consistent with NEAR JSON-RPC, which returns amounts as
strings. `u8`/`u16`/`u32` are unchanged (JS numbers).

The single rule across the whole `@fastnear` surface:

- **In** — constructing a transaction accepts `string | number | bigint`, plus
  unit strings like `"100 Tgas"` and `"0.01 NEAR"`.
- **Out** — wide integers come back as decimal strings. Inspect a built
  transaction with `near.utils.txToJson` rather than `JSON.stringify`-ing a
  raw `bigint`. You never need `BigInt` to build, send, or read a transaction.

### What to change

Most code needs nothing — a decoded string re-encodes to identical bytes, and
comparisons/logging work as-is. Update only if you did **bigint arithmetic** on
a decoded value:

```js
// before (2.x decoded value is a string, so this throws "Cannot mix BigInt…")
const total = decoded.deposit + 1n;

// option 1 — parse when you need math
const total = BigInt(decoded.deposit) + 1n;

// option 2 — opt back into bigint decoding
const decoded = deserialize(schema, bytes, { bigints: "bigint" });
```

`serialize` is unchanged and still accepts `string | number | bigint`.
