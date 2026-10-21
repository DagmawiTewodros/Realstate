import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  UNIT_PURPOSES,
  UNIT_STATUSES,
  UNIT_TYPES,
  CLOSED_LEAD_STATUSES,
  normalizePhone,
  parseBirrToMinor,
} from "@platform/shared";
import { AppError, AuditService, DB, SettingsService, type AuthUser, type Database, type Executor } from "@platform/nest-common";
import { buildings, customers, leads, projects, units, users } from "../db/schema";
import type { ParsedSheet } from "./parse";

export const IMPORT_KINDS = ["units", "customers", "leads"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** The fields each import understands; `required` fields must be mapped. */
export const IMPORT_FIELDS: Record<ImportKind, Array<{ field: string; required: boolean; aliases: string[] }>> = {
  units: [
    { field: "project", required: true, aliases: ["project", "project name", "site"] },
    { field: "area", required: false, aliases: ["area", "location", "neighbourhood", "neighborhood", "sub city", "subcity"] },
    { field: "building", required: false, aliases: ["building", "block"] },
    { field: "code", required: true, aliases: ["code", "unit", "unit code", "unit no", "unit number"] },
    { field: "type", required: true, aliases: ["type", "unit type", "property type"] },
    { field: "purpose", required: true, aliases: ["purpose", "sale or rent", "for"] },
    { field: "bedrooms", required: false, aliases: ["bedrooms", "beds", "rooms"] },
    { field: "areaSqm", required: false, aliases: ["size", "sqm", "area sqm", "m2", "size m2"] },
    { field: "floor", required: false, aliases: ["floor"] },
    { field: "price", required: true, aliases: ["price", "price etb", "price (etb)", "rent", "amount"] },
    { field: "status", required: false, aliases: ["status"] },
    { field: "description", required: false, aliases: ["description", "notes", "details"] },
  ],
  customers: [
    { field: "name", required: true, aliases: ["name", "full name", "customer", "customer name"] },
    { field: "phone", required: false, aliases: ["phone", "mobile", "phone number", "tel"] },
    { field: "email", required: false, aliases: ["email", "e-mail"] },
    { field: "locale", required: false, aliases: ["language", "locale", "lang"] },
    { field: "source", required: false, aliases: ["source", "channel"] },
  ],
  leads: [
    { field: "name", required: true, aliases: ["name", "customer", "customer name", "full name"] },
    { field: "phone", required: false, aliases: ["phone", "mobile", "phone number", "tel"] },
    { field: "email", required: false, aliases: ["email", "e-mail"] },
    { field: "source", required: false, aliases: ["source", "channel"] },
    { field: "status", required: false, aliases: ["status", "stage"] },
    { field: "note", required: false, aliases: ["note", "notes", "interest", "interested in", "unit"] },
    { field: "brokerEmail", required: false, aliases: ["broker", "broker email", "assigned to", "agent"] },
  ],
};

export type Mapping = Record<string, string>;
export interface RowResult {
  row: number;
  outcome: "created" | "updated" | "skipped" | "error";
  reason?: string;
  warning?: string;
  key?: string;
}

const mappingSchema = z.record(z.string(), z.string());

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, " ");

function enumValue<T extends readonly string[]>(values: T, input: string): T[number] | null {
  const upper = input.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (values as readonly string[]).includes(upper) ? (upper as T[number]) : null;
}

