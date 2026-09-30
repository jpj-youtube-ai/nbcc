// The location database (TASK-481; design: docs/superpowers/specs/2026-09-30-site-analytics-design.md,
// "The location database").
//
// A small reader for the MaxMind DB file format (.mmdb), written here from the published spec
// (https://maxmind.github.io/MaxMind-DB/) because the npm registry cannot be reached from where this
// codebase is built. It reads DB-IP's free "IP to City Lite" database (CC BY 4.0, "IP geolocation by
// DB-IP"), which the Docker image downloads at build time to /app/geo/dbip-city-lite.mmdb.
//
// A file is: [binary search tree][16 zero bytes][data section]["\xAB\xCD\xEFMaxMind.com"][metadata].
// The whole file is read into memory once. A lookup walks the tree one address bit at a time to a
// record in the data section, then reads only the three fields analytics needs, straight out of the
// buffer: country.iso_code, subdivisions[0].names.en and city.names.en. Nothing is decoded that is
// not needed and nothing is allocated per lookup except the answer and its strings.
//
// lookup() never throws: bad input, an address in no network, and a corrupt record all answer null.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Place {
  country: string | null;
  region: string | null;
  city: string | null;
}

export type GeoLookup = (ip: string) => Place | null;

export interface GeoDb {
  /** The place for an IPv4 or IPv6 address; null when unknown, malformed or not in the database. */
  lookup: GeoLookup;
  /** The file's metadata map, decoded (node_count, record_size, ip_version, build_epoch, ...). */
  metadata: Record<string, unknown>;
}

/** Where the Docker image puts the database: /app/geo/ in the image (dist/analytics -> ../..). */
export const GEO_DB_PATH = resolve(__dirname, "..", "..", "geo", "dbip-city-lite.mmdb");

const MARKER = Buffer.from([0xab, 0xcd, 0xef, ...Buffer.from("MaxMind.com", "latin1")]);
const METADATA_MAX = 128 * 1024;
const SEPARATOR = 16;

// Data section types.
const T_POINTER = 1;
const T_STRING = 2;
const T_DOUBLE = 3;
const T_BYTES = 4;
const T_UINT16 = 5;
const T_UINT32 = 6;
const T_MAP = 7;
const T_INT32 = 8;
const T_UINT64 = 9;
const T_UINT128 = 10;
const T_ARRAY = 11;
const T_BOOLEAN = 14;
const T_FLOAT = 15;

const K_COUNTRY = Buffer.from("country");
const K_ISO_CODE = Buffer.from("iso_code");
const K_SUBDIVISIONS = Buffer.from("subdivisions");
const K_CITY = Buffer.from("city");
const K_NAMES = Buffer.from("names");
const K_EN = Buffer.from("en");

class Corrupt extends Error {}

/**
 * Reads data-section values out of `buf`. Pointers are offsets from `base` (the start of the data
 * section, or of the metadata when reading metadata). `ctl` leaves its answer in `type`, `size` and
 * `at` (where the payload starts) rather than returning an object, so walking a record allocates
 * nothing.
 */
class Decoder {
  type = 0;
  size = 0;
  at = 0;

  constructor(
    private readonly buf: Buffer,
    private readonly base: number,
    private readonly end: number,
  ) {}

  /** Reads the control byte(s) of the field at `off`. */
  ctl(off: number): void {
    const b = this.buf;
    if (off < 0 || off >= this.end) throw new Corrupt("offset out of range");
    const c = b[off++];
    let type = c >> 5;
    if (type === T_POINTER) {
      // 001SSVVV: SS is the pointer's size; `size` holds SS and `at` the first pointer byte.
      this.type = T_POINTER;
      this.size = (c >> 3) & 3;
      this.at = off;
      return;
    }
    if (type === 0) {
      if (off >= this.end) throw new Corrupt("truncated type");
      type = 7 + b[off++];
    }
    let size = c & 0x1f;
    if (size >= 29) {
      const n = size - 28; // 1, 2 or 3 more bytes
      if (off + n > this.end) throw new Corrupt("truncated size");
      if (n === 1) size = 29 + b[off];
      else if (n === 2) size = 285 + ((b[off] << 8) | b[off + 1]);
      else size = 65821 + ((b[off] << 16) | (b[off + 1] << 8) | b[off + 2]);
      off += n;
    }
    this.type = type;
    this.size = size;
    this.at = off;
  }

