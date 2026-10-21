import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { formatDate, formatMoney } from "@platform/shared";
import { APP_CONFIG, AuditService, CLOCK, DB, conflict, createPdf, notFound, pdfToBuffer, writeText, type AuthUser, type BaseConfig, type Clock, type Database } from "@platform/nest-common";
import { gymPayments, members, memberships, plans } from "../db/schema";

const LABELS = {
  en: { title: "Payment receipt", number: "Receipt number", member: "Member", plan: "Plan", period: "Period", amount: "Amount", method: "Method", reference: "Reference", date: "Date", voided: "VOID" },
  am: { title: "የክፍያ ደረሰኝ", number: "የደረሰኝ ቁጥር", member: "አባል", plan: "እቅድ", period: "ጊዜ", amount: "መጠን", method: "የክፍያ ዘዴ", reference: "ማጣቀሻ", date: "ቀን", voided: "ተሰርዟል" },
} as const;

const METHOD_LABELS = {
  en: { CASH: "Cash", BANK_TRANSFER: "Bank transfer", TELEBIRR: "Telebirr", OTHER: "Other" },
  am: { CASH: "ጥሬ ገንዘብ", BANK_TRANSFER: "የባንክ ዝውውር", TELEBIRR: "ቴሌብር", OTHER: "ሌላ" },
} as const;

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
    private readonly audit: AuditService,
  ) {}

  async get(id: string) {
    const [row] = await this.db.select().from(gymPayments).where(eq(gymPayments.id, id)).limit(1);
    if (!row) throw notFound("PAYMENT_NOT_FOUND", "Payment not found");
    return row;
  }

  /** Voids a payment. Payments are never deleted. */
  async void(user: AuthUser, id: string, reason: string) {
    const payment = await this.get(id);
    if (payment.status === "VOIDED") throw conflict("ALREADY_VOIDED", "This payment is already void");
    const [row] = await this.db
      .update(gymPayments)
      .set({ status: "VOIDED", voidReason: reason, voidedAt: this.clock.now(), voidedById: user.id })
      .where(eq(gymPayments.id, id))
      .returning();
    await this.audit.log({ userId: user.id, action: "payment.voided", entityType: "payment", entityId: id, metadata: { reason, amountMinor: payment.amountMinor } });
    return row;
  }

  /** Receipt PDF in the member's language, dates in both calendars. */
  async receiptPdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const payment = await this.get(id);
    const [member] = await this.db.select().from(members).where(eq(members.id, payment.memberId));
    const [ms] = payment.membershipId
      ? await this.db
          .select({ startDate: memberships.startDate, endDate: memberships.endDate, planName: plans.name })
          .from(memberships)
          .innerJoin(plans, eq(plans.id, memberships.planId))
          .where(eq(memberships.id, payment.membershipId))
      : [];
    const locale = member?.locale === "en" ? "en" : "am";
    const l = LABELS[locale];
    const doc = createPdf(`${l.title} ${payment.receiptNumber}`);
    writeText(doc, this.config.COMPANY_NAME, { size: 18, bold: true });
    writeText(doc, l.title, { size: 14 });
    doc.moveDown();
    if (payment.status === "VOIDED") {
      writeText(doc, `${l.voided}: ${payment.voidReason ?? ""}`, { size: 16, bold: true });
      doc.moveDown();
    }
    writeText(doc, `${l.number}: ${payment.receiptNumber}`);
    writeText(doc, `${l.date}: ${formatDate(payment.paidAt, locale)}`);
    writeText(doc, `${l.member}: ${member?.name ?? "-"}`);
    if (ms) {
      writeText(doc, `${l.plan}: ${ms.planName}`);
      writeText(doc, `${l.period}: ${formatDate(ms.startDate, locale)} - ${formatDate(ms.endDate, locale)}`);
    }
    writeText(doc, `${l.amount}: ${formatMoney(payment.amountMinor, locale)}`, { bold: true });
    writeText(doc, `${l.method}: ${METHOD_LABELS[locale][payment.method as keyof (typeof METHOD_LABELS)["en"]] ?? payment.method}`);
    if (payment.reference) writeText(doc, `${l.reference}: ${payment.reference}`);
    return { buffer: await pdfToBuffer(doc), filename: `${payment.receiptNumber}.pdf` };
  }
}
