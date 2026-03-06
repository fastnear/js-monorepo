import { describe, it, expect } from "vitest";
import { serialize, deserialize } from "./index.js";
import type { Schema } from "./index.js";

// ── Helpers ──────────────────────────────────────────────────────────

function checkEncode(value: unknown, schema: Schema, expected: number[]) {
  const encoded = serialize(schema, value);
  expect(encoded).toEqual(Uint8Array.from(expected));
}

function checkDecode(expected: unknown, schema: Schema, encoded: number[]) {
  const decoded = deserialize(schema, Uint8Array.from(encoded));
  expect(decoded).toEqual(expected);
}

function checkRoundtrip(value: unknown, schema: Schema, encoded: number[]) {
  checkEncode(value, schema, encoded);
  checkDecode(value, schema, encoded);
}

// ── Primitives ───────────────────────────────────────────────────────

describe("primitives", () => {
  it("u8 round-trip", () => {
    checkRoundtrip(100, "u8", [100]);
  });

  it("u8 zero", () => {
    checkRoundtrip(0, "u8", [0]);
  });

  it("u8 max (255)", () => {
    checkRoundtrip(255, "u8", [255]);
  });

  it("u16 round-trip", () => {
    checkRoundtrip(258, "u16", [2, 1]);
  });

  it("u16 zero", () => {
    checkRoundtrip(0, "u16", [0, 0]);
  });

  it("u32 round-trip", () => {
    checkRoundtrip(102, "u32", [102, 0, 0, 0]);
  });

  it("u32 zero", () => {
    checkRoundtrip(0, "u32", [0, 0, 0, 0]);
  });
});

// ── BigInt types ─────────────────────────────────────────────────────

