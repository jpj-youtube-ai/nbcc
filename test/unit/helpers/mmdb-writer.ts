// A tiny MaxMind DB (.mmdb) WRITER, for tests only (TASK-481).
//
// The reader in src/analytics/geo-db.ts is written from scratch against the published format
// (https://maxmind.github.io/MaxMind-DB/), so the tests need real .mmdb files to read — built here,
// in memory, from invented data. Nothing real (no real network ranges tied to real places) goes in.
//
// Layout of a file: [search tree][16 zero bytes][data section]["\xAB\xCD\xEFMaxMind.com"][metadata].

const MARKER = Buffer.from([0xab, 0xcd, 0xef, ...Buffer.from("MaxMind.com")]);

// ---- data section encoding --------------------------------------------------------------------

/** An already-encoded field. Anything else is encoded from its JavaScript shape by `encode`. */
export class Raw {
  constructor(readonly buf: Buffer) {}
}

export type Value =
  | Raw
  | string
  | boolean
  | number
  | Value[]
  | { [key: string]: Value };

function control(type: number, size: number): Buffer {
  const head: number[] = [];
  let first = type <= 7 ? type << 5 : 0;
  const ext = type > 7 ? [type - 7] : [];
  let sizeBytes: number[] = [];
  if (size < 29) first |= size;
  else if (size < 29 + 256) {
    first |= 29;
    sizeBytes = [size - 29];
  } else if (size < 285 + 65536) {
    first |= 30;
    const v = size - 285;
    sizeBytes = [v >> 8, v & 0xff];
  } else {
    first |= 31;
    const v = size - 65821;
    sizeBytes = [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  }
  head.push(first, ...ext, ...sizeBytes);
  return Buffer.from(head);
}

function uintBytes(v: bigint): Buffer {
  const out: number[] = [];
  while (v > 0n) {
    out.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return Buffer.from(out);
}

export const str = (s: string): Raw => {
  const b = Buffer.from(s, "utf8");
  return new Raw(Buffer.concat([control(2, b.length), b]));
};
export const dbl = (n: number): Raw => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(n);
  return new Raw(Buffer.concat([control(3, 8), b]));
};
export const bytes = (b: Buffer): Raw => new Raw(Buffer.concat([control(4, b.length), b]));
const uint = (type: number) => (n: number | bigint): Raw => {
  const b = uintBytes(BigInt(n));
  return new Raw(Buffer.concat([control(type, b.length), b]));
};
export const u16 = uint(5);
export const u32 = uint(6);
export const u64 = uint(9);
export const u128 = uint(10);
export const i32 = (n: number): Raw => {
  if (n >= 0) {
    const b = uintBytes(BigInt(n));
    return new Raw(Buffer.concat([control(8, b.length), b]));
  }
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return new Raw(Buffer.concat([control(8, 4), b]));
};
export const bool = (v: boolean): Raw => new Raw(control(14, v ? 1 : 0));
export const flt = (n: number): Raw => {
  const b = Buffer.alloc(4);
  b.writeFloatBE(n);
  return new Raw(Buffer.concat([control(15, 4), b]));
};
/** A map whose entries are given in order; keys may be `Raw` (for example a pointer to a string). */
export const mapOf = (entries: Array<[string | Raw, Value]>): Raw =>
  new Raw(
    Buffer.concat([
      control(7, entries.length),
      ...entries.flatMap(([k, v]) => [typeof k === "string" ? str(k).buf : k.buf, encode(v)]),
    ]),
  );
/** Deliberately-corrupt helper: a map control byte claiming `pairs` entries, with no body. */
export const mapHeader = (pairs: number): Raw => new Raw(control(7, pairs));

/**
 * A pointer to `offset` in the data section. `form` forces one of the four pointer sizes (0-3);
 * left out, the smallest that fits is used.
 */
export function ptr(offset: number, form?: 0 | 1 | 2 | 3): Raw {
  const f =
    form ?? (offset < 2048 ? 0 : offset < 2048 + (1 << 19) ? 1 : offset < 526336 + (1 << 27) ? 2 : 3);
  if (f === 0) return new Raw(Buffer.from([0x20 | ((offset >> 8) & 7), offset & 0xff]));
  if (f === 1) {
    const v = offset - 2048;
    return new Raw(Buffer.from([0x28 | ((v >> 16) & 7), (v >> 8) & 0xff, v & 0xff]));
  }
  if (f === 2) {
    const v = offset - 526336;
    return new Raw(Buffer.from([0x30 | ((v >> 24) & 7), (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]));
  }
  const b = Buffer.alloc(5);
  b[0] = 0x38;
  b.writeUInt32BE(offset, 1);
  return new Raw(b);
}

export function encode(v: Value): Buffer {
  if (v instanceof Raw) return v.buf;
  if (typeof v === "string") return str(v).buf;
  if (typeof v === "boolean") return bool(v).buf;
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? u32(v).buf : dbl(v).buf;
  if (Array.isArray(v)) return Buffer.concat([control(11, v.length), ...v.map(encode)]);
  return mapOf(Object.entries(v)).buf;
}

/** The record shape DB-IP City Lite uses, with some of the fields around the three we read. */
export function dbipRecord(p: { country?: string; region?: string; city?: string }): Value {
  const rec: { [k: string]: Value } = {};
  if (p.city !== undefined) rec.city = { names: { en: p.city, de: `${p.city}-de` } };
  rec.continent = { code: "EU", geoname_id: 6255148, names: { en: "Europe" } };
  if (p.country !== undefined)
    rec.country = { is_in_european_union: false, iso_code: p.country, names: { en: "Invented" } };
  rec.location = { latitude: dbl(55.5), longitude: dbl(-4.25) };
  if (p.region !== undefined) rec.subdivisions = [{ names: { en: p.region } }, { names: { en: "Second" } }];
  return rec;
}

// ---- search tree -------------------------------------------------------------------------------

type Rec = { node: number } | { data: number } | null;

function cidrBits(cidr: string, ipVersion: 4 | 6): number[] {
  const [addr, lenStr] = cidr.split("/");
  const len = Number(lenStr);
  let bits: number[];
  if (addr.includes(":")) {
    const words = expandV6(addr);
    bits = words.flatMap((w) => Array.from({ length: 16 }, (_, i) => (w >> (15 - i)) & 1));
    return bits.slice(0, len);
  }
  const octets = addr.split(".").map(Number);
  bits = octets.flatMap((o) => Array.from({ length: 8 }, (_, i) => (o >> (7 - i)) & 1));
  if (ipVersion === 6) return [...new Array(96).fill(0), ...bits.slice(0, len)];
  return bits.slice(0, len);
}

function expandV6(addr: string): number[] {
  const [head, tail] = addr.includes("::") ? addr.split("::") : [addr, undefined];
  const h = head ? head.split(":").map((x) => parseInt(x, 16)) : [];
  if (tail === undefined) return h;
  const t = tail ? tail.split(":").map((x) => parseInt(x, 16)) : [];
  return [...h, ...new Array(8 - h.length - t.length).fill(0), ...t];
}

export class MmdbWriter {
  private nodes: Array<[Rec, Rec]> = [[null, null]];
  private data: Buffer[] = [];
  private dataLen = 0;
  /** Extra metadata keys, for exercising the reader's general decoder. */
  extraMetadata: Array<[string, Value]> = [];

  constructor(
    readonly opts: { ipVersion: 4 | 6; recordSize: 24 | 28 | 32 },
  ) {}

  /** Appends a value to the data section and returns its offset (for `ptr`). */
  add(v: Value): number {
    const off = this.dataLen;
    const b = encode(v);
    this.data.push(b);
    this.dataLen += b.length;
    return off;
  }

  /** Points every address in `cidr` at a new record holding `value`. */
  insert(cidr: string, value: Value): this {
    return this.insertAt(cidr, this.add(value));
  }

  /** Points every address in `cidr` at the record already at data offset `offset`. */
  insertAt(cidr: string, offset: number): this {
    const bits = cidrBits(cidr, this.opts.ipVersion);
    let node = 0;
    for (let i = 0; i < bits.length - 1; i++) {
      const b = bits[i];
      const next = this.nodes[node][b];
      if (next && "node" in next) node = next.node;
      else {
        this.nodes.push([null, null]);
        this.nodes[node][b] = { node: this.nodes.length - 1 };
        node = this.nodes.length - 1;
      }
    }
    this.nodes[node][bits[bits.length - 1]] = { data: offset };
    return this;
  }

  build(): Buffer {
    const { recordSize, ipVersion } = this.opts;
    const n = this.nodes.length;
    const value = (r: Rec): number => (r === null ? n : "node" in r ? r.node : n + 16 + r.data);
    const nodeBytes = recordSize / 4;
    const tree = Buffer.alloc(n * nodeBytes);
    this.nodes.forEach(([l, r], i) => {
      const L = value(l);
      const R = value(r);
      const o = i * nodeBytes;
      if (recordSize === 24) {
        tree.writeUIntBE(L, o, 3);
        tree.writeUIntBE(R, o + 3, 3);
      } else if (recordSize === 28) {
        tree.writeUIntBE(L & 0xffffff, o, 3);
        tree[o + 3] = ((L >> 24) & 0x0f) << 4 | ((R >> 24) & 0x0f);
        tree.writeUIntBE(R & 0xffffff, o + 4, 3);
      } else {
        tree.writeUInt32BE(L, o);
        tree.writeUInt32BE(R, o + 4);
      }
    });
    const metadata = mapOf([
      ["binary_format_major_version", u16(2)],
      ["binary_format_minor_version", u16(0)],
      ["build_epoch", u64(1_780_000_000)],
      ["database_type", "Invented-City-Test"],
      ["description", { en: "Invented test data" }],
      ["ip_version", u16(ipVersion)],
      ["languages", ["en", "de"]],
      ["node_count", u32(n)],
      ["record_size", u16(recordSize)],
      ...this.extraMetadata,
    ]);
    return Buffer.concat([tree, Buffer.alloc(16), ...this.data, MARKER, metadata.buf]);
  }
}
