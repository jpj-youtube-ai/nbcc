import { describe, it, expect } from "vitest";
import { encodeQr, qrSvg, reedSolomon } from "../../src/fundraising/qr";
import { decodeQr, functionPatternProblems, penalty, readFormat, type Ecc } from "./helpers/qr-decode";

// TASK-493: a dependency-free QR code encoder (ISO/IEC 18004, byte mode, versions 1 to 10) for
// fundraiser pages. Correctness is shown three independent ways:
//   1. exact module-for-module agreement with reference grids produced once, offline, by a
//      different encoder (node-qrcode 1.5.0, forced to byte mode); it is not a dependency;
//   2. published worked values from the standard (Reed-Solomon, format and version bits);
//   3. a separate strict decoder (helpers/qr-decode.ts) that round-trips every generated code:
//      fixed patterns, format BCH, zigzag read, de-interleave, zero RS syndromes, byte mode back.

const URL = "https://nbcc.scot/fundraise/sams-santa-dash-2026";
const ECCS: Ecc[] = ["L", "M", "Q", "H"];

// Invented filler text: deterministic, any length.
const filler = (n: number) => {
  const base = "The quick brown fox jumps over the lazy dog 0123456789 ";
  let s = "";
  while (s.length < n) s += base;
  return s.slice(0, n);
};

