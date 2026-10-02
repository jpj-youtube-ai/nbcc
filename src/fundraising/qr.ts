// TASK-493: a QR code encoder for fundraiser pages, written from ISO/IEC 18004 with no
// dependencies. Pure: no IO. Byte mode (UTF-8), versions 1 to 10, error correction L/M/Q/H.
//
//   encodeQr(text, { ecc })  -> boolean[][] of modules, true = dark, [row][column]
//   qrSvg(text, { ecc, margin, size, title }) -> a compact inline SVG string

export type QrEcc = "L" | "M" | "Q" | "H";

export interface QrOptions {
  /** Error correction level; default "M" (about 15% of the code can be damaged). */
  ecc?: QrEcc;
  /** Force one mask pattern (0 to 7). Normally left out: the lowest-penalty mask is chosen. */
  mask?: number;
}

export interface QrSvgOptions {
  ecc?: QrEcc;
  /** Quiet zone in modules around the code; default 4, the standard's minimum. */
  margin?: number;
  /** Width and height in pixels. Left out, the SVG scales to its container. */
  size?: number;
  /** Accessible name, e.g. "QR code for Sam's fundraising page". */
  title?: string;
}

const MAX_VERSION = 10;

// ISO/IEC 18004 Table 9 (versions 1 to 10): per level, per version,
// [EC codewords per block, group-1 blocks, group-1 data codewords, group-2 blocks, group-2 data codewords].
const EC_BLOCKS: Record<QrEcc, readonly (readonly number[])[]> = {
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

// Format information: the two error correction level bits (Table 12).
const ECC_BITS: Record<QrEcc, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

// Annex E: alignment pattern centres for versions 1 to 10.
const ALIGNMENT_CENTRES: readonly (readonly number[])[] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

// Table 10: the eight data mask conditions, i = row, j = column. True means "invert".
const MASK_CONDITIONS: readonly ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

// ---------------------------------------------------------------------------------------------
// GF(256) arithmetic over the QR field polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D), and
// Reed-Solomon error correction with generator g(x) = (x - a^0)(x - a^1)...(x - a^(n-1)).

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMultiply(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

const generatorCache = new Map<number, number[]>();

/** Generator polynomial coefficients for `degree` EC codewords, highest power first (leading 1). */
function generatorPolynomial(degree: number): number[] {
  const cached = generatorCache.get(degree);
  if (cached) return cached;
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    // Multiply by (x - a^i); in GF(2^8) subtraction is addition (XOR).
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let k = 0; k < poly.length; k++) {
      next[k] ^= poly[k];
      next[k + 1] ^= gfMultiply(poly[k], GF_EXP[i]);
    }
    poly = next;
  }
  generatorCache.set(degree, poly);
  return poly;
}

/** The `ecLength` Reed-Solomon error correction codewords for one block of data codewords. */
export function reedSolomon(data: readonly number[], ecLength: number): number[] {
  const gen = generatorPolynomial(ecLength);
  const remainder = new Array<number>(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let k = 0; k < ecLength; k++) remainder[k] ^= gfMultiply(gen[k + 1], factor);
  }
  return remainder;
}

// ---------------------------------------------------------------------------------------------
// BCH codes for the format and version information.

/** Remainder of polynomial `value` divided by `generator` over GF(2). */
function bchRemainder(value: number, generator: number): number {
  const genDegree = 31 - Math.clz32(generator);
  let v = value;
  while (v !== 0 && 31 - Math.clz32(v) >= genDegree) v ^= generator << (31 - Math.clz32(v) - genDegree);
  return v;
}

/** 15 format bits: 2 ECC bits + 3 mask bits, BCH(15,5) with 0x537, XORed with 0x5412. */
function formatBits(ecc: QrEcc, mask: number): number {
  const data = (ECC_BITS[ecc] << 3) | mask;
  return ((data << 10) | bchRemainder(data << 10, 0x537)) ^ 0x5412;
}

/** 18 version bits: 6 version bits + BCH(18,6) with 0x1F25. */
function versionBits(version: number): number {
  return (version << 12) | bchRemainder(version << 12, 0x1f25);
}

// ---------------------------------------------------------------------------------------------
// Data encoding.

function dataCapacityCodewords(version: number, ecc: QrEcc): number {
  const [, g1, d1, g2, d2] = EC_BLOCKS[ecc][version - 1];
  return g1 * d1 + g2 * d2;
}

/** Byte-mode character count indicator length (Table 3). */
const countBits = (version: number) => (version <= 9 ? 8 : 16);

/** Largest byte-mode payload (in bytes) that fits a version and level. */
function byteCapacity(version: number, ecc: QrEcc): number {
  return Math.floor((dataCapacityCodewords(version, ecc) * 8 - 4 - countBits(version)) / 8);
}

