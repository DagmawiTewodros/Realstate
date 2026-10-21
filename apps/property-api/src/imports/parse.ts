import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { AppError, MB } from "@platform/nest-common";

export const IMPORT_MAX_BYTES = 5 * MB;

export interface ParsedSheet {
  columns: string[];
  rows: Array<Record<string, string>>;
}

const isXlsx = (buf: Buffer) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

/** Reads a CSV or XLSX file into rows keyed by column name (first row = headers). Max 5,000 rows. */
export async function parseSheet(file: { buffer: Buffer; size: number; originalname?: string } | undefined): Promise<ParsedSheet> {
  if (!file || !file.buffer?.length) throw new AppError(400, "FILE_REQUIRED", "Choose a CSV or Excel file");
  if (file.size > IMPORT_MAX_BYTES) throw new AppError(413, "FILE_TOO_LARGE", "The file is larger than 5 MB");
  let table: string[][];
  if (isXlsx(file.buffer)) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new AppError(400, "INVALID_FILE", "The Excel file could not be read");
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new AppError(400, "INVALID_FILE", "The Excel file has no sheets");
    table = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as unknown[]).slice(1).map(cellText);
      table.push(values);
    });
  } else {
    const name = (file.originalname ?? "").toLowerCase();
    const text = file.buffer.toString("utf8").replace(/^\uFEFF/, "");
    if (!name.endsWith(".csv") && !name.endsWith(".txt") && looksBinary(file.buffer)) {
      throw new AppError(400, "INVALID_FILE_TYPE", "Upload a .csv or .xlsx file");
    }
    try {
      table = parse(text, { relax_column_count: true, skip_empty_lines: true, trim: true }) as string[][];
    } catch {
      throw new AppError(400, "INVALID_FILE", "The CSV file could not be read");
    }
  }
  if (table.length < 2) throw new AppError(400, "EMPTY_FILE", "The file needs a header row and at least one data row");
  if (table.length > 5001) throw new AppError(400, "TOO_MANY_ROWS", "Import at most 5,000 rows at a time");
  const columns = table[0].map((c, i) => (c ?? "").toString().trim() || `Column ${i + 1}`);
  const rows = table.slice(1).map((values) => {
    const row: Record<string, string> = {};
    columns.forEach((col, i) => (row[col] = (values[i] ?? "").toString().trim()));
    return row;
  });
  return { columns, rows: rows.filter((r) => Object.values(r).some((v) => v !== "")) };
}

/** True when the first bytes contain control characters that never appear in a text file. */
function looksBinary(buf: Buffer): boolean {
  for (const byte of buf.subarray(0, 2000)) if (byte <= 0x08 || (byte >= 0x0e && byte <= 0x1f)) return true;
  return false;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as { text?: string; result?: unknown; richText?: Array<{ text: string }>; hyperlink?: string };
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return cellText(v.result);
    return "";
  }
  return String(value);
}