// Reference grids: row-major, one bit per module (1 = dark), MSB first, base64.
const REFERENCES: { text: string; ecc: Ecc; version: number; mask: number; grid: string }[] = [
  { text: 'hello', ecc: "M", version: 1, mask: 0, grid: "/mP8FhBulrt0ZdusrsEFB/qv4AcAqlCRYRDUuj+QBCayqAB6n/jc8Eewurcd0hmuuisEhS/usYA=" },
  { text: URL, ecc: "L", version: 3, mask: 7, grid: "/kkT/BTcEG6+Wrt05GXbqHouwWvNB/qqr+AZfwDTLJOxpYR6VLst3BE4bGJgRGXw0DwDCmiJ+YS9ahYhXBDvsDpnqoCGCyXyOXVj+gBTTF/7KypQSrceuiXPjdYjHy6EDDsF+tcv7aT1AA==" },
  { text: URL, ecc: "M", version: 4, mask: 2, grid: "/nT/P8En4FBurR9Lt1hzJduvEnrsFoxBB/qqqv4BZkwAvgfDvkIYTtvD1Gsa2ZVRuejgAg3YgDx9nO9hw5SreX3sAxZb2LynPptVqXAWggJ/s/f8WI3EjKkZFhimqd1xOg9MmilC+ABnX0X/kWrq0FWDseuuk0/d1p5ibuq42sEEMToc/uLR1QA=" },
  { text: URL, ecc: "Q", version: 5, mask: 5, grid: "/t3fQ/wX920Qbp1Vxrt0vu6V26aUVC7BCpE1B/qqqq/gBblbAEORoKwb5k2bWQS6ch62K7w3Rz/iaBkhkBRMjpPqSfFdY5OlNi7DIUxmrCouNOsY6XZfg9BlAXub8KMserJj3pzpXUUKSD++NEboU2Qxb59lC/twKLcBGL9yl9Vraz6aHvqAYVqEY/sAh6uwT/K3GroBzv+t0Vxz066JK+0TBeBGXx/gsSi8gA==" },
  { text: URL, ecc: "H", version: 6, mask: 0, grid: "/oRBP7/BKlAp0G6XT2Ort1a3meXbp1w5cuwRebHZB/qqqqr+AAv42AAupZ90xIahtRZzbeIE8pS5G2VB3jvx0hnVTuR3nsoeb7Ue4JcqhJzeQAYsoBy01LhBBlHE1XEgu+CJYEjyHSZrcqbMb2xsN6zMfm0aj3PlZ3sKVzVdLPSMmFrQMGSREEiOsjXjsNEFcxA4WlDn7r28DmpGyYZOk13hKdm+r6Gl+IBRHWRG/53CQWtwWsj+EZur1kqPjdIEim5m66MAnGMETnBPav4l7c2dgA==" },
  { text: 'Caf\u00e9 \u2615 \u00a35', ecc: "Q", version: 2, mask: 7, grid: "/qS/wROQbrcrt1jl26Hq7BSxB/qq/gFkAFfJdqDFuPqkKuO0YWhtjaiCin57N5Krxf3ic/qASMc/o6vwXPHLoa+F1xMq6NRDBS0k/mrJgA==" },
  { text: filler(17), ecc: "L", version: 1, mask: 0, grid: "/iP8EpBuuLt01dumLsExB/qv4BkA774nIW/s326LECKvAYBfw/v38FeIusmN0WYurusFcC/ujYA=" },
  { text: filler(7), ecc: "H", version: 1, mask: 1, grid: "/jv8FRBurrt1VdupLsFxB/qv4AEAJ93wwBFcs/toqo+tFIBHa/qisF8junjN0jwurj8Eqo/luIA=" },
  { text: filler(26), ecc: "M", version: 2, mask: 5, grid: "/io/wVcQbrart1KV26Tq7BNBB/qq/gGwAIKNZ3KZxyOoTmwPNRvli1VgbIJNNvcZlh2yr/uAfcT/nSqwR3GLpH+l0rs+6atDBJVp/pDUgA==" },
  { text: filler(32), ecc: "Q", version: 3, mask: 7, grid: "/rsT/BI0UG62/rt1jUXbpXAuwUf9B/qqr+AUmABXhAdrgBJx5uv/ZdBtMmkzxPWyQKob63EycKxcI889TVMGO1or6LAOIN7nOfDI+oBMPE/6qarQVJEeum9vjdRS1K6eICMFbtov5+SNAA==" },
  { text: filler(60), ecc: "L", version: 4, mask: 2, grid: "/kK3P8FslRBunM9Lt1osdduiwdLsFT11B/qqqv4AG30A++ty1QBgT9n9tkgHzD5hscJ1BgXBS3TpNU8dkzjIW0lO6wviSX4wy5Bljlub2b5gjcK9F72NznDLFjyeEPVRGmgsssr6+QBADsS/rkPrUEpg8UupDg+d1HDgXuufEIkF2Vg8/svzkQA=" },
  { text: filler(44), ecc: "H", version: 5, mask: 5, grid: "/tLpw/wSRRlQbq27Krt0Y/i126kzoq7BL8rVB/qqqq/gH5RAAAYR/uKprVqlryCqeVTHeaKVRD4tvKG0nh5VLijO6wBXcQd0thw+ZJlS7q+TtMjY1ERvk/JgNTaXuT6Vb1BOlDhhSSQX5HEC8dUppiVOmxQiuKaooejbNpcxv00ey2ZMzP4AT/eMU/lWL6uwX7qDGboXov/t0Zp9ui6TmgNLBLsWFJ/iyFD4gA==" },
  { text: filler(100), ecc: "M", version: 6, mask: 2, grid: "/gS9S7/BBtZIUG6ow0gLt1h1CuXbr+k4+uwW6WexB/qqqqr+AS5ZYAC+Gsh+Piokjof2wZ+zDjYVCBXhb606fx7FNGmqXl/tGcJJ2Sz5Nj5AGCL02u0T0Lvvldx57lEkohEwPpBZkjqxx0FLJWGuG/NIvZPreRlLGSW65rrixAYEwR6l3eS7kjyyU4dRpAiZN16P0DSi0BhtZvu+sfgVYERKYRqCTcH2/4BlDMfG/4HIrGoQXLAicausUv/PtdZEjFgu6rYgWakERCoF+v6Yyu1aAA==" },
  { text: filler(70), ecc: "Q", version: 6, mask: 4, grid: "/h7VkL/BCKsBkG6tmoELt0spU1Xbqjnf4uwWd4w5B/qqqqr+AKwNbwBK31mO2nj4oJ0dYoiLhKo2vcMQpbs6UUFdTUPDN9X9G3dHw4Op0p5KWsaCIi5U9J8vCH5RmY1cHXi9fKqOMLHKrN1M57FZw9ofoc3wkgF9Czgin8KlpYVY1wq9HlK+ZU+0N7Bv1cSx+/oKzFRiaPHB7HgrKEKKGI15Dkn3FnG/+AB39OhH/5xBZmowTkMmkYusPt5f3dHTup4y6NLsYUMFl14Zy/4ciI35AA==" },
  { text: filler(150), ecc: "L", version: 7, mask: 2, grid: "/hoBV0v8Fiv1qpBuh7gn9Lt1+V/INdunofwrrsFMVF6hB/qqqqqv4ACVG18A+/XvkVVQbDBCFu1+jc5uXcjJtmlza+FnHi4iQSJpIYGMl9oPKpWuloJqLXk/rm3i40JE4zqC/OpX5g+veNQDMOgTM8X6z/hi/JRpJGEsX6uP6sWryRqjGd0cb/n/43/Di1BYMENXn1nMD0S718kXpMf1XkIk+VDtD2vnvxgFodiTyBAtcxL+c8nlAg6fDYKcvMOCscNaH1zwrMk/ttmsX/sk/QBvjGNkR/o66oDr0E1zE/ceup6vhx+V1UBMkK2uvsu8D4MFUr7zuU/qHl4gsQA=" },
  { text: filler(120), ecc: "M", version: 7, mask: 2, grid: "/nxVV8v8EvEtiJBuqEgq9Lt1ndEktduvAfwrrsFmZFKBB/qqqqqv4BJhEx0Avl1fkSPiBX2ismN7xblvGc1CwMO/r8FrfjpEAXANIwkGXuiWo5HrTwLMD7gdroH28UIMqmqiXOx/shK8fNwI80uXm2H8V/1n+NRmhEmsTCp66pSq1RM9Fdkcb4O/pk+E72vycHC1jcpaOk1Z+vuBJsfsLR4kSMQ6y4nKDZ2GpdWVT7hOuVJmn7iRo2mESrH2tOFCv0lMH0zxCUcXrOmgufkC+QBSpGUsd/kR69SrkFeLG7kVuvOPx3+F1RkO/L/urHPpa50EmVpxWk/scUly8QA=" },
  { text: filler(100), ecc: "Q", version: 8, mask: 6, grid: "/mKOE7C/wWV6nF3Qbo1Va/lrt1lLt/+l26w2/3XC7BLosUrRB/qqqqqq/gHAJElfAF7j+/UIbXq5/mPX9wCJDcY/Uf4t54Ta3dL06q14t9JvEaq6W3D54MWUKn8AvXsYiy1zU9XV7b5Ci/sIYvcNsRdF/3WrgAIOgqai/CsflJNXQ5N4V3/NP3jP1uPycYB0e8EXSsfGvqis/FgtG+tEO/0p/kW+9YHKDOTr3HmgjV/TOG8Pev0FmG8qaaBW2oPCNI8nKbJqSgTpusJezBM3FqnJUGNeau8nTQx+KfNzlsjt8xQmCBA2l0EfOqjBKM7jin6GTj3ir1PzjfuAVF0TVMS/mC2o7WuwXnbHQtGLqww/tL/d1nGGu3CS6Sy+k+FzBVA/hWFf/hsPm8+UgA==" },
  { text: filler(90), ecc: "H", version: 9, mask: 6, grid: "/kR21SOj/BD2PnepkG6t7dHHRLt1/8fPV9Xbp9C/nrIuwROHRl9xB/qqqqqqr+ACNdG8XQAbUdz+LOhh5Dr6kTvyg+X9IUZGyOrkfR0rTprvvGjSn63ysUyKkbC1fZ5xPn5ytJDNJU6C5IYxLA0scdMlYoUs55bIkB30XmMrA4QkXNNOUSV+b89p3xrIM/fivQsv6dFwijyAs+QoiHyhT8Xp/ajv2cWZDFfzRfqkK+pH9rPR6UUVgFHg+F3v7pP40EcGZp6+ayh0x4zi76m0tjeMvNbGlUUPjPR/Rv9CJfd+poTQ2zJTFXvRHY+AMY5+Lg7t+bHYGq3+XzH2qCfFty1ar4VllhgGhcrDSmi6TxCkuvYjbyS31UQ5o1XqwK7z+cCEYSaUX9Hl+gBENcatNHv7ftK/IyqQQ62RwokQuuP1/i2/nddFUG9d4q6elNQ75OMENJSS9F3f42w1KeT4AA==" },
  { text: filler(271), ecc: "L", version: 10, mask: 2, grid: "/noCm83nP8FnmxaX4JBunUz2oW/Lt1adiENmJdujcXv0i5LsF7vHF/rRB/qqqqqqqv4AsPHHA9EA+6Xpf3l3VVTNK8uGUsti31qGeuKuwDiqgVwRm8K4moclknAH7bA+vGHONA7gpVOIWJRy+HU3pdkca5XtIgwjUBzPqU9kNkrusTlgSsH9XapxuzqV9fuuDoI142RfY0i0VElOuNk6jpK9SswzIiM1Q1IfKn24ISozAfZhicuCcuRj9o8vzdT+lxKHHFDVUeKo6oKx8zqOxIKdHmvMZn7G//n4a+GR8+hLgzpXU63tGmg0qBbSKUqquENEoTE6zqWQSDbq9DhV9tQ/7obwhwiCR1qcGAEhoVr+k7i7GlCaekgTw27u4xPoCVp0mD6fKUNqMnv5lEm6vvC30AQ0xRuRJlfy24Q1sSOOTaKcCGcBHp9t/1utW23x+vNji9fMAvX1Pjhy+AB3C1EqlMf/pYFazMTr0EL01FJ1kduviofxwF/F14g/0MFKcupJ04/pexEFElfdr94k/tvtSV5gsQA=" },
  { text: filler(213), ecc: "M", version: 10, mask: 2, grid: "/iqHxg1jP8Eo6nY9hpBuu7smdCvLt15XBGsGpduqO7v1W5LsFXfjEZ6xB/qqqqqqqv4B6w/HAR4Avm+Ufk8zPlCq6dkKMuF8q6k0WoHamRuPUxqxI/AokFJ1oSJSKfSnuEMmi+sYT4W/T8zxH82fB7gWStbANy0FUR65NnnIkGxXhADnfuGdxaNJex/9Mee6xCIF92YUAywktGUMvHrt+FG8Xc1itL69hXn/o6IjY1p0Aca+gsMiHOlL4bNf69f+mR88JH5dsVKq82Kl9lrDRmFXHEkEd34ir/moO+zqDsADS/5vD1SnGy50mfpJ3UmAMkGRybkpi4CQ9BCHVBQVLMXiage3gkmFqSldJqfNnegTS13KXRSCD7AjCWNOy/eUDwowSD4dw9iusChN0QTa2NCw1SkndJq1JtQhjYWRwWWQrdBdsilEnpvK+yirHA3y2KWzIXrGA6z3fhk2/QBEkfFufMR/ihAanMbq0FHOBHJZ8curwtf3hh+V10wXQMNgwuuTAwn9G0EEFRU9i9ac/ogEWVgS/QA=" },
  { text: filler(151), ecc: "Q", version: 10, mask: 6, grid: "/hp/mO8jP8FneFpcopBun+D/8M/Lt18UEQU/pdusNwv9NxLsEfPLEhwRB/qqqqqqqv4BnvPHr0kAXp5yvlylbQIFitPzt3E7/VE2vDP38ieBl4gncEeuyIq22rbMBw16gpOlA1jW629bRdn75VcZRGVHl+0eilsNNMJqo8B2N2nY7OpBjGYmowb85KR2s0AgsH33iACNbdMC+VMf7dnkqDv1eUhRGvxYKFDEA/GSiin6Cdo+f0dFstOP9GnP06d/HRJvrGYCUfqqO8KloMq4RnDTHys0Zf6oGPkzc/pgVg0JB+Knyo6hD3uGkYib4yP19XyxrinyvRLZexZAYdItB1d5AI167JcUgT6jxJFLCj2kO+V/di1xqhHrqE49tqhjv6pJfABzzfd2F+aNz76eB2Y7MbojLgA2ufkh6K2buCFSAT9THzl70pgZWeK1Pd/wtLX8ynRUAzBHf/75/ABu2NHllEW/l50KkbUqkFLZ7GTKUcutlV/9gd+d1fsVR0XSMuh1/L0mA78Ftu8SASNP/jX01G6g7AA=" },
  { text: filler(119), ecc: "H", version: 10, mask: 2, grid: "/ohoKn13P8FxqxvPrJBus0AIVGPLt0S7nCaCpdukuwP0l5LsF+XxHnoxB/qqqqqqqv4BqtlENxgAOrpT/1wlc4jQHaR2mO3FgTHEhpQoiqbi8vY5m8F/Fe7mJQBFKiIRfavGjTwYY9wJbOyBBujC7/gWZ8EDMOYVMQa2IDpivEdcuPIm08e53JZ7rnXdt3K4vkG95UQSZV4/DC1GvQpN5CTMHrzh3xcuF3OUNjbSyOggRDIfIdaGPm/75OG/1pS/GR4iVHSTkcGoDWK0NUr3x4l7FSmMZj/KkPhMH+Xar2Km+1p0FufnFrEymJzfssSi+mHWxX9GYNWwSilOinUxvHcyS1Gyt0KbzMFeXg2ElC9Jklt6PAnBxjHJkBLmk3EdA1Z0zUb/E8rekOF/tlAVgMPFjKnXAW89JvI38dX9ZQfWRapIE0sDFpiUrlt8X03x7ioSl97tAtgRPv92+QBNUPEccMX/mgCKpFDq0Ex8VFn3Ufuvgm/kw0+d1R0JZ+lJ8uqNi+x1GgEEr00UvXKk/h1L0ZZmpQA=" },
];

