import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { asc, count, eq } from "drizzle-orm";
import type { z } from "zod";
import { landlordCreateSchema, landlordUpdateSchema } from "@platform/shared";
import { AuditService, CurrentUser, DB, Roles, notFound, zod, type AuthUser, type Database } from "@platform/nest-common";
import { landlords, units } from "../db/schema";
import { RENTALS, RENTALS_READ } from "../access";

@Controller("landlords")
export class LandlordsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(...RENTALS_READ)
  async list() {
    const rows = await this.db
      .select({ landlord: landlords, unitCount: count(units.id) })
      .from(landlords)
      .leftJoin(units, eq(units.landlordId, landlords.id))
      .groupBy(landlords.id)
      .orderBy(asc(landlords.name));
    return { items: rows.map((r) => ({ ...r.landlord, unitCount: Number(r.unitCount) })) };
  }

  @Post()
  @Roles(...RENTALS)
  async create(@CurrentUser() user: AuthUser, @Body(zod(landlordCreateSchema)) body: z.infer<typeof landlordCreateSchema>) {
    const [row] = await this.db.insert(landlords).values(body).returning();
    await this.audit.log({ userId: user.id, action: "landlord.created", entityType: "landlord", entityId: row.id });
    return { landlord: row };
  }

  @Get(":id")
  @Roles(...RENTALS_READ)
  async get(@Param("id", ParseUUIDPipe) id: string) {
    const [row] = await this.db.select().from(landlords).where(eq(landlords.id, id));
    if (!row) throw notFound("LANDLORD_NOT_FOUND");
    const landlordUnits = await this.db.select({ id: units.id, code: units.code, status: units.status }).from(units).where(eq(units.landlordId, id));
    return { landlord: row, units: landlordUnits };
  }

  @Patch(":id")
  @Roles(...RENTALS)
  async update(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(landlordUpdateSchema)) body: z.infer<typeof landlordUpdateSchema>) {
    const [row] = await this.db
      .update(landlords)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(landlords.id, id))
      .returning();
    if (!row) throw notFound("LANDLORD_NOT_FOUND");
    await this.audit.log({ userId: user.id, action: "landlord.updated", entityType: "landlord", entityId: id });
    return { landlord: row };
  }
}
