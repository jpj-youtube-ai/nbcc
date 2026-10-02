// A small, independent QR decoder for the encoder's tests (TASK-493). It shares no code or tables
// with src/fundraising/qr.ts: everything here is typed fresh from ISO/IEC 18004 so a mistake in
// the encoder cannot be mirrored by the test. It is strict: any deviation from the standard throws.

export type Ecc = "L" | "M" | "Q" | "H";

// ISO/IEC 18004 Table 9, versions 1 to 10: [EC codewords per block, blocks in group 1, data
// codewords per group-1 block, blocks in group 2, data codewords per group-2 block].
const BLOCKS: Record<Ecc, [number, number, number, number, number][]> = {
  L: [
    [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69],
  ],
  M: [
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
  ],
  Q: [
    [13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0], [18, 2, 15, 2, 16],
    [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19], [20, 4, 16, 4, 17], [24, 6, 19, 2, 20],
  ],
  H: [
    [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0], [22, 2, 11, 2, 12],
    [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15], [24, 4, 12, 4, 13], [28, 6, 15, 2, 16],
  ],
};

// Annex E: alignment pattern centre coordinates.
const ALIGN: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

// Remainder bits per version (Table 1).
const REMAINDER = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

const ECC_FROM_BITS: Record<number, Ecc> = { 0b01: "L", 0b00: "M", 0b11: "Q", 0b10: "H" };

const MASKS: ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

// GF(256) with the QR field polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP: number[] = [];
const LOG: number[] = new Array(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Remainder of `value` (as a GF(2) polynomial) divided by `gen`. */
function gf2Mod(value: number, gen: number): number {
  const genDeg = 31 - Math.clz32(gen);
  let v = value;
  while (v !== 0 && 31 - Math.clz32(v) >= genDeg) v ^= gen << (31 - Math.clz32(v) - genDeg);
  return v;
}

export interface FormatInfo {
  ecc: Ecc;
  mask: number;
  raw: number; // the 15 bits as stored in the symbol (before removing the 0x5412 mask)
}

/** Read both copies of the format information, check they agree and are valid BCH codewords. */
export function readFormat(m: boolean[][]): FormatInfo {
  const n = m.length;
  const at = (row: number, col: number) => (m[row][col] ? 1 : 0);
  // Copy 1, bit 14 (most significant) first, around the top-left finder.
  const coords1: [number, number][] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  // Copy 2: bits 14..8 up the left column at the bottom, bits 7..0 along row 8 at the right.
  const coords2: [number, number][] = [];
  for (let k = 0; k < 7; k++) coords2.push([n - 1 - k, 8]);
  for (let k = 0; k < 8; k++) coords2.push([8, n - 8 + k]);
  let a = 0;
  let b = 0;
  for (const [r, c] of coords1) a = (a << 1) | at(r, c);
  for (const [r, c] of coords2) b = (b << 1) | at(r, c);
  if (a !== b) throw new Error(`format copies differ: ${a.toString(2)} vs ${b.toString(2)}`);
  const unmasked = a ^ 0x5412;
  if (gf2Mod(unmasked, 0x537) !== 0) throw new Error(`format bits fail BCH: ${a.toString(2)}`);
  const data = unmasked >> 10;
  return { ecc: ECC_FROM_BITS[data >> 3], mask: data & 7, raw: a };
}

/** Read both copies of the version information (versions 7+), checking BCH validity. */
export function readVersionInfo(m: boolean[][]): number {
  const n = m.length;
  let a = 0;
  let b = 0;
  for (let i = 17; i >= 0; i--) {
    const row = Math.floor(i / 3);
    const col = n - 11 + (i % 3);
    a = (a << 1) | (m[row][col] ? 1 : 0); // top-right block
    b = (b << 1) | (m[col][row] ? 1 : 0); // bottom-left block (transposed)
  }
  if (a !== b) throw new Error("version information copies differ");
  if (gf2Mod(a, 0x1f25) !== 0) throw new Error(`version bits fail BCH: ${a.toString(2)}`);
  return a >> 12;
}

/** Which modules are function patterns (not data), for a given version. */
export function functionMap(version: number): boolean[][] {
  const n = 17 + 4 * version;
  const f = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const fill = (r0: number, c0: number, h: number, w: number) => {
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < n && c < n) f[r][c] = true;
  };
  fill(0, 0, 9, 9); // finder + separator + format
  fill(0, n - 8, 9, 8);
  fill(n - 8, 0, 8, 9);
  fill(6, 0, 1, n); // timing
  fill(0, 6, n, 1);
  const centres = ALIGN[version - 1];
  for (const r of centres) {
    for (const c of centres) {
      const overlapsFinder = (r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6);
      if (!overlapsFinder) fill(r - 2, c - 2, 5, 5);
    }
  }
  if (version >= 7) {
    fill(0, n - 11, 6, 3);
    fill(n - 11, 0, 3, 6);
  }
  return f;
}

