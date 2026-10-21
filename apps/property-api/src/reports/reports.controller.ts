import { Controller, Get, Inject, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { addDays, addisDateString, dateStringSchema } from "@platform/shared";
import { CLOCK, Roles, toCsv, zod, type Clock } from "@platform/nest-common";
import { SALES_MANAGERS } from "../access";
import { ReportsService, type Range } from "./reports.service";

export const rangeQuery = z
  .object({ from: dateStringSchema.optional(), to: dateStringSchema.optional(), format: z.enum(["json", "csv"]).default("json") })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "from must be on or before to" });

export function resolveRange(q: { from?: string; to?: string }, now: Date): Range {
  const to = q.to ?? addisDateString(now);
  return { from: q.from ?? addDays(to, -29), to };
}

export function csvResponse(res: Response, filename: string, csv: string): string {
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${filename}"`);
  return csv;
}

/** Sales dashboard (task 11). Owner and sales managers only. */
@Controller("reports")
@Roles(...SALES_MANAGERS)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get("leads")
  leads(@Query(zod(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.reports.leads(resolveRange(q, this.clock.now()));
  }

  @Get("brokers")
  async brokers(@Query(zod(rangeQuery)) q: z.infer<typeof rangeQuery>, @Res({ passthrough: true }) res: Response) {
    const data = await this.reports.brokers(resolveRange(q, this.clock.now()));
    if (q.format === "json") return data;
    return csvResponse(
      res,
      "brokers.csv",
      toCsv(
        ["Broker", "Assigned", "Contacted within 1 hour", "Overdue follow-ups", "Signed"],
        data.items.map((b) => [b.name, b.assigned, b.contactedWithinHour, b.overdueFollowUps, b.signed]),
      ),
    );
  }

  @Get("listings")
  async listings(@Query(zod(rangeQuery)) q: z.infer<typeof rangeQuery>, @Res({ passthrough: true }) res: Response) {
    const data = await this.reports.listings();
    if (q.format === "json") return data;
    return csvResponse(
      res,
      "listings-attention.csv",
      toCsv(
        ["Project", "Unit", "Issue", "Days on market"],
        [
          ...data.withoutPhotos.map((u) => [u.project, u.code, "No photos", ""]),
          ...data.notUpdatedIn30Days.map((u) => [u.project, u.code, "Not updated in 30 days", ""]),
          ...data.daysOnMarket.map((u) => [u.project, u.code, "Available", u.days]),
        ],
      ),
    );
  }
}