/** Mode indicator, count, data, terminator, bit padding and pad codewords (0xEC, 0x11). */
function dataCodewords(bytes: Uint8Array, version: number, ecc: QrEcc): number[] {
  const capacityBits = dataCapacityCodewords(version, ecc) * 8;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  for (let pad = 0xec; codewords.length < capacityBits / 8; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

/** Split into blocks, add EC codewords to each, and interleave (data columns, then EC columns). */
function interleavedCodewords(data: readonly number[], version: number, ecc: QrEcc): number[] {
  const [ecLength, g1, d1, g2, d2] = EC_BLOCKS[ecc][version - 1];
  const blockLengths = [...new Array<number>(g1).fill(d1), ...new Array<number>(g2).fill(d2)];
  const dataBlocks: number[][] = [];
  let offset = 0;
  for (const length of blockLengths) {
    dataBlocks.push(data.slice(offset, offset + length));
    offset += length;
  }
  const ecBlocks = dataBlocks.map((block) => reedSolomon(block, ecLength));
  const out: number[] = [];
  const longest = Math.max(...blockLengths);
  for (let i = 0; i < longest; i++) for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  for (let i = 0; i < ecLength; i++) for (const block of ecBlocks) out.push(block[i]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Matrix construction.

interface Grid {
  size: number;
  dark: boolean[][];
  reserved: boolean[][]; // function patterns, format and version areas: never data, never masked
}

function newGrid(version: number): Grid {
  const size = 17 + 4 * version;
  const make = () => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, dark: make(), reserved: make() };
}

function setFunction(g: Grid, row: number, col: number, dark: boolean): void {
  g.dark[row][col] = dark;
  g.reserved[row][col] = true;
}

function drawFunctionPatterns(g: Grid, version: number): void {
  const n = g.size;
  // Finder patterns with their separators: a ring distance of 2 or 4 from the centre is light.
  for (const [cr, cc] of [[3, 3], [3, n - 4], [n - 4, 3]]) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = cr + dr;
        const c = cc + dc;
        if (r < 0 || c < 0 || r >= n || c >= n) continue;
        const ring = Math.max(Math.abs(dr), Math.abs(dc));
        setFunction(g, r, c, ring !== 2 && ring !== 4);
      }
    }
  }
  // Timing patterns.
  for (let k = 8; k < n - 8; k++) {
    setFunction(g, 6, k, k % 2 === 0);
    setFunction(g, k, 6, k % 2 === 0);
  }
  // Alignment patterns, skipping the three that would overlap a finder.
  const centres = ALIGNMENT_CENTRES[version - 1];
  const last = centres.length - 1;
  centres.forEach((r, i) => {
    centres.forEach((c, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) setFunction(g, r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    });
  });
  // Reserve the format areas now (filled once the mask is known) and draw the dark module.
  drawFormat(g, 0);
  setFunction(g, n - 8, 8, true);
  // Version information, versions 7 and up: 6x3 blocks beside the top-right and bottom-left finders.
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(g, b, a, dark);
      setFunction(g, a, b, dark);
    }
  }
}

/** Write both copies of the 15 format bits (bit 0 least significant). */
function drawFormat(g: Grid, bits: number): void {
  const n = g.size;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  // Copy 1, around the top-left finder.
  for (let i = 0; i <= 5; i++) setFunction(g, i, 8, bit(i));
  setFunction(g, 7, 8, bit(6));
  setFunction(g, 8, 8, bit(7));
  setFunction(g, 8, 7, bit(8));
  for (let i = 9; i < 15; i++) setFunction(g, 8, 14 - i, bit(i));
  // Copy 2, split between the top-right and bottom-left finders.
  for (let i = 0; i < 8; i++) setFunction(g, 8, n - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) setFunction(g, n - 15 + i, 8, bit(i));
}

