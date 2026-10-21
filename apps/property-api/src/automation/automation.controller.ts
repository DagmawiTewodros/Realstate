import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { idSchema, savedSearchSchema, viewingCreateSchema, viewingUpdateSchema } from "@platform/shared";
import { AuditService, CurrentUser, DB, Roles, notFound, zod, type AuthUser, type Database } from "@platform/nest-common";
import { savedSearches } from "../db/schema";
import { ROLE, SALES } from "../access";
import { CustomersService } from "../customers/customers.service";
import { ViewingsService } from "./viewings.service";
import { ReminderScheduler } from "./scheduler";

const savedQuery = z.object({ customerId: idSchema });
const activeSchema = z.object({ isActive: z.boolean() });

@Controller()
export class AutomationController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly viewings: ViewingsService,
    private readonly customers: CustomersService,
    private readonly scheduler: ReminderScheduler,
    private readonly audit: AuditService,
  ) {}

  // ---------- Viewings ----------
  @Get("leads/:id/viewings")
  @Roles(...SALES)
  list(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.viewings.forLead(user, id);
  }

  @Post("leads/:id/viewings")
  @Roles(...SALES)
  async book(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(viewingCreateSchema)) body: z.infer<typeof viewingCreateSchema>) {
    return { viewing: await this.viewings.book(user, id, body) };
  }

  @Patch("viewings/:id")
  @Roles(...SALES)
  async update(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(viewingUpdateSchema)) body: z.infer<typeof viewingUpdateSchema>) {
    return { viewing: await this.viewings.update(user, id, body) };
  }

  // ---------- Saved searches ----------
  @Get("saved-searches")
  @Roles(...SALES)
  async savedList(@CurrentUser() user: AuthUser, @Query(zod(savedQuery)) q: z.infer<typeof savedQuery>) {
    await this.customers.get(user, q.customerId);
    return { items: await this.db.select().from(savedSearches).where(eq(savedSearches.customerId, q.customerId)).orderBy(desc(savedSearches.createdAt)) };
  }

  @Post("saved-searches")
  @Roles(...SALES)
  async savedCreate(@CurrentUser() user: AuthUser, @Body(zod(savedSearchSchema)) body: z.infer<typeof savedSearchSchema>) {
    await this.customers.get(user, body.customerId);
    const [row] = await this.db.insert(savedSearches).values({ ...body, createdById: user.id }).returning();
    await this.audit.log({ userId: user.id, action: "saved_search.created", entityType: "customer", entityId: body.customerId });
    return { savedSearch: row };
  }

  @Patch("saved-searches/:id")
  @Roles(...SALES)
  async savedUpdate(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(activeSchema)) body: z.infer<typeof activeSchema>) {
    const [current] = await this.db.select().from(savedSearches).where(eq(savedSearches.id, id));
    if (!current) throw notFound("SAVED_SEARCH_NOT_FOUND");
    await this.customers.get(user, current.customerId);
    const [row] = await this.db.update(savedSearches).set({ isActive: body.isActive }).where(and(eq(savedSearches.id, id))).returning();
    return { savedSearch: row };
  }

  // ---------- Manual run (owner) ----------
  @Post("automation/run")
  @Roles(ROLE.OWNER)
  @HttpCode(200)
  run() {
    return this.scheduler.run();
  }
}
