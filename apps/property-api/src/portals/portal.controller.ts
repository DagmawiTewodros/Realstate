import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { and, asc, desc, eq, inArray, ne, notInArray } from "drizzle-orm";
import type { z } from "zod";
import { tenantMaintenanceSchema } from "@platform/shared";
import { AppError, CurrentUser, DB, Roles, notFound, zod, type AuthUser, type Database } from "@platform/nest-common";
import { customers, leases, maintenanceRequests, payments, rentCharges, units } from "../db/schema";
import { ROLE } from "../access";
import { StatementsService } from "./statements.service";
import { ReceiptsService } from "../rentals/receipts.service";
import { MAINTENANCE_PHOTO_MAX_BYTES, MaintenanceService } from "../rentals/maintenance.service";

/** The landlord id or tenant (customer) id behind a portal login. Every query below filters by it. */
function ownerId(user: AuthUser): string {
  if (!user.linkedEntityId) throw new AppError(403, "NO_LINKED_RECORD", "This login is not linked to a record");
  return user.linkedEntityId;
}

@Controller("portal")
export class PortalController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly statements: StatementsService,
    private readonly receipts: ReceiptsService,
    private readonly maintenance: MaintenanceService,
  ) {}

  // ---------- Landlord ----------
  @Get("landlord/overview")
  @Roles(ROLE.LANDLORD)
  async landlordOverview(@CurrentUser() user: AuthUser) {
    const landlordId = ownerId(user);
    const ownUnits = await this.db.select({ id: units.id, code: units.code, status: units.status, type: units.type }).from(units).where(eq(units.landlordId, landlordId)).orderBy(asc(units.code));
    const ownLeases = await this.db
      .select({ id: leases.id, unitCode: units.code, tenantName: customers.name, startDate: leases.startDate, endDate: leases.endDate, rentMinor: leases.rentMinor, status: leases.status })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .innerJoin(customers, eq(customers.id, leases.tenantId))
      .where(and(eq(leases.landlordId, landlordId), ne(leases.status, "DRAFT")))
      .orderBy(desc(leases.startDate));
    return { units: ownUnits, leases: ownLeases };
  }

  @Get("landlord/statements")
  @Roles(ROLE.LANDLORD)
  async landlordStatements(@CurrentUser() user: AuthUser) {
    return { items: await this.statements.listSaved(ownerId(user)) };
  }

  @Get("landlord/statements/:month")
  @Roles(ROLE.LANDLORD)
  landlordStatement(@CurrentUser() user: AuthUser, @Param("month") month: string) {
    return this.statements.get(ownerId(user), month, null);
  }

  @Get("landlord/statements/:month/pdf")
  @Roles(ROLE.LANDLORD)
  async landlordStatementPdf(@CurrentUser() user: AuthUser, @Param("month") month: string, @Res() res: Response) {
    const landlordId = ownerId(user);
    const s = await this.statements.get(landlordId, month, null);
    const pdf = await this.receipts.statementPdf({ landlordId, figures: s.figures, issuedAt: new Date(s.issuedAt), version: s.version });
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `inline; filename="${pdf.filename}"`);
    res.send(pdf.body);
  }

  @Get("landlord/maintenance")
  @Roles(ROLE.LANDLORD)
  async landlordMaintenance(@CurrentUser() user: AuthUser) {
    const ids = (await this.db.select({ id: units.id }).from(units).where(eq(units.landlordId, ownerId(user)))).map((u) => u.id);
    const { items } = await this.maintenance.list({ unitIds: ids });
    return { items: items.map((r) => ({ id: r.id, unit: r.unit, title: r.title, priority: r.priority, status: r.status, costMinor: r.costMinor, createdAt: r.createdAt, closedAt: r.closedAt })) };
  }

  // ---------- Tenant ----------
  private async tenantLeaseIds(user: AuthUser): Promise<string[]> {
    const rows = await this.db.select({ id: leases.id }).from(leases).where(and(eq(leases.tenantId, ownerId(user)), ne(leases.status, "DRAFT")));
    return rows.map((r) => r.id);
  }

  @Get("tenant/overview")
  @Roles(ROLE.TENANT)
  async tenantOverview(@CurrentUser() user: AuthUser) {
    const tenantId = ownerId(user);
    const ownLeases = await this.db
      .select({
        id: leases.id,
        unitId: units.id,
        unitCode: units.code,
        startDate: leases.startDate,
        endDate: leases.endDate,
        rentMinor: leases.rentMinor,
        billingFrequency: leases.billingFrequency,
        depositMinor: leases.depositMinor,
        status: leases.status,
        creditMinor: leases.creditMinor,
      })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(and(eq(leases.tenantId, tenantId), ne(leases.status, "DRAFT")))
      .orderBy(desc(leases.startDate));
    const leaseIds = ownLeases.map((l) => l.id);
    const charges = leaseIds.length
      ? await this.db
          .select({ id: rentCharges.id, leaseId: rentCharges.leaseId, dueDate: rentCharges.dueDate, amountMinor: rentCharges.amountMinor, paidMinor: rentCharges.paidMinor, status: rentCharges.status })
          .from(rentCharges)
          .where(and(inArray(rentCharges.leaseId, leaseIds), notInArray(rentCharges.status, ["PAID", "WAIVED"])))
          .orderBy(asc(rentCharges.dueDate))
          .limit(12)
      : [];
    const history = leaseIds.length
      ? await this.db
          .select({ id: payments.id, receiptNumber: payments.receiptNumber, amountMinor: payments.amountMinor, paidAt: payments.paidAt, method: payments.method, status: payments.status })
          .from(payments)
          .where(inArray(payments.leaseId, leaseIds))
          .orderBy(desc(payments.paidAt))
      : [];
    return { leases: ownLeases, upcomingCharges: charges, payments: history };
  }

  @Get("tenant/payments/:id/receipt.pdf")
  @Roles(ROLE.TENANT)
  async tenantReceipt(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const leaseIds = await this.tenantLeaseIds(user);
    const [p] = leaseIds.length ? await this.db.select({ id: payments.id }).from(payments).where(and(eq(payments.id, id), inArray(payments.leaseId, leaseIds))) : [];
    if (!p) throw notFound("PAYMENT_NOT_FOUND");
    const pdf = await this.receipts.receiptPdf(id, user.locale);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `inline; filename="${pdf.filename}"`);
    res.send(pdf.body);
  }

  @Get("tenant/maintenance")
  @Roles(ROLE.TENANT)
  async tenantMaintenance(@CurrentUser() user: AuthUser) {
    const rows = await this.db
      .select({ id: maintenanceRequests.id, title: maintenanceRequests.title, priority: maintenanceRequests.priority, status: maintenanceRequests.status, createdAt: maintenanceRequests.createdAt, closedAt: maintenanceRequests.closedAt })
      .from(maintenanceRequests)
      .where(eq(maintenanceRequests.reportedByCustomerId, ownerId(user)))
      .orderBy(desc(maintenanceRequests.createdAt));
    return { items: rows };
  }

  /** A tenant reports a repair for the unit of their current (active) lease. */
  @Post("tenant/maintenance")
  @Roles(ROLE.TENANT)
  async tenantReport(@CurrentUser() user: AuthUser, @Body(zod(tenantMaintenanceSchema)) body: z.infer<typeof tenantMaintenanceSchema>) {
    const tenantId = ownerId(user);
    const [lease] = await this.db.select().from(leases).where(and(eq(leases.tenantId, tenantId), eq(leases.status, "ACTIVE"))).orderBy(desc(leases.startDate)).limit(1);
    if (!lease) throw new AppError(409, "NO_ACTIVE_LEASE", "You need an active lease to report a repair");
    const request = await this.maintenance.create(user, { ...body, unitId: lease.unitId, leaseId: lease.id, reportedByCustomerId: tenantId });
    return { request: { id: request.id, title: request.title, status: request.status, priority: request.priority, createdAt: request.createdAt } };
  }

  @Post("tenant/maintenance/:id/photos")
  @Roles(ROLE.TENANT)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAINTENANCE_PHOTO_MAX_BYTES } }))
  async tenantPhoto(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    const [own] = await this.db.select({ id: maintenanceRequests.id }).from(maintenanceRequests).where(and(eq(maintenanceRequests.id, id), eq(maintenanceRequests.reportedByCustomerId, ownerId(user))));
    if (!own) throw notFound("REQUEST_NOT_FOUND");
    const photo = await this.maintenance.addPhoto(user, id, file);
    return { photo: { id: photo.id } };
  }
}