/** Place the codeword bits in the two-column zigzag, right to left, skipping the timing column. */
function placeData(g: Grid, codewords: readonly number[]): void {
  const n = g.size;
  const totalBits = codewords.length * 8;
  let i = 0;
  let upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < n; k++) {
      const row = upward ? n - 1 - k : k;
      for (const col of [right, right - 1]) {
        if (g.reserved[row][col]) continue;
        // Remainder bits after the last codeword stay light (0).
        g.dark[row][col] = i < totalBits && ((codewords[i >> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
    upward = !upward;
  }
}

function applyMask(g: Grid, mask: number): boolean[][] {
  const condition = MASK_CONDITIONS[mask];
  return g.dark.map((row, r) => row.map((dark, c) => (g.reserved[r][c] ? dark : dark !== condition(r, c))));
}

// ---------------------------------------------------------------------------------------------
// Mask evaluation: the four penalty rules of ISO/IEC 18004 section 7.8.3.

const FINDER_LIKE_A = [true, false, true, true, true, false, true, false, false, false, false];
const FINDER_LIKE_B = [false, false, false, false, true, false, true, true, true, false, true];

function linePenalty(line: readonly boolean[]): number {
  let score = 0;
  // Rule 1: five or more same-coloured modules in a row: 3 + (run - 5).
  let run = 1;
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && line[i] === line[i - 1]) {
      run++;
    } else {
      if (run >= 5) score += run - 2;
      run = 1;
    }
  }
  // Rule 3: a 1:1:3:1:1 finder-like pattern with four light modules on one side: 40 each.
  for (let i = 0; i + 11 <= line.length; i++) {
    let a = true;
    let b = true;
    for (let k = 0; k < 11 && (a || b); k++) {
      if (line[i + k] !== FINDER_LIKE_A[k]) a = false;
      if (line[i + k] !== FINDER_LIKE_B[k]) b = false;
    }
    if (a) score += 40;
    if (b) score += 40;
  }
  return score;
}

function penaltyScore(m: readonly (readonly boolean[])[]): number {
  const n = m.length;
  let score = 0;
  for (let r = 0; r < n; r++) score += linePenalty(m[r]);
  for (let c = 0; c < n; c++) score += linePenalty(m.map((row) => row[c]));
  // Rule 2: each 2x2 block of one colour: 3.
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (m[r][c + 1] === v && m[r + 1][c] === v && m[r + 1][c + 1] === v) score += 3;
    }
  }
  // Rule 4: 10 for every full 5% the dark proportion is away from 50%.
  let dark = 0;
  for (const row of m) for (const d of row) if (d) dark++;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

// ---------------------------------------------------------------------------------------------
// Public API.

/** Encode `text` (UTF-8, byte mode) as a QR code. Returns modules [row][column], true = dark. */
export function encodeQr(text: string, opts: QrOptions = {}): boolean[][] {
  const ecc = opts.ecc ?? "M";
  if (!Object.prototype.hasOwnProperty.call(EC_BLOCKS, ecc)) {
    throw new Error(`Unknown QR error correction level "${String(ecc)}": use L, M, Q or H`);
  }
  if (opts.mask !== undefined && !(Number.isInteger(opts.mask) && opts.mask >= 0 && opts.mask <= 7)) {
    throw new Error(`QR mask must be a whole number from 0 to 7, not ${String(opts.mask)}`);
  }
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= MAX_VERSION && bytes.length > byteCapacity(version, ecc)) version++;
  if (version > MAX_VERSION) {
    throw new Error(
      `Text too long for a QR code: ${bytes.length} bytes, but version ${MAX_VERSION} at level ${ecc} ` +
        `holds at most ${byteCapacity(MAX_VERSION, ecc)} bytes. Shorten it or use a lower level.`,
    );
  }

  const grid = newGrid(version);
  drawFunctionPatterns(grid, version);
  placeData(grid, interleavedCodewords(dataCodewords(bytes, version, ecc), version, ecc));

  const render = (mask: number) => {
    drawFormat(grid, formatBits(ecc, mask));
    return applyMask(grid, mask);
  };
  if (opts.mask !== undefined) return render(opts.mask);
  let best = render(0);
  let bestScore = penaltyScore(best);
  for (let mask = 1; mask < 8; mask++) {
    const candidate = render(mask);
    const score = penaltyScore(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);

/** A compact SVG of the QR code: one path of dark modules on a white background, crisp edges. */
export function qrSvg(text: string, opts: QrSvgOptions = {}): string {
  const margin = opts.margin ?? 4;
  if (!Number.isInteger(margin) || margin < 0) throw new Error(`QR margin must be a whole number, 0 or more, not ${margin}`);
  if (opts.size !== undefined && !(Number.isFinite(opts.size) && opts.size > 0)) {
    throw new Error(`QR size must be a positive number of pixels, not ${opts.size}`);
  }
  const m = encodeQr(text, { ecc: opts.ecc });
  const extent = m.length + 2 * margin;
  // One subpath per horizontal run of dark modules.
  let d = "";
  m.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (!row[c]) continue;
      let w = 1;
      while (c + w < row.length && row[c + w]) w++;
      d += `M${c + margin} ${r + margin}h${w}v1h-${w}z`;
      c += w - 1;
    }
  });
  const sized = opts.size !== undefined ? ` width="${opts.size}" height="${opts.size}"` : "";
  const titled = opts.title !== undefined;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}"${sized}` +
    ` shape-rendering="crispEdges"${titled ? ' role="img"' : ""}>` +
    (titled ? `<title>${escapeXml(opts.title as string)}</title>` : "") +
    `<rect width="100%" height="100%" fill="#fff"/>` +
    `<path fill="#000" d="${d}"/>` +
    `</svg>`
  );
}
