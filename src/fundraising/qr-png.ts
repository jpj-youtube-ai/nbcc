import { deflateSync } from "node:zlib";
import { encodeQr } from "./qr";

// TASK-504: a fundraiser's QR code as a print size PNG, beside the SVG download. Drawn from the same
// encoder as the SVG (./qr.ts), so both downloads are exactly the same code. No image library: a
// one bit black and white PNG is a header, the rows deflated with Node's own zlib, and a checksum
// per chunk. Every module is a whole number of pixels, so the edges stay sharp when it is printed
// big; the picture comes out at the first whole multiple of the code's width at or above 2000px.

export const QR_PNG_TARGET = 2000;
const MARGIN = 4; // modules of white around the code, as the standard asks

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** The QR code for `text` as a PNG of about 2000 pixels square (never less). */
export function qrPng(text: string): Buffer {
  const m = encodeQr(text);
  const extent = m.length + 2 * MARGIN;
  const scale = Math.ceil(QR_PNG_TARGET / extent);
  const size = extent * scale;
  const stride = Math.ceil(size / 8) + 1;
  // Start all white (bit 1), then clear the bits of every dark module.
  const raw = Buffer.alloc(stride * size, 0xff);
  for (let y = 0; y < size; y++) raw[y * stride] = 0; // filter: none
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m.length; c++) {
      if (!m[r][c]) continue;
      const x0 = (c + MARGIN) * scale;
      const y0 = (r + MARGIN) * scale;
      for (let y = y0; y < y0 + scale; y++) {
        const row = y * stride + 1;
        for (let x = x0; x < x0 + scale; x++) raw[row + (x >> 3)] &= ~(0x80 >> (x & 7));
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // greyscale
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // not interlaced
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