  /** The absolute offset a pointer (already read by `ctl`) points at, and where it ends. */
  private pointerTarget(): number {
    const b = this.buf;
    const ss = this.size;
    const at = this.at;
    if (at + ss + 1 > this.end) throw new Corrupt("truncated pointer");
    const vvv = b[at - 1] & 7;
    let p: number;
    if (ss === 0) p = (vvv << 8) | b[at];
    else if (ss === 1) p = ((vvv << 16) | (b[at] << 8) | b[at + 1]) + 2048;
    else if (ss === 2) p = ((vvv << 24) | (b[at] << 16) | (b[at + 1] << 8) | b[at + 2]) + 526336;
    else p = b.readUInt32BE(at);
    return this.base + p;
  }

  /**
   * Reads the value at `off`, following it if it is a pointer (one level, as the spec says), and
   * returns its type; `size` and `at` then describe the value itself.
   */
  deref(off: number): number {
    this.ctl(off);
    if (this.type !== T_POINTER) return this.type;
    this.ctl(this.pointerTarget());
    if (this.type === T_POINTER) throw new Corrupt("pointer to a pointer");
    return this.type;
  }

  /** The offset just past the field at `off` (a pointer is stepped over, not followed). */
  skip(off: number): number {
    this.ctl(off);
    const type = this.type;
    const size = this.size;
    const at = this.at;
    switch (type) {
      case T_POINTER:
        return at + size + 1;
      case T_MAP: {
        let p = at;
        for (let i = 0; i < size * 2; i++) p = this.skip(p);
        return p;
      }
      case T_ARRAY: {
        let p = at;
        for (let i = 0; i < size; i++) p = this.skip(p);
        return p;
      }
      case T_BOOLEAN:
        return at;
      case T_STRING:
      case T_DOUBLE:
      case T_BYTES:
      case T_UINT16:
      case T_UINT32:
      case T_INT32:
      case T_UINT64:
      case T_UINT128:
      case T_FLOAT:
        if (at + size > this.end) throw new Corrupt("truncated value");
        return at + size;
      default:
        throw new Corrupt(`unsupported type ${type}`);
    }
  }

  /** In the map at `off` (or pointed to from it), the offset of `key`'s value, or -1. */
  findKey(off: number, key: Buffer): number {
    if (off < 0) return -1;
    if (this.deref(off) !== T_MAP) return -1;
    const pairs = this.size;
    let p = this.at;
    for (let i = 0; i < pairs; i++) {
      if (this.deref(p) !== T_STRING) throw new Corrupt("map key is not a string");
      const matches = this.size === key.length && this.buf.compare(key, 0, key.length, this.at, this.at + this.size) === 0;
      const value = this.skip(p);
      if (matches) return value;
      p = this.skip(value);
    }
    return -1;
  }

  /** The offset of the first element of the array at `off`, or -1. */
  first(off: number): number {
    if (off < 0) return -1;
    if (this.deref(off) !== T_ARRAY || this.size === 0) return -1;
    return this.at;
  }

  /** The string at `off` (or pointed to from it); null when absent or not a string. */
  string(off: number): string | null {
    if (off < 0) return null;
    if (this.deref(off) !== T_STRING) return null;
    if (this.at + this.size > this.end) throw new Corrupt("truncated string");
    return this.buf.toString("utf8", this.at, this.at + this.size);
  }