describe("bigint types", () => {
  it("u64 round-trip", () => {
    checkRoundtrip(103n, "u64", [103, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("u64 zero", () => {
    checkRoundtrip(0n, "u64", [0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("u64 max (2^64 - 1)", () => {
    checkRoundtrip(
      BigInt("18446744073709551615"),
      "u64",
      [255, 255, 255, 255, 255, 255, 255, 255],
    );
  });

  it("u64 value > u32 max", () => {
    // 4294967297 = 2^32 + 1
    checkRoundtrip(
      BigInt("4294967297"),
      "u64",
      [1, 0, 0, 0, 1, 0, 0, 0],
    );
  });

  it("u128 round-trip", () => {
    checkRoundtrip(
      104n,
      "u128",
      [104, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    );
  });

  it("u128 zero", () => {
    checkRoundtrip(
      0n,
      "u128",
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    );
  });

  it("u128 max (2^128 - 1)", () => {
    checkRoundtrip(
      BigInt("340282366920938463463374607431768211455"),
      "u128",
      Array(16).fill(255),
    );
  });

  it("u128 value 128", () => {
    checkRoundtrip(
      128n,
      "u128",
      [128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    );
  });
});

// ── Strings ──────────────────────────────────────────────────────────

describe("strings", () => {
  it("ASCII with quotes", () => {
    checkRoundtrip('h"i', "string", [3, 0, 0, 0, 104, 34, 105]);
  });

  it("empty string", () => {
    checkRoundtrip("", "string", [0, 0, 0, 0]);
  });

  it("Unicode with accents (Chévere)", () => {
    checkRoundtrip(
      "Chévere",
      "string",
      [8, 0, 0, 0, 67, 104, 195, 169, 118, 101, 114, 101],
    );
  });

  it("Unicode multi-script", () => {
    checkRoundtrip(
      "!ǬЇЉي࠺👍ઠ൧࿄ሒᘻᏠᬅᡝ࠻",
      "string",
      [
        43, 0, 0, 0, 33, 199, 172, 208, 135, 208, 137, 217, 138, 224, 160,
        186, 240, 159, 145, 141, 224, 170, 160, 224, 181, 167, 224, 191, 132,
        225, 136, 146, 225, 152, 187, 225, 143, 160, 225, 172, 133, 225, 161,
        157, 224, 160, 187,
      ],
    );
  });

  it("Unicode with CJK and emoji", () => {
    checkRoundtrip(
      "óñ@‡؏ث 漢࠶⭐🔒\u{100000}",
      "string",
      [
        30, 0, 0, 0, 195, 179, 195, 177, 64, 226, 128, 161, 216, 143, 216,
        171, 32, 230, 188, 162, 224, 160, 182, 226, 173, 144, 240, 159, 148,
        146, 244, 128, 128, 128,
      ],
    );
  });

  it("Unicode copyright, mathematical, snowman", () => {
    checkRoundtrip(
      "f © bar 𝌆 baz ☃ qux",
      "string",
      [
        25, 0, 0, 0, 102, 32, 194, 169, 32, 98, 97, 114, 32, 240, 157, 140,
        134, 32, 98, 97, 122, 32, 226, 152, 131, 32, 113, 117, 120,
      ],
    );
  });
});

// ── Arrays ───────────────────────────────────────────────────────────

describe("arrays", () => {
  it("dynamic u8 array (length-prefixed)", () => {
    checkRoundtrip([1, 2, 3], { array: { type: "u8" } }, [3, 0, 0, 0, 1, 2, 3]);
  });

  it("fixed-length u8 array", () => {
    checkRoundtrip([1, 2], { array: { type: "u8", len: 2 } }, [1, 2]);
  });

  it("empty dynamic array", () => {
    checkRoundtrip([], { array: { type: "u8" } }, [0, 0, 0, 0]);
  });

  it("nested array (array of arrays of strings)", () => {
    checkRoundtrip(
      [["testing"], ["testing"]],
      { array: { type: { array: { type: "string" } } } },
      [
        2, 0, 0, 0, 1, 0, 0, 0, 7, 0, 0, 0, 116, 101, 115, 116, 105, 110,
        103, 1, 0, 0, 0, 7, 0, 0, 0, 116, 101, 115, 116, 105, 110, 103,
      ],
    );
  });

  it("array of u32", () => {
    checkRoundtrip(
      [21, 11],
      { array: { type: "u32" } },
      [2, 0, 0, 0, 21, 0, 0, 0, 11, 0, 0, 0],
    );
  });

  it("array of u64", () => {
    checkRoundtrip(
      [BigInt("10000000000"), 100000000000n],
      { array: { type: "u64" } },
      [
        2, 0, 0, 0, 0, 228, 11, 84, 2, 0, 0, 0, 0, 232, 118, 72, 23, 0, 0, 0,
      ],
    );
  });

  it("array of fixed-length u8 arrays", () => {
    checkRoundtrip(
      [[240, 241], [240, 241]],
      { array: { type: { array: { type: "u8", len: 2 } } } },
      [2, 0, 0, 0, 240, 241, 240, 241],
    );
  });
});

// ── Options ──────────────────────────────────────────────────────────

describe("options", () => {
  it("null option encodes as [0]", () => {
    checkRoundtrip(null, { option: "u8" }, [0]);
  });

  it("present option encodes as [1, value...]", () => {
    checkRoundtrip(1, { option: "u32" }, [1, 1, 0, 0, 0]);
  });

  it("undefined treated as null", () => {
    checkEncode(undefined, { option: "u8" }, [0]);
  });
});

// ── Structs ──────────────────────────────────────────────────────────

describe("structs", () => {
  // Adapted from borsh-js Numbers struct — only unsigned types (no bool, signed, floats)
  it("unsigned numbers struct", () => {
    const value = { u8: 1, u16: 2, u32: 3, u64: 4n, u128: 5n };
    const schema: Schema = {
      struct: { u8: "u8", u16: "u16", u32: "u32", u64: "u64", u128: "u128" },
    };
    const expected = [
      1, 2, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
    ];
    checkRoundtrip(value, schema, expected);
  });

  // Ported from borsh-js Options struct
  it("options struct", () => {
    const value = { u32: 2, option: null, u8: 1 };
    const schema: Schema = {
      struct: {
        u32: { option: "u32" },
        option: { option: "string" },
        u8: { option: "u8" },
      },
    };
    checkRoundtrip(value, schema, [1, 2, 0, 0, 0, 0, 1, 1]);
  });

  // Ported from borsh-js Nested struct
  it("nested struct", () => {
    const value = { a: { sa: { n: 1 } }, b: 2, c: 3 };
    const schema: Schema = {
      struct: {
        a: { struct: { sa: { struct: { n: "u8" } } } },
        b: "u16",
        c: "u32",
      },
    };
    checkRoundtrip(value, schema, [1, 2, 0, 3, 0, 0, 0]);
  });

  // Ported from borsh-js BigStruct — u64 max, u128 max, large fixed array
  it("big struct (u64 max, u128 max, 254-byte array)", () => {
    const value = {
      u64: BigInt("18446744073709551615"),
      u128: BigInt("340282366920938463463374607431768211455"),
      arr: [...Array(254).keys()],
    };
    const schema: Schema = {
      struct: {
        u64: "u64",
        u128: "u128",
        arr: { array: { type: "u8", len: 254 } },
      },
    };
    const expected = Array(24).fill(255).concat([...Array(254).keys()]);
    checkRoundtrip(value, schema, expected);
  });

  it("empty struct", () => {
    checkRoundtrip({}, { struct: {} }, []);
  });

  // Adapted from borsh-js Mixture — excluding bool, i32, i64
  it("complex mixture (adapted from borsh-js)", () => {
    const value = {
      foo: 321,
      u64Val: BigInt("4294967297"),
      baz: "testing",
      uint8array: [240, 241],
      arr: [["testing"], ["testing"]],
      u32Arr: [21, 11],
      u128Val: 128n,
      uint8arrays: [[240, 241], [240, 241]],
      u64Arr: [BigInt("10000000000"), 100000000000n],
    };
    const schema: Schema = {
      struct: {
        foo: "u32",
        u64Val: "u64",
        baz: "string",
        uint8array: { array: { type: "u8", len: 2 } },
        arr: { array: { type: { array: { type: "string" } } } },
        u32Arr: { array: { type: "u32" } },
        u128Val: "u128",
        uint8arrays: { array: { type: { array: { type: "u8", len: 2 } } } },
        u64Arr: { array: { type: "u64" } },
      },
    };
    const encoded = serialize(schema, value);
    const decoded = deserialize(schema, encoded);
    expect(decoded).toEqual(value);
  });
});

// ── Enums ────────────────────────────────────────────────────────────

describe("enums", () => {
  const enumSchema: Schema = {
    enum: [
      { struct: { variant0: { struct: { x: "u8" } } } },
      { struct: { variant1: { struct: { y: "u16" } } } },
    ],
  };

  it("first variant (index 0)", () => {
    checkRoundtrip({ variant0: { x: 42 } }, enumSchema, [0, 42]);
  });

  it("second variant (index 1)", () => {
    checkRoundtrip({ variant1: { y: 300 } }, enumSchema, [1, 44, 1]);
  });

  it("throws on unknown variant", () => {
    expect(() => serialize(enumSchema, { unknown: {} })).toThrow(
      'Borsh: enum key "unknown" not found in schema',
    );
  });

  // Ported from borsh-js: enum wrapping a complex struct
  it("enum wrapping unsigned numbers struct", () => {
    const numbersValue = { u8: 1, u16: 2, u32: 3, u64: 4n, u128: 5n };
    const numbersSchema: Schema = {
      struct: { u8: "u8", u16: "u16", u32: "u32", u64: "u64", u128: "u128" },
    };
    const numbersEncoded = [
      1, 2, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
    ];

    const wrappedSchema: Schema = {
      enum: [
        { struct: { numbers: numbersSchema } },
        { struct: { other: { struct: { v: "u8" } } } },
      ],
    };

    checkRoundtrip(
      { numbers: numbersValue },
      wrappedSchema,
      [0].concat(numbersEncoded),
    );
  });
});

// ── Schema order ─────────────────────────────────────────────────────

describe("schema order", () => {
  it("serialization follows schema key order, not object key order", () => {
    const schema: Schema = { struct: { a: "u8", b: "u8" } };
    // Object has b before a, but encoding should follow schema order (a first)
    checkEncode({ b: 2, a: 1 }, schema, [1, 2]);
    checkDecode({ a: 1, b: 2 }, schema, [1, 2]);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────

describe("edge cases", () => {
  it("buffer overrun throws", () => {
    expect(() => deserialize("u32", Uint8Array.from([1, 2]))).toThrow(
      "Borsh: buffer overrun",
    );
  });

  it("invalid option flag throws", () => {
    expect(() =>
      deserialize({ option: "u8" }, Uint8Array.from([2])),
    ).toThrow("Borsh: invalid option flag 2");
  });

  it("enum index out of range throws", () => {
    const schema: Schema = {
      enum: [{ struct: { a: { struct: { x: "u8" } } } }],
    };
    expect(() => deserialize(schema, Uint8Array.from([5]))).toThrow(
      "Borsh: enum index 5 out of range",
    );
  });

  it("fixed-length array of 32 zero bytes", () => {
    const bytes = new Array(32).fill(0);
    checkRoundtrip(bytes, { array: { type: "u8", len: 32 } }, bytes);
  });
});
