import type { Response } from "express";

/** CSV with a UTF-8 byte order mark, so spreadsheets open Amharic text correctly. */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const escape = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map((r) => r.map(escape).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`);
  res.send(csv);
}