  /** Decodes the whole value at `off` into JavaScript (used for the metadata, once). */
  decode(off: number, depth = 0): unknown {
    if (depth > 32) throw new Corrupt("nested too deeply");
    const b = this.buf;
    const type = this.deref(off);
    const { size, at } = this;
    switch (type) {
      case T_STRING:
        this.need(at, size);
        return b.toString("utf8", at, at + size);
      case T_DOUBLE:
        if (size !== 8) throw new Corrupt("double must be 8 bytes");
        this.need(at, 8);
        return b.readDoubleBE(at);
      case T_FLOAT:
        if (size !== 4) throw new Corrupt("float must be 4 bytes");
        this.need(at, 4);
        return b.readFloatBE(at);
      case T_BYTES:
        this.need(at, size);
        return Buffer.from(b.subarray(at, at + size));
      case T_UINT16:
      case T_UINT32:
      case T_UINT64:
      case T_UINT128: {
        const max = type === T_UINT16 ? 2 : type === T_UINT32 ? 4 : type === T_UINT64 ? 8 : 16;
        if (size > max) throw new Corrupt("unsigned integer too long");
        this.need(at, size);
        return this.unsigned(at, size);
      }
      case T_INT32: {
        if (size > 4) throw new Corrupt("int32 too long");
        this.need(at, size);
        let v = 0;
        for (let i = 0; i < size; i++) v = v * 256 + b[at + i];
        return size === 4 ? v | 0 : v; // only a full four bytes can carry the sign
      }
      case T_BOOLEAN:
        if (size > 1) throw new Corrupt("boolean must be 0 or 1");
        return size === 1;
      case T_MAP: {
        const out: Record<string, unknown> = {};
        let p = at;
        for (let i = 0; i < size; i++) {
          const k = this.decode(p, depth + 1);
          if (typeof k !== "string") throw new Corrupt("map key is not a string");
          p = this.skip(p);
          out[k] = this.decode(p, depth + 1);
          p = this.skip(p);
        }
        return out;
      }
      case T_ARRAY: {
        const out: unknown[] = [];
        let p = at;
        for (let i = 0; i < size; i++) {
          out.push(this.decode(p, depth + 1));
          p = this.skip(p);
        }
        return out;
      }
      default:
        throw new Corrupt(`unsupported type ${type}`);
    }
  }

  private need(at: number, n: number): void {
    if (at + n > this.end) throw new Corrupt("truncated value");
  }

  /** An unsigned big-endian integer: a number while it is exactly representable, else a bigint. */
  private unsigned(at: number, size: number): number | bigint {
    const b = this.buf;
    if (size <= 6) {
      let v = 0;
      for (let i = 0; i < size; i++) v = v * 256 + b[at + i];
      return v;
    }
    let v = 0n;
    for (let i = 0; i < size; i++) v = (v << 8n) | BigInt(b[at + i]);
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  }
}

// ---- addresses ----------------------------------------------------------------------------------
//
// Parsed without slicing strings: an IPv4 address becomes one unsigned number; an IPv6 one fills
// the shared eight-word scratch below (lookups are synchronous, so sharing it is safe).

const words = new Uint16Array(8);

/** The IPv4 address in s[start, end) as an unsigned 32-bit number, or -1. No leading zeros. */
function parseV4(s: string, start: number, end: number): number {
  let value = 0;
  let parts = 0;
  let i = start;
  while (parts < 4) {
    const partStart = i;
    let part = 0;
    while (i < end) {
      const c = s.charCodeAt(i);
      if (c < 48 || c > 57) break;
      part = part * 10 + (c - 48);
      i++;
    }
    const len = i - partStart;
    if (len === 0 || len > 3 || part > 255 || (len > 1 && s.charCodeAt(partStart) === 48)) return -1;
    value = value * 256 + part;
    parts++;
    if (parts < 4) {
      if (i >= end || s.charCodeAt(i) !== 46) return -1;
      i++;
    }
  }
  return i === end ? value : -1;
}

function hexValue(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}