@Injectable()
export class ImportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Suggests a column for each field: the saved mapping first, then matching names. */
  async suggestMapping(kind: ImportKind, columns: string[]): Promise<Mapping> {
    const saved = await this.settings.get(`import-mapping:${kind}`, mappingSchema.default({}));
    const mapping: Mapping = {};
    for (const f of IMPORT_FIELDS[kind]) {
      if (saved[f.field] && columns.includes(saved[f.field])) mapping[f.field] = saved[f.field];
      else {
        const hit = columns.find((c) => f.aliases.includes(norm(c)) || norm(c) === norm(f.field));
        if (hit) mapping[f.field] = hit;
      }
    }
    return mapping;
  }

  validateMapping(kind: ImportKind, columns: string[], mapping: Mapping): void {
    const missing = IMPORT_FIELDS[kind].filter((f) => f.required && !mapping[f.field]).map((f) => f.field);
    if (missing.length) throw new AppError(400, "MAPPING_INCOMPLETE", `Map these fields: ${missing.join(", ")}`, { missing });
    const unknown = Object.values(mapping).filter((c) => c && !columns.includes(c));
    if (unknown.length) throw new AppError(400, "MAPPING_UNKNOWN_COLUMN", `Columns not in the file: ${unknown.join(", ")}`);
  }

  /**
   * Runs an import. In a dry run every row is checked inside a transaction that is always rolled back,
   * so nothing changes. A commit applies only the valid rows and never deletes anything.
   */
  async run(user: AuthUser, kind: ImportKind, sheet: ParsedSheet, mapping: Mapping, commit: boolean) {
    this.validateMapping(kind, sheet.columns, mapping);
    const results: RowResult[] = [];
    const rollback = new Error("dry-run rollback");
    try {
      await this.db.transaction(async (raw) => {
        const tx = raw as unknown as Executor;
        for (const [i, source] of sheet.rows.entries()) {
          const row = Object.fromEntries(Object.entries(mapping).map(([field, col]) => [field, (source[col] ?? "").trim()]));
          // Each row in its own savepoint, so one bad row never undoes the good ones.
          try {
            const result = await raw.transaction(async (sp) => this.applyRow(kind, row, sp as unknown as Executor, user));
            results.push({ row: i + 2, ...result });
          } catch (e) {
            results.push({ row: i + 2, outcome: "error", reason: e instanceof AppError ? String((e.getResponse() as { message?: string }).message) : e instanceof Error ? e.message : String(e) });
          }
        }
        if (!commit) throw rollback;
        await this.audit.log({ userId: user.id, action: `import.${kind}`, entityType: "import", metadata: summarize(results) }, tx);
      });
    } catch (e) {
      if (e !== rollback) throw e;
    }
    if (commit) await this.settings.set(`import-mapping:${kind}`, mappingSchema, mapping, user.id);
    return { commit, summary: summarize(results), results };
  }

  private async applyRow(kind: ImportKind, row: Record<string, string>, tx: Executor, user: AuthUser): Promise<Omit<RowResult, "row">> {
    switch (kind) {
      case "units":
        return this.unitRow(row, tx);
      case "customers":
        return this.customerRow(row, tx, user);
      case "leads":
        return this.leadRow(row, tx, user);
    }
  }

  private async unitRow(row: Record<string, string>, tx: Executor): Promise<Omit<RowResult, "row">> {
    if (!row.project) throw new Error("Project is empty");
    if (!row.code) throw new Error("Unit code is empty");
    const type = enumValue(UNIT_TYPES, row.type ?? "");
    if (!type) throw new Error(`Unknown type "${row.type}" (use ${UNIT_TYPES.join(", ")})`);
    const purpose = enumValue(UNIT_PURPOSES, row.purpose ?? "");
    if (!purpose) throw new Error(`Unknown purpose "${row.purpose}" (use SALE or RENT)`);
    const priceMinor = parseBirrToMinor(row.price ?? "");
    if (priceMinor === null || priceMinor < 0) throw new Error(`Price "${row.price}" is not a number`);
    const status = row.status ? enumValue(UNIT_STATUSES, row.status) : null;
    if (row.status && !status) throw new Error(`Unknown status "${row.status}"`);
    const int = (v: string | undefined, label: string) => {
      if (!v) return null;
      if (!/^-?\d+$/.test(v)) throw new Error(`${label} "${v}" is not a whole number`);
      return Number(v);
    };
    const areaSqm = row.areaSqm ? Number(row.areaSqm.replace(",", ".")) : null;
    if (areaSqm !== null && !(areaSqm > 0)) throw new Error(`Size "${row.areaSqm}" is not a number`);

    let [project] = await tx.select().from(projects).where(sql`lower(${projects.name}) = ${row.project.toLowerCase()}`).limit(1);
    if (!project) [project] = await tx.insert(projects).values({ name: row.project, area: row.area || row.project }).returning();
    let buildingId: string | null = null;
    if (row.building) {
      let [b] = await tx.select().from(buildings).where(and(eq(buildings.projectId, project.id), sql`lower(${buildings.name}) = ${row.building.toLowerCase()}`)).limit(1);
      if (!b) [b] = await tx.insert(buildings).values({ projectId: project.id, name: row.building }).returning();
      buildingId = b.id;
    }
    const values = {
      buildingId,
      type,
      purpose,
      bedrooms: int(row.bedrooms, "Bedrooms"),
      floor: int(row.floor, "Floor"),
      areaSqm,
      priceMinor,
      description: row.description || null,
    };
    const [existing] = await tx.select().from(units).where(and(eq(units.projectId, project.id), eq(units.code, row.code))).limit(1);
    if (existing) {
      await tx.update(units).set({ ...values, updatedAt: new Date() }).where(eq(units.id, existing.id));
      return { outcome: "updated", key: `${project.name}/${row.code}` };
    }
    await tx.insert(units).values({ ...values, projectId: project.id, code: row.code, status: status ?? "AVAILABLE" });
    return { outcome: "created", key: `${project.name}/${row.code}` };
  }

  private async findCustomer(tx: Executor, phone: string | null, email: string | null) {
    if (phone) {
      const [c] = await tx.select().from(customers).where(and(eq(customers.phone, phone), isNull(customers.anonymizedAt))).limit(1);
      if (c) return c;
    }
    if (email) {
      const [c] = await tx.select().from(customers).where(and(sql`lower(${customers.email}) = ${email.toLowerCase()}`, isNull(customers.anonymizedAt))).limit(1);
      if (c) return c;
    }
    return null;
  }

  private contactFields(row: Record<string, string>) {
    const phone = row.phone ? normalizePhone(row.phone) : null;
    if (row.phone && !phone) throw new Error(`Phone "${row.phone}" is not valid`);
    const email = row.email ? row.email.toLowerCase() : null;
    if (email && !z.string().email().safeParse(email).success) throw new Error(`Email "${row.email}" is not valid`);
    if (!phone && !email) throw new Error("Give a phone or an email");
    if (!row.name) throw new Error("Name is empty");
    const locale = /^(en|english)$/i.test(row.locale ?? "") ? "en" : "am";
    const source = enumValue(LEAD_SOURCES, row.source ?? "") ?? "IMPORT";
    return { phone, email, locale, source };
  }

  private async customerRow(row: Record<string, string>, tx: Executor, user: AuthUser): Promise<Omit<RowResult, "row">> {
    const { phone, email, locale, source } = this.contactFields(row);
    const existing = await this.findCustomer(tx, phone, email);
    if (existing) {
      const warning = existing.phone && phone && existing.email && email && existing.email.toLowerCase() !== email ? "Same phone, different email: kept the existing email" : undefined;
      await tx
        .update(customers)
        .set({ name: row.name, phone: existing.phone ?? phone, email: existing.email ?? email, updatedAt: new Date() })
        .where(eq(customers.id, existing.id));
      return { outcome: "updated", key: phone ?? email ?? "", warning };
    }
    await tx.insert(customers).values({ name: row.name, phone, email, locale, source, createdById: user.id });
    return { outcome: "created", key: phone ?? email ?? "" };
  }

  private async leadRow(row: Record<string, string>, tx: Executor, user: AuthUser): Promise<Omit<RowResult, "row">> {
    const { phone, email, locale, source } = this.contactFields(row);
    const status = row.status ? enumValue(LEAD_STATUSES, row.status) : "INQUIRY";
    if (!status) throw new Error(`Unknown status "${row.status}"`);
    let assignedToId: string | null = null;
    if (row.brokerEmail) {
      const [b] = await tx.select().from(users).where(sql`lower(${users.email}) = ${row.brokerEmail.toLowerCase()}`).limit(1);
      if (!b || !["BROKER", "SALES_MANAGER"].includes(b.role)) throw new Error(`No broker with email "${row.brokerEmail}"`);
      assignedToId = b.id;
    }
    let customer = await this.findCustomer(tx, phone, email);
    if (!customer) [customer] = await tx.insert(customers).values({ name: row.name, phone, email, locale, source, createdById: user.id }).returning();
    // The same customer, source and note on an open lead is the same lead: update it instead of duplicating.
    const note = row.note || null;
    const [existing] = await tx
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.customerId, customer.id),
          eq(leads.source, source),
          note === null ? isNull(leads.interestedUnitNote) : eq(leads.interestedUnitNote, note),
          notInArray(leads.status, [...CLOSED_LEAD_STATUSES]),
        ),
      )
      .limit(1);
    if (existing) {
      await tx.update(leads).set({ status, assignedToId: assignedToId ?? existing.assignedToId, updatedAt: new Date() }).where(eq(leads.id, existing.id));
      return { outcome: "updated", key: phone ?? email ?? "" };
    }
    await tx.insert(leads).values({ customerId: customer.id, source, status, assignedToId, interestedUnitNote: note, createdById: user.id, closedAt: status === "SIGNED" || status === "LOST" ? new Date() : null, lostReason: status === "LOST" ? "Imported as lost" : null });
    return { outcome: "created", key: phone ?? email ?? "" };
  }
}

function summarize(results: RowResult[]) {
  const count = (o: RowResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  return { total: results.length, created: count("created"), updated: count("updated"), skipped: count("skipped"), errors: count("error") };
}
