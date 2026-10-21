import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import type { z } from "zod";
import { campaignSchema, gymSettingsSchema } from "@platform/shared";
import { CurrentUser, Roles, SettingsService, zod, type AuthUser } from "@platform/nest-common";
import { MANAGERS, ROLE } from "../access";
import { CampaignsService } from "./campaigns.service";
import { GYM_SETTINGS_KEY, GymScheduler } from "./scheduler";

@Controller()
export class AutomationController {
  constructor(
    private readonly settings: SettingsService,
    private readonly campaigns: CampaignsService,
    private readonly scheduler: GymScheduler,
  ) {}

  @Get("settings/reminders")
  @Roles(ROLE.OWNER)
  async getSettings() {
    return { settings: await this.settings.get(GYM_SETTINGS_KEY, gymSettingsSchema) };
  }

  @Put("settings/reminders")
  @Roles(ROLE.OWNER)
  async putSettings(@CurrentUser() user: AuthUser, @Body(zod(gymSettingsSchema)) body: z.infer<typeof gymSettingsSchema>) {
    return { settings: await this.settings.set(GYM_SETTINGS_KEY, gymSettingsSchema, body, user.id) };
  }

  @Get("campaigns")
  @Roles(...MANAGERS)
  async listCampaigns() {
    return { items: await this.campaigns.list() };
  }

  @Get("campaigns/:id")
  @Roles(...MANAGERS)
  async getCampaign(@Param("id", ParseUUIDPipe) id: string) {
    return { campaign: await this.campaigns.get(id) };
  }

  @Post("campaigns")
  @Roles(...MANAGERS)
  async send(@CurrentUser() user: AuthUser, @Body(zod(campaignSchema)) body: z.infer<typeof campaignSchema>) {
    return { campaign: await this.campaigns.send(user, body) };
  }

  /** Runs the daily jobs now (they also run automatically every 15 minutes). */
  @Post("jobs/run")
  @Roles(ROLE.OWNER)
  @HttpCode(200)
  run() {
    return this.scheduler.run();
  }
}