/** Parses the IPv6 address in s[start, end) into `words`. False when malformed. */
function parseV6(s: string, start: number, end: number): boolean {
  let n = 0;
  let gap = -1; // where "::" stands, as a word index
  let i = start;
  if (end - start >= 2 && s.charCodeAt(i) === 58 && s.charCodeAt(i + 1) === 58) {
    gap = 0;
    i += 2;
    if (i === end) {
      words.fill(0);
      return true;
    }
  }
  for (;;) {
    const groupStart = i;
    let v = 0;
    while (i < end && i - groupStart < 4) {
      const h = hexValue(s.charCodeAt(i));
      if (h < 0) break;
      v = v * 16 + h;
      i++;
    }
    if (i < end && s.charCodeAt(i) === 46) {
      // a dotted IPv4 ending, worth two words
      if (n > 6) return false;
      const v4 = parseV4(s, groupStart, end);
      if (v4 < 0) return false;
      words[n++] = v4 >>> 16;
      words[n++] = v4 & 0xffff;
      break;
    }
    if (i === groupStart || n >= 8) return false;
    words[n++] = v;
    if (i === end) break;
    if (s.charCodeAt(i) !== 58) return false; // a fifth hex digit, or anything else
    if (i + 1 < end && s.charCodeAt(i + 1) === 58) {
      if (gap >= 0) return false;
      gap = n;
      i += 2;
      if (i === end) break;
    } else {
      i++;
      if (i === end) return false;
    }
  }
  if (gap < 0) return n === 8;
  if (n >= 8) return false;
  const shift = 8 - n;
  for (let k = n - 1; k >= gap; k--) words[k + shift] = words[k];
  for (let k = gap; k < gap + shift; k++) words[k] = 0;
  return true;
}

// ---- the database -------------------------------------------------------------------------------

/**
 * Opens a .mmdb file (a path, read once, or its bytes). Throws when the file is not a MaxMind DB
 * this reader understands; after that, lookup() never throws.
 */
