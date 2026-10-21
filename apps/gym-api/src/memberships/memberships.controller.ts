import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { freezeSchema, planCreateSchema, planUpdateSchema, reasonSchema, sellMembershipSchema } from "@platform/shared";
import { CurrentUser, Roles, zod, type AuthUser } from "@platform/nest-common";
import { DESK, MANAGERS } from "../access";
import { MembershipsService } from "./memberships.service";
import { PaymentsService } from "./payments.service";
import { MembersService } from "../members/members.service";

const plansQuery = z.object({ all: z.enum(["true", "false"]).default("false") });
const expiringQuery = z.object({ days: z.coerce.number().int().min(0).max(90).default(7) });
const expiredQuery = z.object({ sinceDays: z.coerce.number().int().min(1).max(365).default(30) });

@Controller()
export class MembershipsController {
  constructor(
    private readonly memberships: MembershipsService,
    private readonly payments: PaymentsService,
    private readonly members: MembersService,
  ) {}

  // ---------- Plans ----------
  @Get("plans")
  @Roles(...DESK)
  async listPlans(@Query(zod(plansQuery)) q: z.infer<typeof plansQuery>) {
    return { items: await this.memberships.listPlans(q.all !== "true") };
  }

  @Post("plans")
  @Roles(...MANAGERS)
  async createPlan(@CurrentUser() user: AuthUser, @Body(zod(planCreateSchema)) body: z.infer<typeof planCreateSchema>) {
    return { plan: await this.memberships.createPlan(user, body) };
  }

  @Patch("plans/:id")
  @Roles(...MANAGERS)
  async updatePlan(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(planUpdateSchema)) body: z.infer<typeof planUpdateSchema>) {
    return { plan: await this.memberships.updatePlan(user, id, body) };
  }

  // ---------- Memberships ----------
  @Get("members/:id/memberships")
  @Roles(...DESK)
  async history(@Param("id", ParseUUIDPipe) id: string) {
    await this.members.get(id);
    return { ...(await this.memberships.history(id)), current: await this.memberships.currentState(id) };
  }

  @Post("members/:id/memberships")
  @Roles(...DESK)
  sell(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(sellMembershipSchema)) body: z.infer<typeof sellMembershipSchema>) {
    return this.memberships.sell(user, id, body);
  }

  @Post("memberships/:id/freeze")
  @Roles(...MANAGERS)
  freeze(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(freezeSchema)) body: z.infer<typeof freezeSchema>) {
    return this.memberships.freeze(user, id, body);
  }

  @Post("freezes/:id/end")
  @Roles(...MANAGERS)
  @HttpCode(200)
  unfreeze(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.memberships.unfreeze(user, id);
  }

  @Post("memberships/:id/cancel")
  @Roles(...MANAGERS)
  @HttpCode(200)
  async cancel(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return { membership: await this.memberships.cancel(user, id, body.reason) };
  }

  @Get("memberships/expiring")
  @Roles(...DESK)
  async expiring(@Query(zod(expiringQuery)) q: z.infer<typeof expiringQuery>) {
    return { items: await this.memberships.expiring(q.days) };
  }

  @Get("memberships/expired")
  @Roles(...DESK)
  async expired(@Query(zod(expiredQuery)) q: z.infer<typeof expiredQuery>) {
    return { items: await this.memberships.expired(q.sinceDays) };
  }

  // ---------- Payments ----------
  @Post("payments/:id/void")
  @Roles(...MANAGERS)
  @HttpCode(200)
  async void(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return { payment: await this.payments.void(user, id, body.reason) };
  }

  @Get("payments/:id/receipt.pdf")
  @Roles(...DESK)
  async receipt(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const pdf = await this.payments.receiptPdf(id);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `inline; filename="${pdf.filename}"`);
    res.send(pdf.buffer);
  }
}