const unpack = (b64: string, size: number): boolean[][] => {
  const bytes = Buffer.from(b64, "base64");
  return Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => {
      const i = r * size + c;
      return ((bytes[i >> 3] >> (7 - (i & 7))) & 1) === 1;
    }),
  );
};

// Byte-mode capacity (characters) per version 1..10, ISO/IEC 18004 Table 7.
const CAPACITY: Record<Ecc, number[]> = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271],
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119],
};

describe("Reed-Solomon error correction", () => {
  it("matches the ISO/IEC 18004 Annex I worked example (01234567, 1-M)", () => {
    const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
    expect(reedSolomon(data, 10)).toEqual([165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
  });

  it("matches the published HELLO WORLD 1-M example", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomon(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
});

describe("encodeQr against reference grids from an independent encoder", () => {
  it("covers every version 1 to 10 and every error correction level", () => {
    expect(new Set(REFERENCES.map((r) => r.version)).size).toBe(10);
    expect(new Set(REFERENCES.map((r) => r.ecc)).size).toBe(4);
  });

  for (const ref of REFERENCES) {
    it(`${ref.ecc} version ${ref.version}, ${Buffer.byteLength(ref.text)} bytes: identical modules`, () => {
      const size = 17 + 4 * ref.version;
      const expected = unpack(ref.grid, size);
      const actual = encodeQr(ref.text, { ecc: ref.ecc });
      expect(actual.length).toBe(size);
      expect(readFormat(actual).mask).toBe(ref.mask);
      expect(actual).toEqual(expected);
    });
  }
});

describe("encodeQr structure", () => {
  it("defaults to error correction M", () => {
    expect(readFormat(encodeQr("hello")).ecc).toBe("M");
  });

  it("writes the published format bits (L, mask 4 = 110011000101111; M, mask 0 = 101010000010010)", () => {
    expect(readFormat(encodeQr("hello", { ecc: "L", mask: 4 })).raw).toBe(0b110011000101111);
    expect(readFormat(encodeQr("hello", { ecc: "M", mask: 0 })).raw).toBe(0b101010000010010);
  });

  it("writes the published version information for versions 7 to 10", () => {
    const published = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 } as Record<number, number>;
    for (const v of [7, 8, 9, 10]) {
      const m = encodeQr(filler(CAPACITY.L[v - 1]), { ecc: "L" });
      expect(m.length).toBe(17 + 4 * v);
      const n = m.length;
      let bits = 0;
      for (let i = 17; i >= 0; i--) bits = (bits << 1) | (m[Math.floor(i / 3)][n - 11 + (i % 3)] ? 1 : 0);
      expect(bits).toBe(published[v]);
    }
  });

  it("has finder patterns at three corners, separators, alternating timing, alignment and the dark module", () => {
    for (let v = 1; v <= 10; v++) {
      const m = encodeQr(filler(CAPACITY.M[v - 1]), { ecc: "M" });
      expect(m.length).toBe(17 + 4 * v);
      expect(functionPatternProblems(m)).toEqual([]);
    }
  });

  it("every mask can be forced and still decodes", () => {
    for (let mask = 0; mask < 8; mask++) {
      const m = encodeQr(URL, { ecc: "Q", mask });
      const d = decodeQr(m);
      expect(d.mask).toBe(mask);
      expect(d.text).toBe(URL);
    }
  });

  it("chooses the mask with the lowest penalty score (lowest number on a tie)", () => {
    for (const text of ["hello", URL, filler(100), filler(200)]) {
      for (const ecc of ECCS) {
        if (Buffer.byteLength(text) > CAPACITY[ecc][9]) continue;
        const scores = Array.from({ length: 8 }, (_, mask) => penalty(encodeQr(text, { ecc, mask })));
        const best = scores.indexOf(Math.min(...scores));
        expect(readFormat(encodeQr(text, { ecc })).mask).toBe(best);
      }
    }
  });
});

describe("encodeQr round trips through an independent decoder", () => {
  for (const ecc of ECCS) {
    it(`${ecc}: picks the smallest version at every capacity boundary and decodes back`, () => {
      for (let v = 1; v <= 10; v++) {
        const cap = CAPACITY[ecc][v - 1];
        const full = decodeQr(encodeQr(filler(cap), { ecc }));
        expect(full).toMatchObject({ version: v, ecc, text: filler(cap) });
        if (v < 10) {
          const over = decodeQr(encodeQr(filler(cap + 1), { ecc }));
          expect(over).toMatchObject({ version: v + 1, ecc, text: filler(cap + 1) });
        }
      }
    });

    it(`${ecc}: every length from 0 to the version 10 limit decodes back`, () => {
      for (let len = 0; len <= CAPACITY[ecc][9]; len++) {
        const text = filler(len);
        expect(decodeQr(encodeQr(text, { ecc })).text).toBe(text);
      }
    });
  }

  it("encodes text as UTF-8 bytes", () => {
    for (const text of ["Café ☕ £5", "Ceud mìle fàilte", "🎅 Santa Dash", "<&\"'>"]) {
      for (const ecc of ECCS) expect(decodeQr(encodeQr(text, { ecc })).text).toBe(text);
    }
  });

  it("the fundraiser URL decodes back at every level", () => {
    for (const ecc of ECCS) expect(decodeQr(encodeQr(URL, { ecc })).text).toBe(URL);
  });

  it("counts UTF-8 bytes, not characters, against capacity", () => {
    // 7 two-byte characters = 14 bytes: fits 1-L (17) but not 1-Q (11).
    const text = "é".repeat(7);
    expect(decodeQr(encodeQr(text, { ecc: "L" })).version).toBe(1);
    expect(decodeQr(encodeQr(text, { ecc: "Q" })).version).toBe(2);
  });
});

describe("encodeQr errors", () => {
  it("throws a clear error when the text does not fit in version 10", () => {
    expect(() => encodeQr(filler(214), { ecc: "M" })).toThrow(/too long.*214 bytes.*213/i);
    expect(() => encodeQr(filler(120), { ecc: "H" })).toThrow(/too long/i);
  });

  it("rejects an unknown error correction level or mask", () => {
    expect(() => encodeQr("x", { ecc: "X" as Ecc })).toThrow(/error correction/i);
    expect(() => encodeQr("x", { mask: 8 })).toThrow(/mask/i);
  });
});

describe("qrSvg", () => {
  const parsePath = (svg: string, size: number): boolean[][] => {
    const d = /<path [^>]*d="([^"]*)"/.exec(svg)?.[1] ?? "";
    const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    const run = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;
    let consumed = 0;
    for (let mt = run.exec(d); mt; mt = run.exec(d)) {
      const [, x, y, w, back] = mt.map(Number);
      expect(back).toBe(w);
      for (let k = 0; k < w; k++) grid[y][x + k] = true;
      consumed += mt[0].length;
    }
    expect(consumed).toBe(d.length);
    return grid;
  };

  it("draws exactly the encoder's dark modules in a single path, offset by the margin", () => {
    const m = encodeQr(URL);
    const n = m.length;
    const svg = qrSvg(URL);
    expect(svg.match(/<path /g)).toHaveLength(1);
    const grid = parsePath(svg, n + 8);
    for (let r = 0; r < n + 8; r++) {
      for (let c = 0; c < n + 8; c++) {
        const inside = r >= 4 && c >= 4 && r < n + 4 && c < n + 4;
        expect(grid[r][c]).toBe(inside ? m[r - 4][c - 4] : false);
      }
    }
  });

  it("is a compact, crisp SVG with a white background and a viewBox in modules", () => {
    const n = encodeQr(URL).length;
    const svg = qrSvg(URL);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${n + 8} ${n + 8}"`);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toMatch(/<rect width="100%" height="100%" fill="#fff"\/>/);
    expect(svg).not.toContain("<title>");
    expect(svg).not.toContain("\n");
    expect(svg.length).toBeLessThan(6000);
  });

  it("respects margin and size", () => {
    const n = encodeQr(URL).length;
    const svg = qrSvg(URL, { margin: 0, size: 240 });
    expect(svg).toContain(`viewBox="0 0 ${n} ${n}"`);
    expect(svg).toContain('width="240" height="240"');
    expect(parsePath(svg, n)).toEqual(encodeQr(URL));
    expect(() => qrSvg(URL, { margin: -1 })).toThrow(/margin/i);
    expect(() => qrSvg(URL, { size: 0 })).toThrow(/size/i);
  });

  it("passes the error correction level through", () => {
    const n = encodeQr(URL, { ecc: "H" }).length;
    expect(qrSvg(URL, { ecc: "H" })).toContain(`viewBox="0 0 ${n + 8} ${n + 8}"`);
  });

  it("adds an escaped, accessible title", () => {
    const svg = qrSvg(URL, { title: `Sam's <Santa> "Dash" & more` });
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title>Sam&#39;s &lt;Santa&gt; &quot;Dash&quot; &amp; more</title>");
    expect(svg).not.toContain("<Santa>");
  });

  it("is safe inline in HTML: no XML prolog, no script, no event handlers", () => {
    const svg = qrSvg(`"><script>alert(1)</script>`, { title: `"><img src=x onerror=alert(1)>` });
    expect(svg).not.toMatch(/<\?xml|<!DOCTYPE/i);
    const tags = [...svg.matchAll(/<\/?([a-zA-Z]+)([^>]*)>/g)];
    expect(new Set(tags.map((t) => t[1]))).toEqual(new Set(["svg", "title", "rect", "path"]));
    for (const t of tags) expect(t[2]).not.toMatch(/\son\w+\s*=/i);
  });
});
