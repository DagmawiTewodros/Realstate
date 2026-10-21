import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import type { z } from "zod";
import { activityCreateSchema, leadAssignSchema, leadCreateSchema, leadListQuerySchema, leadStatusSchema, leadUpdateSchema, paginationSchema } from "@platform/shared";
import { CurrentUser, Roles, zod, type AuthUser } from "@platform/nest-common";
import { SALES, SALES_MANAGERS } from "../access";
import { LeadsService } from "./leads.service";

const listQuery = leadListQuerySchema.merge(paginationSchema);

@Controller("leads")
@Roles(...SALES)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.leads.list(user, q, q);
  }

  @Get("overdue")
  overdue(@CurrentUser() user: AuthUser) {
    return this.leads.overdue(user);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(zod(leadCreateSchema)) body: z.infer<typeof leadCreateSchema>) {
    return { lead: await this.leads.create(user, body) };
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.leads.detail(user, id);
  }

  @Patch(":id")
  async update(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(leadUpdateSchema)) body: z.infer<typeof leadUpdateSchema>) {
    return { lead: await this.leads.update(user, id, body) };
  }

  @Post(":id/assign")
  @Roles(...SALES_MANAGERS)
  async assign(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(leadAssignSchema)) body: z.infer<typeof leadAssignSchema>) {
    return { lead: await this.leads.assign(user, id, body.assignedToId) };
  }

  @Post(":id/status")
  async status(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(leadStatusSchema)) body: z.infer<typeof leadStatusSchema>) {
    return { lead: await this.leads.changeStatus(user, id, body.status, body.lostReason) };
  }

  @Post(":id/activities")
  async activity(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(activityCreateSchema)) body: z.infer<typeof activityCreateSchema>) {
    return { activity: await this.leads.addActivity(user, id, body) };
  }
}
