import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { formatDate, formatDateTime, formatMoney, siteSettingsSchema, type Locale } from "@platform/shared";
import { APP_CONFIG, DB, SettingsService, createPdf, notFound, pdfToBuffer, writeText, type BaseConfig, type Database } from "@platform/nest-common";
import { customers, leases, payments, units, landlords, type StatementFigures } from "../db/schema";

const L = {
  receipt: { en: "Rent receipt", am: "የኪራይ ደረሰኝ" },
  number: { en: "Receipt number", am: "የደረሰኝ ቁጥር" },
  date: { en: "Date paid", am: "የተከፈለበት ቀን" },
  tenant: { en: "Tenant", am: "ተከራይ" },
  unit: { en: "Unit", am: "ቤት" },
  amount: { en: "Amount", am: "መጠን" },
  method: { en: "Method", am: "የክፍያ ዘዴ" },
  reference: { en: "Reference", am: "ማጣቀሻ" },
  voided: { en: "VOIDED", am: "ተሰርዟል" },
  thanks: { en: "Thank you.", am: "እናመሰግናለን።" },
  statement: { en: "Owner statement", am: "የባለቤት መግለጫ" },
  month: { en: "Month", am: "ወር" },
  owner: { en: "Owner", am: "ባለቤት" },
  charged: { en: "Rent charged", am: "የተጠየቀ ኪራይ" },
  received: { en: "Rent received", am: "የተቀበለ ኪራይ" },
  arrears: { en: "Outstanding arrears", am: "ያልተከፈለ ውዝፍ" },
  maintenance: { en: "Maintenance paid by owner", am: "በባለቤቱ የተከፈለ ጥገና" },
  net: { en: "Net amount", am: "የተጣራ መጠን" },
  issued: { en: "Issued", am: "የተሰጠበት" },
  version: { en: "Version", am: "እትም" },
} as const;

const METHOD: Record<string, Record<Locale, string>> = {
  CASH: { en: "Cash", am: "ጥሬ ገንዘብ" },
  BANK_TRANSFER: { en: "Bank transfer", am: "የባንክ ዝውውር" },
  TELEBIRR: { en: "Telebirr", am: "ቴሌብር" },
  OTHER: { en: "Other", am: "ሌላ" },
};

/** Receipt and statement PDFs in the customer's or owner's language, with dates in both calendars. */
@Injectable()
export class ReceiptsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
    private readonly settings: SettingsService,
  ) {}

  private async companyName(locale: Locale): Promise<string> {
    const site = await this.settings.get("site", siteSettingsSchema);
    return site.companyName[locale] || site.companyName.en || this.config.COMPANY_NAME;
  }

  async receiptPdf(paymentId: string, localeOverride?: Locale): Promise<{ filename: string; body: Buffer }> {
    const [row] = await this.db
      .select({ payment: payments, tenant: { name: customers.name, locale: customers.locale }, unit: { code: units.code } })
      .from(payments)
      .innerJoin(leases, eq(leases.id, payments.leaseId))
      .innerJoin(customers, eq(customers.id, leases.tenantId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(eq(payments.id, paymentId));
    if (!row) throw notFound("PAYMENT_NOT_FOUND");
    const locale: Locale = localeOverride ?? (row.tenant.locale === "en" ? "en" : "am");
    const p = row.payment;
    const doc = createPdf(`${L.receipt[locale]} ${p.receiptNumber}`);
    writeText(doc, await this.companyName(locale), { size: 18, bold: true });
    doc.moveDown(0.5);
    writeText(doc, L.receipt[locale], { size: 14, bold: true });
    if (p.status === "VOIDED") {
      doc.fillColor("#b00020");
      writeText(doc, `${L.voided[locale]}: ${p.voidReason ?? ""}`, { size: 14, bold: true });
      doc.fillColor("#000000");
    }
    doc.moveDown();
    const lines: Array<[string, string]> = [
      [L.number[locale], p.receiptNumber],
      [L.date[locale], formatDate(p.paidAt, locale)],
      [L.tenant[locale], row.tenant.name],
      [L.unit[locale], row.unit.code],
      [L.amount[locale], formatMoney(p.amountMinor, locale)],
      [L.method[locale], METHOD[p.method]?.[locale] ?? p.method],
    ];
    if (p.reference) lines.push([L.reference[locale], p.reference]);
    for (const [label, value] of lines) writeText(doc, `${label}: ${value}`, { size: 12 });
    doc.moveDown();
    writeText(doc, L.thanks[locale]);
    return { filename: `${p.receiptNumber}.pdf`, body: await pdfToBuffer(doc) };
  }

  async statementPdf(input: { landlordId: string; figures: StatementFigures; issuedAt: Date; version: number }): Promise<{ filename: string; body: Buffer }> {
    const [owner] = await this.db.select().from(landlords).where(eq(landlords.id, input.landlordId));
    if (!owner) throw notFound("LANDLORD_NOT_FOUND");
    // Owners have no language field; statements follow the company's main language (Amharic) with English labels as fallback.
    const locale: Locale = "am";
    const f = input.figures;
    const doc = createPdf(`${L.statement[locale]} ${f.month}`);
    writeText(doc, await this.companyName(locale), { size: 18, bold: true });
    doc.moveDown(0.5);
    writeText(doc, `${L.statement[locale]} / ${L.statement.en}`, { size: 14, bold: true });
    writeText(doc, `${L.owner[locale]}: ${owner.name}`);
    writeText(doc, `${L.month[locale]}: ${f.month}`);
    writeText(doc, `${L.issued[locale]}: ${formatDateTime(input.issuedAt, locale)}  ${L.version[locale]} ${input.version}`);
    doc.moveDown();
    const totals: Array<[keyof typeof L, number]> = [
      ["charged", f.rentChargedMinor],
      ["received", f.rentReceivedMinor],
      ["arrears", f.arrearsMinor],
      ["maintenance", f.maintenanceCostMinor],
      ["net", f.netMinor],
    ];
    for (const [key, value] of totals) writeText(doc, `${L[key][locale]} (${L[key].en}): ${formatMoney(value, locale)}`, { size: 12, bold: key === "net" });
    doc.moveDown();
    for (const l of f.leases) {
      writeText(doc, `${l.unitCode} · ${l.tenantName}: ${formatMoney(l.chargedMinor, locale)} / ${formatMoney(l.receivedMinor, locale)} / ${formatMoney(l.arrearsMinor, locale)}`, { size: 10 });
    }
    if (f.maintenance.length) doc.moveDown();
    for (const m of f.maintenance) writeText(doc, `${m.unitCode} · ${m.title}: ${formatMoney(m.costMinor, locale)}`, { size: 10 });
    return { filename: `statement-${f.month}.pdf`, body: await pdfToBuffer(doc) };
  }
}
