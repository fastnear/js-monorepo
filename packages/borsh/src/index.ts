// Lean borsh serializer/deserializer for NEAR Protocol.
// API-compatible with the `borsh` npm package for the subset of schemas NEAR uses.
// Supports: u8, u16, u32, u64, u128, string, struct, enum, array (fixed + dynamic), option.
// Omits: bool, signed integers, f32/f64, set, map, schema validation, runtime type checking.

// ── Types ──────────────────────────────────────────────────────────────────────

export type IntegerType = "u8" | "u16" | "u32" | "u64" | "u128";

export type StringType = "string";

export type OptionType = { option: Schema };

export type ArrayType = { array: { type: Schema; len?: number } };

export type EnumType = { enum: Array<StructType> };

export type StructType = { struct: { [key: string]: Schema } };

export type Schema = IntegerType | StringType | OptionType | ArrayType | EnumType | StructType;

// ── Encode buffer ──────────────────────────────────────────────────────────────

class EncodeBuffer {
  private offset = 0;
  private bufferSize = 256;
  private buffer = new ArrayBuffer(this.bufferSize);
  private view = new DataView(this.buffer);

  private resize(needed: number): void {
    if (this.bufferSize - this.offset < needed) {
      this.bufferSize = Math.max(this.bufferSize * 2, this.bufferSize + needed);
      const next = new ArrayBuffer(this.bufferSize);
      new Uint8Array(next).set(new Uint8Array(this.buffer));
      this.buffer = next;
      this.view = new DataView(next);
    }
  }

  storeU8(v: number): void {
    this.resize(1);
    this.view.setUint8(this.offset, v);
    this.offset += 1;
  }

  storeU16(v: number): void {
    this.resize(2);
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
  }

  storeU32(v: number): void {
    this.resize(4);
    this.view.setUint32(this.offset, v, true);
    this.offset += 4;
  }

  storeBytes(from: Uint8Array): void {
    this.resize(from.length);
    new Uint8Array(this.buffer).set(from, this.offset);
    this.offset += from.length;
  }

  result(): Uint8Array {
    return new Uint8Array(this.buffer).slice(0, this.offset);
  }
}

// ── Decode buffer ──────────────────────────────────────────────────────────────

class DecodeBuffer {
  private offset = 0;
  private view: DataView;
  private bytes: Uint8Array;

  constructor(buf: Uint8Array) {
    const ab = new ArrayBuffer(buf.length);
    new Uint8Array(ab).set(buf);
    this.view = new DataView(ab);
    this.bytes = new Uint8Array(ab);
  }

  private assert(size: number): void {
    if (this.offset + size > this.bytes.length) {
      throw new Error("Borsh: buffer overrun");
    }
  }

