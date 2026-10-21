import { Controller, Get, Inject } from "@nestjs/common";
import { asc, eq, inArray, and } from "drizzle-orm";
import { DB, Roles, type Database } from "@platform/nest-common";
import { users } from "../db/schema";
import { ROLE, STAFF } from "../access";

/** Active staff for pickers (assign a lead, choose a property manager). Never returns portal users. */
@Controller("staff")
@Roles(...STAFF)
export class StaffController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  async list() {
    const items = await this.db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(and(eq(users.isActive, true), inArray(users.role, [ROLE.OWNER, ROLE.SALES_MANAGER, ROLE.BROKER, ROLE.PROPERTY_MANAGER])))
      .orderBy(asc(users.name));
    return { items };
  }
}
