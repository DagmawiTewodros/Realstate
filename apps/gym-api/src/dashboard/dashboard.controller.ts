import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { formatMoney } from "@platform/shared";
import { MessageService, Roles, sendCsv, toCsv, zod } from "@platform/nest-common";
import { MANAGERS } from "../access";
import { DashboardService } from "./dashboard.service";
import { MembersService } from "../members/members.service";

const monthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

/** Owner and gym manager only. Revenue figures are never shown to trainers or front desk staff. */
@Controller("dashboard")
@Roles(...MANAGERS)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly messages: MessageService,
    private readonly members: MembersService,
  ) {}

  @Get("summary")
  summary() {
    return this.dashboard.summary();
  }

  @Get("revenue")
  revenue(@Query(zod(monthQuery)) q: z.infer<typeof monthQuery>) {
    return this.dashboard.revenue(q.month);
  }

  @Get("attendance")
  attendance() {
    return this.dashboard.attendance();
  }

  @Get("at-risk")
  atRisk() {
    return this.dashboard.atRisk();
  }

  /** One-tap "we miss you" message to an at-risk member. Consent is checked by MessageService. */
  @Post("at-risk/:memberId/message")
  @HttpCode(200)
  async message(@Param("memberId", ParseUUIDPipe) memberId: string) {
    await this.members.get(memberId);
    const risk = await this.dashboard.atRisk();
    const row = risk.items.find((r) => r.memberId === memberId);
    return this.messages.send({ recipient: { kind: "subject", id: memberId }, templateKey: "member.we_miss_you", data: { days: row?.daysSince ?? risk.inactiveDays } });
  }

  @Get("revenue.csv")
  async revenueCsv(@Query(zod(monthQuery)) q: z.infer<typeof monthQuery>, @Res() res: Response) {
    const r = await this.dashboard.revenue(q.month);
    sendCsv(res, `revenue-${r.month}.csv`, toCsv(["Plan", "Payments", "Total (ETB)"], r.byPlan.map((p) => [p.planName, p.payments, formatMoney(p.totalMinor).replace("ETB ", "")])));
  }

  @Get("attendance.csv")
  async attendanceCsv(@Res() res: Response) {
    const a = await this.dashboard.attendance();
    sendCsv(res, `attendance-${a.to}.csv`, toCsv(["Date", "Visits"], a.days.map((d) => [d.day, d.visits])));
  }

  @Get("at-risk.csv")
  async atRiskCsv(@Res() res: Response) {
    const r = await this.dashboard.atRisk();
    sendCsv(res, "at-risk-members.csv", toCsv(["Name", "Phone", "Last visit", "Days since", "Membership ends"], r.items.map((i) => [i.name, i.phone, i.lastVisit ?? "", i.daysSince, i.membershipEnd])));
  }
}
