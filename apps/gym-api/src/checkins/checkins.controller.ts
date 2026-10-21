import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { z } from "zod";
import { checkinSchema } from "@platform/shared";
import { CurrentUser, Roles, zod, type AuthUser } from "@platform/nest-common";
import { DESK, STAFF } from "../access";
import { CheckinsService } from "./checkins.service";
import { MembersService } from "../members/members.service";

@Controller()
export class CheckinsController {
  constructor(
    private readonly checkins: CheckinsService,
    private readonly members: MembersService,
  ) {}

  @Post("checkins")
  @Roles(...DESK)
  @HttpCode(200)
  checkIn(@CurrentUser() user: AuthUser, @Body(zod(checkinSchema)) body: z.infer<typeof checkinSchema>) {
    return this.checkins.checkIn(user, body);
  }

  @Get("checkins/today")
  @Roles(...DESK)
  async today() {
    return { items: await this.checkins.today() };
  }

  @Get("members/:id/checkins")
  @Roles(...STAFF)
  async history(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.members.getFor(user, id);
    return { items: await this.checkins.forMember(id) };
  }
}
