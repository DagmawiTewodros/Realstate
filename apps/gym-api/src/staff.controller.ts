import { Controller, Get, Inject } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";
import { DB, Roles, type Database } from "@platform/nest-common";
import { users } from "./db/schema";
import { ROLE, STAFF } from "./access";

/** Active staff for pickers (for example choosing a trainer). Never returns member logins. */
@Controller("staff")
@Roles(...STAFF)
export class StaffController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  async list() {
    const items = await this.db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(and(eq(users.isActive, true), inArray(users.role, [ROLE.OWNER, ROLE.GYM_MANAGER, ROLE.FRONT_DESK, ROLE.TRAINER])))
      .orderBy(asc(users.name));
    return { items };
  }
}