  readU8(): number {
    this.assert(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  readU16(): number {
    this.assert(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readU32(): number {
    this.assert(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readBytes(len: number): Uint8Array {
    this.assert(len);
    const slice = this.bytes.slice(this.offset, this.offset + len);
    this.offset += len;
    return slice;
  }
}

// ── Bigint helpers ─────────────────────────────────────────────────────────────

function encodeBigint(buf: EncodeBuffer, value: bigint, byteLen: number): void {
  const out = new Uint8Array(byteLen);
  let v = value;
  for (let i = 0; i < byteLen; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  buf.storeBytes(out);
}

function decodeBigint(buf: DecodeBuffer, byteLen: number): bigint {
  const bytes = buf.readBytes(byteLen);
  const hex = bytes.reduceRight((r, x) => r + x.toString(16).padStart(2, "0"), "");
  return BigInt("0x" + hex);
}

// ── UTF-8 helpers (no TextEncoder/TextDecoder dependency) ──────────────────────

function utf8Encode(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function utf8Decode(bytes: Uint8Array): string {
  const codePoints: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) {
      codePoints.push(b);
    } else if (b < 0xe0) {
      codePoints.push(((b & 0x1f) << 6) | (bytes[++i] & 0x3f));
    } else if (b < 0xf0) {
      codePoints.push(((b & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
    } else {
      codePoints.push(((b & 0x07) << 18) | ((bytes[++i] & 0x3f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
    }
  }
  return String.fromCodePoint(...codePoints);
}

// ── Serializer ─────────────────────────────────────────────────────────────────

function encodeValue(buf: EncodeBuffer, value: any, schema: Schema): void {
  if (typeof schema === "string") {
    switch (schema) {
      case "u8":
        return buf.storeU8(value);
      case "u16":
        return buf.storeU16(value);
      case "u32":
        return buf.storeU32(value);
      case "u64":
        return encodeBigint(buf, BigInt(value), 8);
      case "u128":
        return encodeBigint(buf, BigInt(value), 16);
      case "string": {
        const encoded = utf8Encode(value);
        buf.storeU32(encoded.length);
        buf.storeBytes(encoded);
        return;
      }
    }
  }

  if (typeof schema === "object") {
    if ("option" in schema) {
      if (value === null || value === undefined) {
        buf.storeU8(0);
      } else {
        buf.storeU8(1);
        encodeValue(buf, value, schema.option);
      }
      return;
    }

    if ("enum" in schema) {
      const valueKey = Object.keys(value)[0];
      const variants = schema.enum;
      for (let i = 0; i < variants.length; i++) {
        const variantKey = Object.keys(variants[i].struct)[0];
        if (valueKey === variantKey) {
          buf.storeU8(i);
          encodeStruct(buf, value, variants[i]);
          return;
        }
      }
      throw new Error(`Borsh: enum key "${valueKey}" not found in schema`);
    }

    if ("array" in schema) {
      if (schema.array.len == null) {
        buf.storeU32(value.length);
      }
      for (let i = 0; i < value.length; i++) {
        encodeValue(buf, value[i], schema.array.type);
      }
      return;
    }

    if ("struct" in schema) {
      encodeStruct(buf, value, schema);
      return;
    }
  }
}

function encodeStruct(buf: EncodeBuffer, value: any, schema: StructType): void {
  for (const key of Object.keys(schema.struct)) {
    encodeValue(buf, value[key], schema.struct[key]);
  }
}

// ── Deserializer ───────────────────────────────────────────────────────────────

function decodeValue(buf: DecodeBuffer, schema: Schema): any {
  if (typeof schema === "string") {
    switch (schema) {
      case "u8":
        return buf.readU8();
      case "u16":
        return buf.readU16();
      case "u32":
        return buf.readU32();
      case "u64":
        return decodeBigint(buf, 8);
      case "u128":
        return decodeBigint(buf, 16);
      case "string": {
        const len = buf.readU32();
        return utf8Decode(buf.readBytes(len));
      }
    }
  }

  if (typeof schema === "object") {
    if ("option" in schema) {
      const flag = buf.readU8();
      if (flag === 1) return decodeValue(buf, schema.option);
      if (flag === 0) return null;
      throw new Error(`Borsh: invalid option flag ${flag}`);
    }

    if ("enum" in schema) {
      const idx = buf.readU8();
      if (idx >= schema.enum.length) {
        throw new Error(`Borsh: enum index ${idx} out of range`);
      }
      const variant = schema.enum[idx];
      const result: Record<string, any> = {};
      for (const key of Object.keys(variant.struct)) {
        result[key] = decodeValue(buf, variant.struct[key]);
      }
      return result;
    }

    if ("array" in schema) {
      const len = schema.array.len ?? buf.readU32();
      const result: any[] = [];
      for (let i = 0; i < len; i++) {
        result.push(decodeValue(buf, schema.array.type));
      }
      return result;
    }

    if ("struct" in schema) {
      const result: Record<string, any> = {};
      for (const key in schema.struct) {
        result[key] = decodeValue(buf, schema.struct[key]);
      }
      return result;
    }
  }

  throw new Error(`Borsh: unsupported schema: ${JSON.stringify(schema)}`);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function serialize(schema: Schema, value: unknown): Uint8Array {
  const buf = new EncodeBuffer();
  encodeValue(buf, value, schema);
  return buf.result();
}

export function deserialize(schema: Schema, buffer: Uint8Array): any {
  const buf = new DecodeBuffer(buffer);
  return decodeValue(buf, schema);
}
