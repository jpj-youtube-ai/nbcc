// TASK-493: regenerate (or check) the reference grids in test/unit/fundraising-qr.test.ts with an
// independent encoder, node-qrcode 1.5.0. NOT a dependency and NOT run in CI: the npm registry is
// blocked where this repo is built. On a machine that can install it:
//
//   mkdir /tmp/qrref && cd /tmp/qrref && npm init -y && npm install qrcode@1.5.0
//   NODE_PATH=/tmp/qrref/node_modules node scripts/qr-reference-grids.mjs
//
// Options, exactly: one segment of the text's UTF-8 bytes in byte mode (so node-qrcode cannot pick
// numeric, alphanumeric or kanji mode), errorCorrectionLevel as listed, version and mask chosen by
// node-qrcode itself (the smallest version that fits, the mask with the lowest penalty). Each grid is
// the matrix row by row, one bit per module (1 = dark), most significant bit first, base64.
//
// It prints one line per reference in the test's own shape; compare them with REFERENCES there.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const QRCode = require("qrcode");

const URL = "https://nbcc.scot/fundraise/sams-santa-dash-2026";
const filler = (n) => {
  const base = "The quick brown fox jumps over the lazy dog 0123456789 ";
  let s = "";
  while (s.length < n) s += base;
  return s.slice(0, n);
};

// [text, ecc, how the test writes the text], in the test's order.
const CASES = [
  ["hello", "M", "'hello'"],
  [URL, "L", "URL"], [URL, "M", "URL"], [URL, "Q", "URL"], [URL, "H", "URL"],
  ["Café ☕ £5", "Q", "'Caf\\u00e9 \\u2615 \\u00a35'"],
  ...[[17, "L"], [7, "H"], [26, "M"], [32, "Q"], [60, "L"], [44, "H"], [100, "M"], [70, "Q"], [150, "L"], [120, "M"],
    [100, "Q"], [90, "H"], [271, "L"], [213, "M"], [151, "Q"], [119, "H"]].map(([n, ecc]) => [filler(n), ecc, `filler(${n})`]),
];

for (const [text, ecc, label] of CASES) {
  const qr = QRCode.create([{ data: Buffer.from(text, "utf8"), mode: "byte" }], { errorCorrectionLevel: ecc });
  const size = qr.modules.size;
  const bytes = Buffer.alloc(Math.ceil((size * size) / 8));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      if (qr.modules.get(r, c)) bytes[i >> 3] |= 1 << (7 - (i & 7));
    }
  }
  console.log(
    `  { text: ${label}, ecc: "${ecc}", version: ${qr.version}, mask: ${qr.maskPattern}, grid: "${bytes.toString("base64")}" },`,
  );
}
