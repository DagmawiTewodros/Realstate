import { Body, Controller, Get, Put } from "@nestjs/common";
import { reminderSettingsSchema, siteSettingsSchema } from "@platform/shared";
import { AuditService, CurrentUser, Roles, SettingsService, type AuthUser } from "@platform/nest-common";
import { ROLE } from "../access";

/** Company details shown on the website (About, Contact) and the automation switches. Owner only. */
@Controller("settings")
@Roles(ROLE.OWNER)
export class SiteSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get("site")
  site() {
    return this.settings.get("site", siteSettingsSchema);
  }

  @Put("site")
  async updateSite(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const value = await this.settings.set("site", siteSettingsSchema, body, user.id);
    await this.audit.log({ userId: user.id, action: "settings.site_updated", entityType: "settings", entityId: "site" });
    return value;
  }

  @Get("reminders")
  reminders() {
    return this.settings.get("reminders", reminderSettingsSchema);
  }

  @Put("reminders")
  async updateReminders(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const value = await this.settings.set("reminders", reminderSettingsSchema, body, user.id);
    await this.audit.log({ userId: user.id, action: "settings.reminders_updated", entityType: "settings", entityId: "reminders" });
    return value;
  }
}
