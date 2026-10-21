import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { consentSchema, customerCreateSchema, customerUpdateSchema, paginationSchema } from "@platform/shared";
import { CurrentUser, Roles, zod, type AuthUser } from "@platform/nest-common";
import { ROLE, STAFF } from "../access";
import { CustomersService } from "./customers.service";

const listQuery = paginationSchema.extend({ q: z.string().trim().max(100).optional() });

@Controller("customers")
@Roles(...STAFF)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.customers.list(user, q, q.q);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(zod(customerCreateSchema)) body: z.infer<typeof customerCreateSchema>) {
    return this.customers.create(user, body);
  }

  @Get(":id")
  async get(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const customer = await this.customers.get(user, id);
    return { customer, consent: await this.customers.consentState(id) };
  }

  @Patch(":id")
  update(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(customerUpdateSchema)) body: z.infer<typeof customerUpdateSchema>) {
    return this.customers.update(user, id, body);
  }

  @Post(":id/consent")
  consent(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(consentSchema)) body: z.infer<typeof consentSchema>) {
    return this.customers.setConsent(user, id, body.channel, body.granted, body.note);
  }

  @Get(":id/export")
  @Roles(ROLE.OWNER)
  export(@Param("id", ParseUUIDPipe) id: string) {
    return this.customers.export(id);
  }

  @Post(":id/anonymise")
  @Roles(ROLE.OWNER)
  async anonymise(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return { customer: await this.customers.anonymise(user, id) };
  }
}
