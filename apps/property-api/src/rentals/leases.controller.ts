import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { LEASE_STATUSES, idSchema, leaseCreateSchema, leaseRenewSchema, leaseUpdateSchema, reasonSchema } from "@platform/shared";
import { CurrentUser, Roles, zod, type AuthUser } from "@platform/nest-common";
import { RENTALS, RENTALS_READ } from "../access";
import { LeasesService } from "./leases.service";

const listQuery = z.object({
  status: z.enum(LEASE_STATUSES).optional(),
  unitId: idSchema.optional(),
  tenantId: idSchema.optional(),
  landlordId: idSchema.optional(),
  expiringDays: z.coerce.number().int().min(1).max(365).optional(),
});
const expiringQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(60) });

@Controller("leases")
export class LeasesController {
  constructor(private readonly leases: LeasesService) {}

  @Get()
  @Roles(...RENTALS_READ)
  list(@Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.leases.list(q);
  }

  @Get("expiring")
  @Roles(...RENTALS_READ)
  expiring(@Query(zod(expiringQuery)) q: z.infer<typeof expiringQuery>) {
    return this.leases.list({ expiringDays: q.days });
  }

  @Post()
  @Roles(...RENTALS)
  async create(@CurrentUser() user: AuthUser, @Body(zod(leaseCreateSchema)) body: z.infer<typeof leaseCreateSchema>) {
    return { lease: await this.leases.create(user, body) };
  }

  @Get(":id")
  @Roles(...RENTALS_READ)
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.leases.detail(id);
  }

  @Patch(":id")
  @Roles(...RENTALS)
  async update(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(leaseUpdateSchema)) body: z.infer<typeof leaseUpdateSchema>) {
    return { lease: await this.leases.update(user, id, body) };
  }

  @Post(":id/activate")
  @Roles(...RENTALS)
  @HttpCode(200)
  async activate(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return { lease: await this.leases.activate(user, id) };
  }

  @Post(":id/end")
  @Roles(...RENTALS)
  @HttpCode(200)
  async end(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return { lease: await this.leases.end(user, id) };
  }

  @Post(":id/terminate")
  @Roles(...RENTALS)
  @HttpCode(200)
  async terminate(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return { lease: await this.leases.terminate(user, id, body.reason) };
  }

  @Post(":id/renew")
  @Roles(...RENTALS)
  async renew(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(leaseRenewSchema)) body: z.infer<typeof leaseRenewSchema>) {
    return { lease: await this.leases.renew(user, id, body) };
  }
}
