import { z } from "zod";
import { baseConfigSchema, ConfigError, loadConfig } from "./config";
import { renderTemplate, TemplateError, templatePlaceholders, type TemplateSet } from "./templates";
import { backoffMs, MAX_ATTEMPTS, signWebhook, verifyWebhook } from "./outbox";
import { detectFileKind, validateUpload } from "./uploads";
import { toCsv } from "./csv";
import { formatReceiptNumber } from "./counters";
import { RateLimiter } from "./rate-limit";
import { createPdf, pdfToBuffer, scriptRuns, writeText } from "./pdf";

const env = {
  PORT: "4000",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  SESSION_SECRET: "x".repeat(40),
  PUBLIC_WEB_URL: "http://localhost:3000",
  WEBHOOK_SIGNING_SECRET: "w".repeat(20),
  INTERNAL_API_SECRET: "i".repeat(20),
};

describe("config", () => {
  it("accepts a complete environment", () => {
    expect(loadConfig(baseConfigSchema, env).PORT).toBe(4000);
  });
  it("refuses to start with a clear message when a variable is missing", () => {
    const { DATABASE_URL: _omit, ...missing } = env;
    expect(() => loadConfig(baseConfigSchema, missing)).toThrow(ConfigError);
    expect(() => loadConfig(baseConfigSchema, missing)).toThrow(/DATABASE_URL/);
  });
  it("requires the n8n URL in n8n mode", () => {
    expect(() => loadConfig(baseConfigSchema, { ...env, AUTOMATION_MODE: "n8n" })).toThrow(/N8N_WEBHOOK_URL/);
  });
  it("extends per app", () => {
    const schema = baseConfigSchema.extend({ EXTRA: z.string() });
    expect(() => loadConfig(schema, env)).toThrow(/EXTRA/);
  });
});

describe("templates", () => {
  const t: TemplateSet = {
    hello: { am: { subject: "ሰላም {{name}}", text: "{{unit}}" }, en: { subject: "Hello {{name}}", text: "Unit {{unit}}" } },
  };
  it("fills placeholders in the right language", () => {
    expect(renderTemplate(t, "hello", "en", { name: "Abebe", unit: "A-1" })).toEqual({ subject: "Hello Abebe", text: "Unit A-1" });
    expect(renderTemplate(t, "hello", "am", { name: "Abebe", unit: "A-1" }).subject).toBe("ሰላም Abebe");
  });
  it("fails loudly on a missing value or template", () => {
    expect(() => renderTemplate(t, "hello", "en", { name: "A" })).toThrow(TemplateError);
    expect(() => renderTemplate(t, "nope", "en", {})).toThrow(TemplateError);
    expect(templatePlaceholders(t, "hello").sort()).toEqual(["name", "unit"]);
  });
});

describe("webhooks", () => {
  it("signs and verifies, and rejects tampering and old timestamps", () => {
    const ts = String(Date.now());
    const body = JSON.stringify({ a: 1 });
    const sig = signWebhook("secret-secret-123", ts, body);
    expect(verifyWebhook("secret-secret-123", ts, body, sig)).toBe(true);
    expect(verifyWebhook("secret-secret-123", ts, body.replace("1", "2"), sig)).toBe(false);
    expect(verifyWebhook("other-secret-xxxx", ts, body, sig)).toBe(false);
    expect(verifyWebhook("secret-secret-123", String(Date.now() - 10 * 60_000), body, signWebhook("secret-secret-123", String(Date.now() - 10 * 60_000), body))).toBe(false);
  });
  it("backs off exponentially with a cap", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(30)).toBe(6 * 60 * 60 * 1000);
    expect(MAX_ATTEMPTS).toBe(8);
  });
});

describe("uploads", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const pdf = Buffer.from("%PDF-1.7 rest");
  it("detects real file types from content", () => {
    expect(detectFileKind(jpeg)).toBe("jpeg");
    expect(detectFileKind(pdf)).toBe("pdf");
    expect(detectFileKind(Buffer.from("GIF89a"))).toBeNull();
  });
  it("rejects wrong types and oversized files", () => {
    expect(validateUpload({ buffer: jpeg, size: jpeg.length }, ["jpeg"], 100)).toBe("jpeg");
    expect(() => validateUpload({ buffer: pdf, size: pdf.length }, ["jpeg", "png"], 100)).toThrow(/Allowed types/);
    expect(() => validateUpload({ buffer: jpeg, size: 101 }, ["jpeg"], 100)).toThrow(/larger/);
    expect(() => validateUpload(undefined, ["jpeg"], 100)).toThrow(/Choose a file/);
  });
});

describe("csv", () => {
  it("adds a BOM, escapes values and neutralizes formulas", () => {
    const csv = toCsv(["Name", "Note"], [["ሰላም", 'He said "hi", ok'], ["=SUM(A1)", null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"He said ""hi"", ok"');
    expect(csv).toContain('"=SUM(A1)"');
  });
});

describe("misc", () => {
  it("formats receipt numbers", () => {
    expect(formatReceiptNumber("R", 2026, 42)).toBe("R-2026-000042");
  });
  it("rate limits within a window", () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 5; i += 1) expect(rl.consume("k", 5, 60_000, 1000 + i)).toBe(true);
    expect(rl.consume("k", 5, 60_000, 1010)).toBe(false);
    expect(rl.consume("k", 5, 60_000, 70_000)).toBe(true);
  });
  it("splits mixed Amharic and Latin text into runs", () => {
    expect(scriptRuns("ጥቅምት 12 2019 (22 Oct)")).toEqual([
      { text: "ጥቅምት ", ethiopic: true },
      { text: "12 2019 (22 Oct)", ethiopic: false },
    ]);
  });
  it("renders a PDF with Amharic text", async () => {
    const doc = createPdf("Test");
    writeText(doc, "ደረሰኝ Receipt ጥቅምት 12 2019 ዓ.ም.", { size: 14 });
    const buf = await pdfToBuffer(doc);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.toString("latin1")).toContain("NotoSansEthiopic");
  });
});
