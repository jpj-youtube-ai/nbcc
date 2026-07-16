import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseCsvRows, normalizeImportRows, parseImportFile } from "../../src/newsletter/import-parse";

// TASK-260: parsing "a spreadsheet with name and email in 2 columns". The whole feature hangs on the
// PREVIEW being trustworthy — the admin confirms what they see, so what they see must be exactly what
// will import: every problem row named with its line and reason, duplicates inside the file collapsed
// (first wins), and no guessing about which column is which (the cell with an @ is the email — column
// ORDER must not matter, because nobody controls how the spreadsheet was laid out).

describe("parseCsvRows (pure CSV)", () => {
  it("parses simple rows", () => {
    expect(parseCsvRows("Ann,ann@x.com\nBen,ben@x.com")).toEqual([
      ["Ann", "ann@x.com"],
      ["Ben", "ben@x.com"],
    ]);
  });

  it("handles quoted cells with commas, doubled quotes, and CRLF", () => {
    expect(parseCsvRows('"Smith, Ann",ann@x.com\r\n"He said ""hi""",ben@x.com')).toEqual([
      ["Smith, Ann", "ann@x.com"],
      ['He said "hi"', "ben@x.com"],
    ]);
  });

  it("accepts semicolon and tab delimiters (Excel regional exports)", () => {
    expect(parseCsvRows("Ann;ann@x.com")).toEqual([["Ann", "ann@x.com"]]);
    expect(parseCsvRows("Ann\tann@x.com")).toEqual([["Ann", "ann@x.com"]]);
  });

  it("strips a UTF-8 BOM and skips blank lines", () => {
    expect(parseCsvRows("﻿Ann,ann@x.com\n\n")).toEqual([["Ann", "ann@x.com"]]);
  });
});

describe("normalizeImportRows", () => {
  it("finds the email by content, so column order never matters", () => {
    const out = normalizeImportRows([
      ["ann@x.com", "Ann"],
      ["Ben", "ben@x.com"],
    ]);
    expect(out.rows).toEqual([
      { name: "Ann", email: "ann@x.com" },
      { name: "Ben", email: "ben@x.com" },
    ]);
    expect(out.issues).toEqual([]);
  });

  it("skips a header row rather than importing 'Email' as a person", () => {
    const out = normalizeImportRows([
      ["Name", "Email"],
      ["Ann", "ann@x.com"],
    ]);
    expect(out.rows).toEqual([{ name: "Ann", email: "ann@x.com" }]);
  });

  it("names every problem row with its line number and reason", () => {
    const out = normalizeImportRows([
      ["Ann", "ann@x.com"],
      ["Ben", "not-an-email"],
      ["", ""],
    ]);
    expect(out.rows).toEqual([{ name: "Ann", email: "ann@x.com" }]);
    expect(out.issues).toEqual([
      { line: 2, value: "Ben, not-an-email", reason: "No email address found" },
      { line: 3, value: "", reason: "Empty row" },
    ]);
  });

  it("collapses duplicates inside the file — first occurrence wins, the repeat is reported", () => {
    const out = normalizeImportRows([
      ["Ann", "ann@x.com"],
      ["Ann Again", "ANN@X.COM"],
    ]);
    expect(out.rows).toEqual([{ name: "Ann", email: "ann@x.com" }]);
    expect(out.issues).toEqual([{ line: 2, value: "Ann Again, ANN@X.COM", reason: "Duplicate of an earlier row" }]);
  });

  it("lowercases addresses and trims names", () => {
    const out = normalizeImportRows([["  Ann  ", " Ann@X.Com "]]);
    expect(out.rows).toEqual([{ name: "Ann", email: "ann@x.com" }]);
  });
});

describe("parseImportFile (CSV or real Excel)", () => {
  it("parses a real .xlsx workbook — built with the same library, not a hand-faked buffer", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("People");
    ws.addRow(["Name", "Email"]);
    ws.addRow(["Ann", "ann@x.com"]);
    ws.addRow(["Ben", "ben@x.com"]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const out = await parseImportFile("people.xlsx", buffer);
    expect(out.rows).toEqual([
      { name: "Ann", email: "ann@x.com" },
      { name: "Ben", email: "ben@x.com" },
    ]);
  });

  it("parses a CSV by extension", async () => {
    const out = await parseImportFile("people.csv", Buffer.from("Ann,ann@x.com"));
    expect(out.rows).toEqual([{ name: "Ann", email: "ann@x.com" }]);
  });

  it("rejects an unsupported extension with a plain-English error", async () => {
    await expect(parseImportFile("people.pdf", Buffer.from("x"))).rejects.toThrow(/csv or excel/i);
  });
});
