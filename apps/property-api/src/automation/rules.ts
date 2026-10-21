import { Inject, Injectable } from "@nestjs/common";
import { formatDate, formatDateTime, formatMoney, type Locale } from "@platform/shared";
import { APP_CONFIG, MessageService, ReminderLogService, type AutomationRules, type BaseConfig, type OutboxEvent, type Recipient } from "@platform/nest-common";
import { OfferMatcher } from "./offers";
import { Recipients } from "./recipients";

type P = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * What System A does with its events when AUTOMATION_MODE=direct. In n8n mode the same mapping lives in the
 * n8n workflows (ops/n8n/property), and only handleLocal (offer matching) runs in the API.
 * Every send is claimed per event and recipient first, so a retried event never sends twice.
 */
@Injectable()
export class PropertyAutomationRules implements AutomationRules {
  constructor(
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
    private readonly messages: MessageService,
    private readonly reminders: ReminderLogService,
    private readonly offers: OfferMatcher,
    private readonly recipients: Recipients,
  ) {}

  private link(path: string) {
    return `${this.config.PUBLIC_WEB_URL.replace(/\/$/, "")}${path}`;
  }

  async handleLocal(event: OutboxEvent): Promise<void> {
    if (["unit.published.v1", "unit.price_dropped.v1", "unit.released.v1"].includes(event.name)) {
      await this.offers.handle(event);
    }
  }

  private async send(event: OutboxEvent, recipient: Recipient, templateKey: string, data: P) {
    if (!(await this.reminders.claim(`msg:${event.id}:${recipient.id}`))) return;
    await this.messages.send({ recipient, templateKey, data });
  }

  private async toUsers(event: OutboxEvent, users: Array<{ id: string; locale: Locale }>, templateKey: string, data: (locale: Locale) => P) {
    for (const u of users) await this.send(event, { kind: "user", id: u.id }, templateKey, data(u.locale));
  }

  async handleMessaging(event: OutboxEvent): Promise<void> {
    const p = event.payload as P;
    switch (event.name) {
      case "lead.created.v1": {
        const customer = await this.recipients.customer(str(p.customerId));
        await this.toUsers(event, await this.recipients.usersWithRole("SALES_MANAGER"), "staff.lead_created", () => ({
          customerName: customer?.name ?? "",
          source: str(p.source),
          link: this.link(`/staff/leads/${str(p.leadId)}`),
        }));
        return;
      }
      case "lead.assigned.v1": {
        const broker = await this.recipients.user(str(p.assignedToId));
        const customer = await this.recipients.customer(str(p.customerId));
        if (broker) await this.toUsers(event, [broker], "staff.lead_assigned", () => ({ customerName: customer?.name ?? "", link: this.link(`/staff/leads/${str(p.leadId)}`) }));
        return;
      }
      case "lead.followup_overdue.v1": {
        const targets = p.level === "manager" ? await this.recipients.usersWithRole("SALES_MANAGER") : [await this.recipients.user(str(p.brokerId))].filter((u): u is NonNullable<typeof u> => Boolean(u));
        await this.toUsers(event, targets, "staff.followup_overdue", () => ({ customerName: str(p.customerName), reason: str(p.reason), link: this.link(`/staff/leads/${str(p.leadId)}`) }));
        return;
      }
      case "viewing.booked.v1": {
        const customer = await this.recipients.customer(str(p.customerId));
        if (customer) {
          await this.send(event, { kind: "subject", id: customer.id }, "customer.viewing_booked", { unit: str(p.unitLabel), when: formatDateTime(new Date(str(p.scheduledAt)), customer.locale) });
        }
        return;
      }
      case "viewing.reminder.v1": {
        const customer = await this.recipients.customer(str(p.customerId));
        const when = (locale: Locale) => formatDateTime(new Date(str(p.scheduledAt)), locale);
        if (customer) await this.send(event, { kind: "subject", id: customer.id }, "customer.viewing_reminder", { unit: str(p.unitLabel), when: when(customer.locale) });
        const broker = await this.recipients.user(str(p.brokerId));
        if (broker) await this.toUsers(event, [broker], "staff.viewing_reminder", (l) => ({ customerName: customer?.name ?? "", unit: str(p.unitLabel), when: when(l) }));
        return;
      }
      case "rent.due_soon.v1": {
        const tenant = await this.recipients.customer(str(p.tenantId));
        if (tenant) {
          await this.send(event, { kind: "subject", id: tenant.id }, "customer.rent_due_soon", {
            amount: formatMoney(Number(p.amountMinor), tenant.locale),
            unit: str(p.unitCode),
            dueDate: formatDate(str(p.dueDate), tenant.locale),
          });
        }
        return;
      }
      case "rent.overdue.v1": {
        const tenant = await this.recipients.customer(str(p.tenantId));
        const data = (l: Locale) => ({ amount: formatMoney(Number(p.amountMinor), l), unit: str(p.unitCode), dueDate: formatDate(str(p.dueDate), l), days: str(p.daysOverdue) });
        if (tenant) await this.send(event, { kind: "subject", id: tenant.id }, "customer.rent_overdue", data(tenant.locale));
        await this.toUsers(event, await this.recipients.usersWithRole("PROPERTY_MANAGER"), "staff.rent_overdue", (l) => ({ ...data(l), tenantName: tenant?.name ?? "" }));
        return;
      }
      case "lease.expiring.v1": {
        const data = (l: Locale) => ({ unit: str(p.unitCode), tenantName: str(p.tenantName), endDate: formatDate(str(p.endDate), l) });
        await this.toUsers(event, await this.recipients.usersWithRole("PROPERTY_MANAGER"), "staff.lease_expiring", data);
        await this.toUsers(event, await this.recipients.landlordUsers(str(p.landlordId)), "landlord.lease_expiring", data);
        return;
      }
      case "maintenance.created.v1": {
        await this.toUsers(event, await this.recipients.usersWithRole("PROPERTY_MANAGER"), "staff.maintenance_created", () => ({
          title: str(p.title),
          priority: str(p.priority),
          unit: str(p.unitCode ?? p.unitId),
        }));
        return;
      }
      default:
        return;
    }
  }
}
