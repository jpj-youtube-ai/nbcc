import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openGeoDb, loadGeoDbIfPresent, connectGeoDb } from "../../src/analytics/geo-db";
import {
  MmdbWriter,
  dbipRecord,
  ptr,
  str,
  bytes,
  u16,
  u32,
  u64,
  u128,
  i32,
  bool,
  flt,
  dbl,
  mapOf,
  mapHeader,
} from "./helpers/mmdb-writer";

// TASK-481: a from-scratch reader for the MaxMind DB format, tested against small .mmdb files the
// tests build themselves (test/unit/helpers/mmdb-writer.ts). Every place and name here is invented;
// the addresses come from the documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24,
// 2001:db8::/32) plus private 10.0.0.0/8.

const TOWN = { country: "GB", region: "Inventshire", city: "Madeupton" };
const OTHER = { country: "FR", region: "Region Imaginaire", city: "Villefictive" };

function v4Db(recordSize: 24 | 28 | 32): Buffer {
  return new MmdbWriter({ ipVersion: 4, recordSize })
    .insert("10.1.0.0/16", dbipRecord(TOWN))
    .insert("203.0.113.0/24", dbipRecord(OTHER))
    .build();
}

function v6Db(recordSize: 24 | 28 | 32): Buffer {
  return new MmdbWriter({ ipVersion: 6, recordSize })
    .insert("2001:db8::/32", dbipRecord(OTHER))
    .insert("192.0.2.0/24", dbipRecord(TOWN))
    .build();
}

describe("openGeoDb: IPv4 databases", () => {
  for (const size of [24, 28, 32] as const) {
    it(`finds the place for an address with ${size}-bit records`, () => {
      const db = openGeoDb(v4Db(size));
      expect(db.lookup("10.1.2.3")).toEqual(TOWN);
      expect(db.lookup("10.1.255.255")).toEqual(TOWN);
      expect(db.lookup("203.0.113.77")).toEqual(OTHER);
    });

    it(`answers null for an address in no network with ${size}-bit records`, () => {
      const db = openGeoDb(v4Db(size));
      expect(db.lookup("10.2.0.1")).toBeNull();
      expect(db.lookup("198.51.100.1")).toBeNull();
    });
  }

  it("reads the IPv4 inside an IPv4-mapped IPv6 address, as Express gives req.ip", () => {
    const db = openGeoDb(v4Db(24));
    expect(db.lookup("::ffff:10.1.2.3")).toEqual(TOWN);
    expect(db.lookup("::FFFF:203.0.113.9")).toEqual(OTHER);
    expect(db.lookup("::ffff:a01:203")).toEqual(TOWN); // the same address, written in hex
  });

  it("answers null for a plain IPv6 address, which an IPv4 database cannot hold", () => {
    expect(openGeoDb(v4Db(24)).lookup("2001:db8::1")).toBeNull();
  });
});

describe("openGeoDb: IPv6 databases", () => {
  for (const size of [24, 28, 32] as const) {
    it(`finds IPv6 and IPv4 addresses with ${size}-bit records`, () => {
      const db = openGeoDb(v6Db(size));
      expect(db.lookup("2001:db8::1")).toEqual(OTHER);
      expect(db.lookup("2001:0DB8:ffff:1:2:3:4:5")).toEqual(OTHER);
      expect(db.lookup("192.0.2.200")).toEqual(TOWN);
      expect(db.lookup("::ffff:192.0.2.1")).toEqual(TOWN);
      expect(db.lookup("::192.0.2.1")).toEqual(TOWN);
    });
  }

  it("answers null for addresses in no network", () => {
    const db = openGeoDb(v6Db(28));
    expect(db.lookup("2001:db9::1")).toBeNull();
    expect(db.lookup("::1")).toBeNull();
    expect(db.lookup("198.51.100.1")).toBeNull();
    expect(db.lookup("::ffff:198.51.100.1")).toBeNull();
  });

  it("accepts the other IPv6 spellings: a trailing ::, a zone id, all eight groups", () => {
    const db = new MmdbWriter({ ipVersion: 6, recordSize: 24 })
      .insert("fe80::/10", dbipRecord(TOWN))
      .insert("2001:db8:1::/48", dbipRecord(OTHER))
      .build();
    const g = openGeoDb(db);
    expect(g.lookup("fe80::1%eth0")).toEqual(TOWN);
    expect(g.lookup("2001:db8:1::")).toEqual(OTHER);
    expect(g.lookup("2001:db8:1:0:0:0:0:1")).toEqual(OTHER);
  });
});

