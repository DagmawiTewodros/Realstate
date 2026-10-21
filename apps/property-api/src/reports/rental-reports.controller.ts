import { Controller, Get, Inject, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { idSchema } from "@platform/shared";
import { CLOCK, Roles, toCsv, zod, type Clock } from "@platform/nest-common";
import { RENTALS, RENTALS_READ } from "../access";
import { ReportsService } from "./reports.service";
import { csvResponse, rangeQuery, resolveRange } from "./reports.controller";

const rentQuery = rangeQuery.and(z.object({ landlordId: idSchema.optional() }));

/**
 * Rental dashboard (task 18). Occupancy is visible to sales managers too; money figures
 * (rent, arrears) and lease and maintenance details are for the owner and property managers only.
 */
@Controller("reports")
export class RentalReportsController {
  constructor(
    private readonly reports: ReportsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get("occupancy")
  @Roles(...RENTALS_READ)
  occupancy() {
    return this.reports.occupancy();
  }

  @Get("rent")
  @Roles(...RENTALS)
  async rent(@Query(zod(rentQuery)) q: z.infer<typeof rentQuery>, @Res({ passthrough: true }) res: Response) {
    const data = await this.reports.rent(resolveRange(q, this.clock.now()), q.landlordId);
    if (q.format === "json") return data;
    return csvResponse(
      res,
      "rent-collection.csv",
      toCsv(["Month", "Charged (santim)", "Collected (santim)", "Collection rate"], data.months.map((m) => [m.month, m.chargedMinor, m.collectedMinor, m.collectionRate.toFixed(3)])),
    );
  }

  @Get("arrears-aging")
  @Roles(...RENTALS)
  arrears() {
    return this.reports.arrearsAging();
  }

  @Get("leases-expiring")
  @Roles(...RENTALS)
  expiring() {
    return this.reports.leasesExpiring();
  }

  @Get("maintenance")
  @Roles(...RENTALS)
  maintenance(@Query(zod(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.reports.maintenance(resolveRange(q, this.clock.now()));
  }
}
