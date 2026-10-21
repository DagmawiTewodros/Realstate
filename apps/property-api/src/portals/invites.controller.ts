import { Controller, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { formatDate, siteSettingsSchema } from "@platform/shared";
import { APP_CONFIG, CurrentUser, DB, InvitationService, MessageService, Roles, SettingsService, notFound, type AuthUser, type BaseConfig, type Database } from "@platform/nest-common";
import { customers, landlords, leases } from "../db/schema";
import { RENTALS, ROLE } from "../access";

/**
 * Invitation links for the landlord and tenant portals. The link is always returned so staff can share it.
 * For a tenant (a customer) it is also sent through MessageService, which checks consent first.
 * Landlords have no consent record, so their link is shared by staff (see docs/DECISIONS.md).
 */
@Controller()
@Roles(...RENTALS)
export class InvitesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
    private readonly invitations: InvitationService,
    private readonly messages: MessageService,
    private readonly settings: SettingsService,
  ) {}

  private link(token: string) {
    return `${this.config.PUBLIC_WEB_URL.replace(/\/$/, "")}/invite/${token}`;
  }

  @Post("landlords/:id/invite")
  async inviteLandlord(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const [owner] = await this.db.select().from(landlords).where(eq(landlords.id, id));
    if (!owner) throw notFound("LANDLORD_NOT_FOUND");
    const { token, expiresAt } = await this.invitations.create({ role: ROLE.LANDLORD, linkedEntityId: id, email: owner.email, name: owner.name, locale: "am", createdById: user.id });
    return { link: this.link(token), expiresAt, sent: null };
  }

  @Post("leases/:id/invite-tenant")
  async inviteTenant(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const [lease] = await this.db.select().from(leases).where(eq(leases.id, id));
    if (!lease) throw notFound("LEASE_NOT_FOUND");
    const [tenant] = await this.db.select().from(customers).where(eq(customers.id, lease.tenantId));
    const locale = tenant.locale === "en" ? "en" : "am";
    const { token, expiresAt } = await this.invitations.create({ role: ROLE.TENANT, linkedEntityId: tenant.id, email: tenant.email, name: tenant.name, locale, createdById: user.id });
    const site = await this.settings.get("site", siteSettingsSchema);
    const sent = await this.messages.send({
      recipient: { kind: "subject", id: tenant.id },
      templateKey: "staff.invitation",
      data: { company: site.companyName[locale] || this.config.COMPANY_NAME, link: this.link(token), expires: formatDate(expiresAt, locale) },
    });
    return { link: this.link(token), expiresAt, sent: sent.status };
  }
}