describe("openGeoDb: records", () => {
  it("gives null for a missing city and region, and keeps the country", () => {
    const db = new MmdbWriter({ ipVersion: 4, recordSize: 24 })
      .insert("10.0.0.0/8", dbipRecord({ country: "IE" }))
      .insert("192.0.2.0/24", { country: { iso_code: "GB" }, subdivisions: [] })
      .insert("198.51.100.0/24", { city: { names: { de: "Nur-Deutsch" } } })
      .build();
    const g = openGeoDb(db);
    expect(g.lookup("10.9.9.9")).toEqual({ country: "IE", region: null, city: null });
    expect(g.lookup("192.0.2.1")).toEqual({ country: "GB", region: null, city: null });
    expect(g.lookup("198.51.100.1")).toEqual({ country: null, region: null, city: null });
  });

  it("follows pointers of every size, for values, whole maps and map keys", () => {
    const w = new MmdbWriter({ ipVersion: 4, recordSize: 32 });
    w.add(bytes(Buffer.alloc(3_000, 7))); // past 2048: needs a 3-byte pointer (form 1)
    const names = w.add({ en: "Ptr Region" });
    const enKey = w.add(str("en"));
    w.add(bytes(Buffer.alloc(600_000, 7))); // past 526336: needs a 4-byte pointer (form 2)
    const gb = w.add(str("GB"));
    const town = w.add(str("Pointerton"));
    const cityMap = w.add(mapOf([["names", mapOf([[ptr(enKey, 1), ptr(town, 2)]])]]));
    w.insert(
      "10.0.0.0/8",
      mapOf([
        ["city", ptr(cityMap, 3)],
        ["country", mapOf([["iso_code", ptr(gb, 2)]])],
        ["subdivisions", [mapOf([["names", ptr(names, 1)]])]],
      ]),
    );
    const small = w.add(mapOf([["country", mapOf([["iso_code", "IE"]])]]));
    const first = w.add(str("First"));
    w.insertAt("192.0.2.0/24", small);
    w.insertAt("198.51.100.0/24", small); // two networks sharing one record
    const g = openGeoDb(w.build());
    expect(g.lookup("10.0.0.1")).toEqual({ country: "GB", region: "Ptr Region", city: "Pointerton" });
    expect(g.lookup("192.0.2.1")).toEqual({ country: "IE", region: null, city: null });
    expect(g.lookup("198.51.100.1")).toEqual({ country: "IE", region: null, city: null });
    expect(first).toBeGreaterThan(526336);

    // the smallest pointer form, near the start of the data section
    const w2 = new MmdbWriter({ ipVersion: 4, recordSize: 24 });
    const iso = w2.add(str("IE"));
    w2.insert("10.0.0.0/8", mapOf([["country", mapOf([["iso_code", ptr(iso, 0)]])]]));
    expect(openGeoDb(w2.build()).lookup("10.0.0.1")?.country).toBe("IE");
  });

  it("steps over fields of every type to reach the ones it reads", () => {
    const db = new MmdbWriter({ ipVersion: 4, recordSize: 28 })
      .insert(
        "10.0.0.0/8",
        mapOf([
          ["a_bytes", bytes(Buffer.from([1, 2, 3]))],
          ["a_u16", u16(65535)],
          ["a_u32", u32(4_000_000_000)],
          ["a_u64", u64(2n ** 63n)],
          ["a_u128", u128(2n ** 127n + 5n)],
          ["a_i32", i32(-12345)],
          ["a_bool", bool(true)],
          ["a_float", flt(1.5)],
          ["a_double", dbl(-2.25)],
          ["a_list", [1, "two", [3], { four: 4 }]],
          ["a_long", "x".repeat(300)],
          ["a_longer", "y".repeat(70_000)],
          ...Object.entries(dbipRecord(TOWN) as Record<string, never>),
        ]),
      )
      .build();
    expect(openGeoDb(db).lookup("10.0.0.1")).toEqual(TOWN);
  });
});

describe("openGeoDb: metadata", () => {
  it("decodes the metadata map, with each data type", () => {
    const w = new MmdbWriter({ ipVersion: 6, recordSize: 28 }).insert("2001:db8::/32", dbipRecord(TOWN));
    w.extraMetadata = [
      ["x_bytes", bytes(Buffer.from([9, 8]))],
      ["x_u64_small", u64(42)],
      ["x_u64_big", u64(2n ** 60n)],
      ["x_u128", u128(2n ** 100n)],
      ["x_i32", i32(-7)],
      ["x_i32_pos", i32(300)],
      ["x_bool", bool(false)],
      ["x_float", flt(0.5)],
      ["x_double", dbl(3.75)],
    ];
    const m = openGeoDb(w.build()).metadata;
    expect(m).toMatchObject({
      binary_format_major_version: 2,
      binary_format_minor_version: 0,
      build_epoch: 1_780_000_000,
      database_type: "Invented-City-Test",
      description: { en: "Invented test data" },
      ip_version: 6,
      languages: ["en", "de"],
      record_size: 28,
      x_u64_small: 42,
      x_u64_big: 2n ** 60n,
      x_u128: 2n ** 100n,
      x_i32: -7,
      x_i32_pos: 300,
      x_bool: false,
      x_float: 0.5,
      x_double: 3.75,
    });
    expect(Buffer.from(m.x_bytes as Uint8Array)).toEqual(Buffer.from([9, 8]));
  });
});