/** Problems with the fixed patterns (finders, separators, timing, alignment, dark module). */
export function functionPatternProblems(m: boolean[][]): string[] {
  const n = m.length;
  const version = (n - 17) / 4;
  const problems: string[] = [];
  const expect = (r: number, c: number, dark: boolean, what: string) => {
    if (m[r][c] !== dark) problems.push(`${what} at (${r},${c}) should be ${dark ? "dark" : "light"}`);
  };
  const finder = (r0: number, c0: number, name: string) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        expect(r0 + r, c0 + c, ring !== 2, `${name} finder`);
      }
    }
  };
  finder(0, 0, "top-left");
  finder(0, n - 7, "top-right");
  finder(n - 7, 0, "bottom-left");
  for (let k = 0; k < 8; k++) {
    expect(7, k, false, "separator");
    expect(k, 7, false, "separator");
    expect(7, n - 1 - k, false, "separator");
    expect(k, n - 8, false, "separator");
    expect(n - 8, k, false, "separator");
    expect(n - 1 - k, 7, false, "separator");
  }
  for (let k = 8; k < n - 8; k++) {
    expect(6, k, k % 2 === 0, "timing row");
    expect(k, 6, k % 2 === 0, "timing column");
  }
  const centres = ALIGN[version - 1];
  for (const r of centres) {
    for (const c of centres) {
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          expect(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1, "alignment");
        }
      }
    }
  }
  expect(n - 8, 8, true, "dark module");
  return problems;
}

export interface Decoded {
  version: number;
  ecc: Ecc;
  mask: number;
  text: string;
  dataCodewords: number[];
}

/** Decode a byte-mode QR symbol, version 1 to 10, verifying every layer on the way. */
export function decodeQr(m: boolean[][]): Decoded {
  const n = m.length;
  if (!m.every((row) => row.length === n)) throw new Error("matrix is not square");
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 10) throw new Error(`bad size ${n}`);
  const problems = functionPatternProblems(m);
  if (problems.length) throw new Error(`function patterns: ${problems.slice(0, 3).join("; ")}`);
  const { ecc, mask } = readFormat(m);
  if (version >= 7 && readVersionInfo(m) !== version) throw new Error("version information disagrees with size");

  // Read the data region in the zigzag order, unmasking as we go.
  const isFunction = functionMap(version);
  const bits: number[] = [];
  let upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < n; k++) {
      const row = upward ? n - 1 - k : k;
      for (const col of [right, right - 1]) {
        if (isFunction[row][col]) continue;
        const bit = m[row][col] !== MASKS[mask](row, col);
        bits.push(bit ? 1 : 0);
      }
    }
    upward = !upward;
  }
  if (bits.length % 8 !== REMAINDER[version - 1]) throw new Error(`unexpected remainder ${bits.length % 8}`);
  const remainder = bits.slice(bits.length - (bits.length % 8));
  if (remainder.some((b) => b !== 0)) throw new Error("remainder bits are not zero");
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // De-interleave into blocks.
  const [ecLen, g1, d1, g2, d2] = BLOCKS[ecc][version - 1];
  const dataLens = [...new Array(g1).fill(d1), ...new Array(g2).fill(d2)];
  const total = dataLens.reduce((a, b) => a + b, 0) + ecLen * dataLens.length;
  if (total !== codewords.length) throw new Error(`codeword count ${codewords.length} != table ${total}`);
  const blocks: number[][] = dataLens.map(() => []);
  let p = 0;
  const maxData = Math.max(...dataLens);
  for (let i = 0; i < maxData; i++) for (let b = 0; b < blocks.length; b++) if (i < dataLens[b]) blocks[b].push(codewords[p++]);
  for (let i = 0; i < ecLen; i++) for (let b = 0; b < blocks.length; b++) blocks[b].push(codewords[p++]);

  // Every block must be a valid Reed-Solomon codeword: zero syndromes at alpha^0 .. alpha^(ecLen-1).
  blocks.forEach((block, bi) => {
    for (let s = 0; s < ecLen; s++) {
      let acc = 0;
      for (const c of block) acc = gfMul(acc, EXP[s]) ^ c;
      if (acc !== 0) throw new Error(`block ${bi} syndrome ${s} is ${acc}`);
    }
  });
  const data = blocks.flatMap((block, b) => block.slice(0, dataLens[b]));

  // Parse: byte mode indicator, character count, bytes, terminator, padding.
  let bitPos = 0;
  const read = (count: number) => {
    let v = 0;
    for (let i = 0; i < count; i++) {
      const byte = data[(bitPos + i) >> 3];
      v = (v << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1);
    }
    bitPos += count;
    return v;
  };
  const totalBits = data.length * 8;
  const modeIndicator = read(4);
  if (modeIndicator !== 0b0100) throw new Error(`mode ${modeIndicator.toString(2)} is not byte mode`);
  const count = read(version <= 9 ? 8 : 16);
  if (bitPos + count * 8 > totalBits) throw new Error("character count overruns the data");
  const bytes: number[] = [];
  for (let i = 0; i < count; i++) bytes.push(read(8));
  const term = Math.min(4, totalBits - bitPos);
  if (read(term) !== 0) throw new Error("terminator is not zero");
  if (bitPos % 8) {
    if (read(8 - (bitPos % 8)) !== 0) throw new Error("bit padding is not zero");
  }
  for (let i = 0; bitPos < totalBits; i++) {
    const pad = read(8);
    if (pad !== (i % 2 === 0 ? 0xec : 0x11)) throw new Error(`pad byte ${i} is ${pad}`);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  return { version, ecc, mask, text, dataCodewords: data };
}

/** The four ISO penalty rules, written independently of the encoder. */
export function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let r = 0; r < n; r++) lines.push(m[r]);
  for (let c = 0; c < n; c++) lines.push(m.map((row) => row[c]));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    const s = line.map((d) => (d ? "1" : "0")).join("");
    for (let i = 0; i + 11 <= n; i++) {
      const w = s.slice(i, i + 11);
      if (w === "10111010000" || w === "00001011101") score += 40;
    }
  }
  for (let r = 0; r + 1 < n; r++) {
    for (let c = 0; c + 1 < n; c++) {
      const v = m[r][c];
      if (m[r][c + 1] === v && m[r + 1][c] === v && m[r + 1][c + 1] === v) score += 3;
    }
  }
  const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}
