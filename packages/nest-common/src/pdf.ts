import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";

const FONT_DIR = join(__dirname, "..", "fonts");
const ETHIOPIC_FONT = join(FONT_DIR, "NotoSansEthiopic-Regular.ttf");

/** Ge'ez script ranges: Ethiopic, Ethiopic Supplement, Ethiopic Extended, Ethiopic Extended-A. */
const ETHIOPIC = /[ሀ-᎟ⶀ-⷟꬀-꬯]/;

export type Pdf = InstanceType<typeof PDFDocument>;

export function createPdf(title: string): Pdf {
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: title } });
  if (existsSync(ETHIOPIC_FONT)) doc.registerFont("Ethiopic", ETHIOPIC_FONT);
  doc.font("Helvetica");
  return doc;
}

/** Splits text into runs of Ge'ez script and other characters, so each run can use a font that has its glyphs. */
export function scriptRuns(text: string): Array<{ text: string; ethiopic: boolean }> {
  const runs: Array<{ text: string; ethiopic: boolean }> = [];
  for (const ch of text) {
    const ethiopic = ETHIOPIC.test(ch);
    const last = runs[runs.length - 1];
    // Spaces and punctuation stay in the current run.
    if (last && (last.ethiopic === ethiopic || /[\s.,:;()/-]/.test(ch))) last.text += ch;
    else runs.push({ text: ch, ethiopic });
  }
  return runs;
}

/** Writes a line that may mix Amharic and Latin text. */
export function writeText(doc: Pdf, text: string, options: { size?: number; bold?: boolean; align?: "left" | "right" | "center" } = {}): void {
  const runs = scriptRuns(text);
  doc.fontSize(options.size ?? 11);
  runs.forEach((run, i) => {
    const latin = options.bold ? "Helvetica-Bold" : "Helvetica";
    doc.font(run.ethiopic && existsSync(ETHIOPIC_FONT) ? "Ethiopic" : latin);
    doc.text(run.text, { continued: i < runs.length - 1, align: options.align });
  });
  if (runs.length === 0) doc.text("");
}

export function pdfToBuffer(doc: Pdf): Promise<Buffer> {
  return new Promise((resolveBuffer, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