describe("openGeoDb: bad input and corrupt files", () => {
  const db = openGeoDb(v6Db(24));

  it.each([
    "",
    "not an ip",
    "256.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "01.2.3.4",
    "1.2.3.-4",
    " 192.0.2.1",
    "1::2::3",
    ":1:2::",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
    "12345::",
    "2001:db8:",
    "::ffff:192.0.2",
    "g::1",
  ])("answers null, without throwing, for %j", (bad) => {
    expect(db.lookup(bad)).toBeNull();
  });

  it("answers null for something that is not a string", () => {
    expect(db.lookup(undefined as unknown as string)).toBeNull();
    expect(db.lookup(42 as unknown as string)).toBeNull();
  });

  it("refuses to open a file that is not a MaxMind DB", () => {
    expect(() => openGeoDb(Buffer.alloc(0))).toThrow();
    expect(() => openGeoDb(Buffer.from("<html>not found</html>"))).toThrow();
  });

  it("refuses to open a file whose metadata makes no sense", () => {
    const bad = (extra: Array<[string, never]>) => {
      const w = new MmdbWriter({ ipVersion: 4, recordSize: 24 }).insert("10.0.0.0/8", dbipRecord(TOWN));
      w.extraMetadata = extra; // later keys win when the reader builds the metadata object
      return w.build();
    };
    expect(() => openGeoDb(bad([["record_size", u16(20) as never]]))).toThrow();
    expect(() => openGeoDb(bad([["ip_version", u16(5) as never]]))).toThrow();
    expect(() => openGeoDb(bad([["node_count", u32(10_000_000) as never]]))).toThrow();
    expect(() => openGeoDb(bad([["binary_format_major_version", u16(3) as never]]))).toThrow();
  });

  it("refuses a file cut short in its tree", () => {
    const whole = v4Db(24);
    const marker = whole.lastIndexOf(Buffer.from([0xab, 0xcd, 0xef]));
    const cut = Buffer.concat([whole.subarray(0, 10), whole.subarray(marker)]);
    expect(() => openGeoDb(cut)).toThrow();
  });

  it("answers null, without throwing, when a record points outside the data section", () => {
    const g = openGeoDb(
      new MmdbWriter({ ipVersion: 4, recordSize: 32 })
        .insert("10.0.0.0/8", dbipRecord(TOWN))
        .insertAt("192.0.2.0/24", 50_000_000)
        .build(),
    );
    expect(g.lookup("192.0.2.1")).toBeNull();
    expect(g.lookup("10.0.0.1")).toEqual(TOWN);
  });

  it("answers null, without throwing, for a pointer to a pointer", () => {
    const w = new MmdbWriter({ ipVersion: 4, recordSize: 24 });
    const s = w.add(str("GB"));
    const p = w.add(ptr(s));
    w.insert("10.0.0.0/8", mapOf([["country", mapOf([["iso_code", ptr(p)]])]]));
    expect(openGeoDb(w.build()).lookup("10.0.0.1")).toBeNull();
  });

  it("answers null, without throwing, for a record that runs off the end of the data", () => {
    const w = new MmdbWriter({ ipVersion: 4, recordSize: 24 });
    w.insert("10.0.0.0/8", mapHeader(400)); // claims 400 entries and has none
    const g = openGeoDb(w.build());
    expect(() => g.lookup("10.0.0.1")).not.toThrow();
    const r = g.lookup("10.0.0.1");
    expect(r === null || (r.country === null && r.city === null)).toBe(true);
  });

  it("answers null for a tree that loops back on itself rather than reaching data", () => {
    // Every record of node 0 pointing back at node 0: the walk runs out of address bits.
    const w = new MmdbWriter({ ipVersion: 4, recordSize: 24 }).insert("10.0.0.0/8", dbipRecord(TOWN));
    const buf = w.build();
    buf.writeUIntBE(0, 0, 3);
    buf.writeUIntBE(0, 3, 3);
    expect(openGeoDb(buf).lookup("10.0.0.1")).toBeNull();
  });
});

describe("loadGeoDbIfPresent and connectGeoDb", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "geo-db-test-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("opens a file from disk", () => {
    const file = join(tmp(), "ok.mmdb");
    writeFileSync(file, v4Db(24));
    expect(openGeoDb(file).lookup("10.1.0.1")).toEqual(TOWN);
    expect(loadGeoDbIfPresent(file)?.lookup("10.1.0.1")).toEqual(TOWN);
    expect(connectGeoDb(file)?.("203.0.113.1")).toEqual(OTHER);
  });

  it("answers null, and says so once, when the file is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = join(tmp(), "missing.mmdb");
    expect(loadGeoDbIfPresent(file)).toBeNull();
    expect(loadGeoDbIfPresent(file)).toBeNull();
    expect(connectGeoDb(file)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("missing.mmdb");
  });

  it("answers null, and says so once, when the file cannot be read as a database", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = join(tmp(), "garbage.mmdb");
    writeFileSync(file, "this is not a database");
    expect(loadGeoDbIfPresent(file)).toBeNull();
    expect(loadGeoDbIfPresent(file)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
