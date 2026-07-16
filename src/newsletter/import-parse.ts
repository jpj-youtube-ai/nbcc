import ExcelJS from "exceljs";

// TASK-260: parsing "a spreadsheet with name and email in 2 columns" into rows the import preview can
// show honestly. The admin confirms what they SEE, so what they see must be exactly what will import:
// every problem row named with its line and reason, in-file duplicates collapsed (first wins), and no
// dependence on column order — the cell containing an @ is the email, whichever side it's on.

export interface ImportRow {
  name: string | null;
  email: string;
}
export interface ImportIssue {
  line: number; // 1-based, as the admin sees it in their spreadsheet
  value: string;
  reason: string;
}
export interface ParsedImport {
  rows: ImportRow[];
  issues: ImportIssue[];
}

// A deliberately simple email shape check — the real arbiter is the send later; this only keeps
// obvious non-addresses out of the list.
const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pure CSV → cells. Handles quoted cells (embedded delimiters, doubled quotes), CRLF, a UTF-8 BOM,
// and Excel's regional exports (comma, semicolon or tab — chosen by which appears in the first line).
export function parseCsvRows(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, ""); // strip a UTF-8 BOM (Excel's CSV export loves these)
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Cells → normalized people + named issues. Line numbers are 1-based against the ORIGINAL sheet so
// the admin can find the row they're told about.
export function normalizeImportRows(cells: string[][]): ParsedImport {
  const rows: ImportRow[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();

  cells.forEach((cols, i) => {
    const line = i + 1;
    const trimmed = cols.map((c) => (c ?? "").trim());
    const joined = trimmed.filter(Boolean).join(", ");
    if (trimmed.every((c) => c === "")) {
      issues.push({ line, value: "", reason: "Empty row" });
      return;
    }
    // A header row ("Name,Email" and variants) is skipped silently — it is not a problem, it is a
    // spreadsheet being a spreadsheet.
    if (i === 0 && trimmed.some((c) => /^e-?mail/i.test(c)) && !trimmed.some((c) => EMAILISH.test(c))) {
      return;
    }
    const email = trimmed.find((c) => EMAILISH.test(c));
    if (!email) {
      issues.push({ line, value: joined, reason: "No email address found" });
      return;
    }
    const lower = email.toLowerCase();
    if (seen.has(lower)) {
      issues.push({ line, value: joined, reason: "Duplicate of an earlier row" });
      return;
    }
    seen.add(lower);
    const name = trimmed.find((c) => c && c !== email) ?? null;
    rows.push({ name, email: lower });
  });

  return { rows, issues };
}

// One entry point for both formats, chosen by extension — the admin drops in whatever they have.
export async function parseImportFile(filename: string, data: Buffer): Promise<ParsedImport> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return normalizeImportRows(parseCsvRows(data.toString("utf8")));
  }
  if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return { rows: [], issues: [{ line: 1, value: filename, reason: "The workbook has no sheets" }] };
    const cells: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cols: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cols.push(cell.text ?? String(cell.value ?? ""));
      });
      cells.push(cols);
    });
    return normalizeImportRows(cells);
  }
  throw new Error("Unsupported file type — upload a CSV or Excel (.xlsx) file");
}