export function openGeoDb(pathOrBuffer: string | Buffer): GeoDb {
  const buf = typeof pathOrBuffer === "string" ? readFileSync(pathOrBuffer) : pathOrBuffer;

  const markerAt = buf.lastIndexOf(MARKER);
  if (markerAt < 0 || buf.length - markerAt > METADATA_MAX) throw new Error("not a MaxMind DB file: no metadata");
  const metaStart = markerAt + MARKER.length;
  const metadata = new Decoder(buf, metaStart, buf.length).decode(metaStart) as Record<string, unknown>;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error("MaxMind DB metadata is not a map");
  }
  const nodeCount = metadata.node_count;
  const recordSize = metadata.record_size;
  const ipVersion = metadata.ip_version;
  if (metadata.binary_format_major_version !== 2) throw new Error("unsupported MaxMind DB format version");
  if (typeof nodeCount !== "number" || !Number.isInteger(nodeCount) || nodeCount < 1) {
    throw new Error("MaxMind DB metadata has no node_count");
  }
  if (recordSize !== 24 && recordSize !== 28 && recordSize !== 32) {
    throw new Error(`unsupported MaxMind DB record size ${String(recordSize)}`);
  }
  if (ipVersion !== 4 && ipVersion !== 6) throw new Error(`unsupported MaxMind DB ip_version ${String(ipVersion)}`);
  const nodeBytes = recordSize / 4;
  const treeSize = nodeCount * nodeBytes;
  const dataStart = treeSize + SEPARATOR;
  if (dataStart > markerAt) throw new Error("MaxMind DB search tree is larger than the file");

  const data = new Decoder(buf, dataStart, markerAt);

  const readRecord =
    recordSize === 24
      ? (node: number, bit: number): number => {
          const o = node * 6 + bit * 3;
          return (buf[o] << 16) | (buf[o + 1] << 8) | buf[o + 2];
        }
      : recordSize === 28
        ? (node: number, bit: number): number => {
            const o = node * 7;
            return bit === 0
              ? ((buf[o + 3] & 0xf0) << 20) | (buf[o] << 16) | (buf[o + 1] << 8) | buf[o + 2]
              : ((buf[o + 3] & 0x0f) << 24) | (buf[o + 4] << 16) | (buf[o + 5] << 8) | buf[o + 6];
          }
        : (node: number, bit: number): number => buf.readUInt32BE(node * 8 + bit * 4);

  // In an IPv6 tree, IPv4 addresses live under ::/96: find that node once.
  let ipv4Start = 0;
  if (ipVersion === 6) {
    for (let i = 0; i < 96 && ipv4Start < nodeCount; i++) ipv4Start = readRecord(ipv4Start, 0);
  }

  /** From the node a walk ended on, the record's offset in the buffer, or -1. */
  const recordOffset = (node: number): number => {
    if (node <= nodeCount) return -1; // == nodeCount: no data; < nodeCount: ran out of bits
    const off = dataStart + (node - nodeCount - SEPARATOR);
    return off >= dataStart && off < markerAt ? off : -1;
  };

  const walkV4 = (v4: number): number => {
    let node = ipv4Start;
    for (let i = 31; i >= 0 && node < nodeCount; i--) node = readRecord(node, (v4 >>> i) & 1);
    return node;
  };

  const walkV6 = (): number => {
    let node = 0;
    for (let w = 0; w < 8 && node < nodeCount; w++) {
      const word = words[w];
      for (let i = 15; i >= 0 && node < nodeCount; i--) node = readRecord(node, (word >> i) & 1);
    }
    return node;
  };

  const lookup: GeoLookup = (ip) => {
    try {
      if (typeof ip !== "string") return null;
      let end = ip.indexOf("%"); // an IPv6 zone id ("fe80::1%eth0") says nothing about place
      if (end < 0) end = ip.length;
      let node: number;
      if (ip.indexOf(":") < 0) {
        if (end !== ip.length) return null;
        const v4 = parseV4(ip, 0, end);
        if (v4 < 0) return null;
        node = walkV4(v4);
      } else {
        if (!parseV6(ip, 0, end)) return null;
        const mapped =
          words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0xffff;
        if (mapped) node = walkV4(((words[6] << 16) | words[7]) >>> 0);
        else if (ipVersion === 4) return null;
        else node = walkV6();
      }
      const rec = recordOffset(node);
      if (rec < 0) return null;

      const country = data.string(data.findKey(data.findKey(rec, K_COUNTRY), K_ISO_CODE));
      const region = data.string(
        data.findKey(data.findKey(data.first(data.findKey(rec, K_SUBDIVISIONS)), K_NAMES), K_EN),
      );
      const city = data.string(data.findKey(data.findKey(data.findKey(rec, K_CITY), K_NAMES), K_EN));
      return { country, region, city };
    } catch {
      return null;
    }
  };

  return { lookup, metadata };
}

const warned = new Set<string>();

/**
 * Opens the database at `path`, or answers null (saying why, once per path) when it is missing or
 * unreadable: analytics then records no places rather than the app failing to start.
 */
export function loadGeoDbIfPresent(path: string): GeoDb | null {
  try {
    if (!existsSync(path)) {
      warnOnce(path, `analytics: no location database at ${path}; visits will be counted without places`);
      return null;
    }
    return openGeoDb(path);
  } catch (err) {
    warnOnce(path, `analytics: could not read the location database at ${path} (${(err as Error).message}); visits will be counted without places`);
    return null;
  }
}

function warnOnce(path: string, message: string): void {
  if (warned.has(path)) return;
  warned.add(path);
  console.warn(message);
}

/**
 * Start-up wiring: the lookup for the image's database, or null when there is none. Hand the result
 * to the analytics place resolver (src/analytics/place.ts, TASK-479) at start-up.
 */
export function connectGeoDb(path: string = GEO_DB_PATH): GeoLookup | null {
  return loadGeoDbIfPresent(path)?.lookup ?? null;
}
