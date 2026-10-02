import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { encodeQr } from "../../src/fundraising/qr";
import { qrPng, QR_PNG_TARGET } from "../../src/fundraising/qr-png";

// TASK-504: the print size PNG of a fundraiser's QR code. Drawn on the server from the same encoder
// as the SVG (src/fundraising/qr.ts), so the two downloads are the same code. Checked by reading
// the PNG back: its size, and every module's colour against the encoder's matrix.

interface Png {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  pixel: (x: number, y: number) => 0 | 1; // 1 = white
}

function readPng(buf: Buffer): Png {
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  let at = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat: Buffer[] = [];
  const types: string[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.subarray(at + 4, at + 8).toString("latin1");
    const data = buf.subarray(at + 8, at + 8 + len);
    types.push(type);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
    }
    if (type === "IDAT") idat.push(data);
    at += 12 + len;
  }
  expect(types[0]).toBe("IHDR");
  expect(types[types.length - 1]).toBe("IEND");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil(width / 8) + 1;
  expect(raw.length).toBe(stride * height);
  return {
    width,
    height,
    bitDepth,
    colourType,
    pixel: (x, y) => {
      expect(raw[y * stride]).toBe(0); // no row filter
      const byte = raw[y * stride + 1 + (x >> 3)];
      return ((byte >> (7 - (x & 7))) & 1) as 0 | 1;
    },
  };
}

describe("the print size QR code PNG", () => {
  const link = "https://nbcc.scot/fundraise/sams-santa-dash";

  it("is a square of at least 2000 pixels, black and white", () => {
    const png = readPng(qrPng(link));
    expect(QR_PNG_TARGET).toBe(2000);
    expect(png.width).toBe(png.height);
    expect(png.width).toBeGreaterThanOrEqual(2000);
    expect(png.width).toBeLessThan(2200);
    expect(png.bitDepth).toBe(1);
    expect(png.colourType).toBe(0);
  });

  it("draws exactly the encoder's code, with a white margin of four modules", () => {
    const m = encodeQr(link);
    const extent = m.length + 8;
    const png = readPng(qrPng(link));
    const scale = png.width / extent;
    expect(Number.isInteger(scale)).toBe(true);
    const mid = Math.floor(scale / 2);
    // The quiet zone is white.
    expect(png.pixel(mid, mid)).toBe(1);
    expect(png.pixel(png.width - 1, png.height - 1)).toBe(1);
    // Every module, sampled at its centre.
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m.length; c++) {
        const x = (c + 4) * scale + mid;
        const y = (r + 4) * scale + mid;
        expect(png.pixel(x, y)).toBe(m[r][c] ? 0 : 1);
      }
    }
  });

  it("is small enough to download quickly", () => {
    expect(qrPng(link).length).toBeLessThan(60_000);
  });
});
