import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { addDays, addisDateString, addisStartOfDay } from "@platform/shared";
import { CLOCK, DB, type Clock, type Database } from "@platform/nest-common";

export interface Range {
  from: string;
  to: string;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** All dashboard figures are computed in SQL. Date ranges are inclusive Addis Ababa calendar days. */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private bounds(range: Range) {
    return { start: addisStartOfDay(range.from).toISOString(), end: addisStartOfDay(addDays(range.to, 1)).toISOString() };
  }

  private async rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
    return (await this.db.execute(query)).rows as T[];
  }

  async leads(range: Range) {
    const { start, end } = this.bounds(range);
    const inRange = sql`created_at >= ${start} AND created_at < ${end}`;
    const byStatus = await this.rows<{ status: string; n: string }>(sql`SELECT status, count(*) AS n FROM leads WHERE ${inRange} GROUP BY status`);
    const bySource = await this.rows<{ source: string; n: string }>(sql`SELECT source, count(*) AS n FROM leads WHERE ${inRange} GROUP BY source`);
    const [timing] = await this.rows<{ total: string; signed: string; contacted: string; avg_min: string | null; median_min: string | null }>(sql`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE status = 'SIGNED') AS signed,
             count(first_contact_at) AS contacted,
             avg(extract(epoch FROM first_contact_at - created_at) / 60) AS avg_min,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_contact_at - created_at) / 60) AS median_min
      FROM leads WHERE ${inRange}`);
    const total = num(timing.total);
    return {
      range,
      total,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, num(r.n)])),
      bySource: Object.fromEntries(bySource.map((r) => [r.source, num(r.n)])),
      signed: num(timing.signed),
      conversionRate: total ? num(timing.signed) / total : 0,
      contacted: num(timing.contacted),
      notContacted: total - num(timing.contacted),
      avgMinutesToFirstContact: timing.avg_min === null ? null : Math.round(Number(timing.avg_min) * 10) / 10,
      medianMinutesToFirstContact: timing.median_min === null ? null : Math.round(Number(timing.median_min) * 10) / 10,
    };
  }

  async brokers(range: Range) {
    const { start, end } = this.bounds(range);
    const now = this.clock.now().toISOString();
    const rows = await this.rows<{ id: string; name: string; assigned: string; fast: string; overdue: string; signed: string }>(sql`
      SELECT u.id, u.name,
             count(l.id) FILTER (WHERE l.created_at >= ${start} AND l.created_at < ${end}) AS assigned,
             count(l.id) FILTER (WHERE l.created_at >= ${start} AND l.created_at < ${end}
                                  AND l.first_contact_at IS NOT NULL AND l.first_contact_at - l.created_at <= interval '1 hour') AS fast,
             count(l.id) FILTER (WHERE l.status NOT IN ('SIGNED','LOST') AND l.next_step_at < ${now}) AS overdue,
             count(l.id) FILTER (WHERE l.status = 'SIGNED' AND l.closed_at >= ${start} AND l.closed_at < ${end}) AS signed
      FROM users u
      LEFT JOIN leads l ON l.assigned_to_id = u.id
      WHERE u.role = 'BROKER' AND u.is_active
      GROUP BY u.id, u.name
      ORDER BY u.name`);
    return {
      range,
      items: rows.map((r) => ({
        brokerId: r.id,
        name: r.name,
        assigned: num(r.assigned),
        contactedWithinHour: num(r.fast),
        overdueFollowUps: num(r.overdue),
        signed: num(r.signed),
      })),
    };
  }

  async listings() {
    const now = this.clock.now();
    const stale = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const byStatus = await this.rows<{ status: string; n: string }>(sql`SELECT status, count(*) AS n FROM units GROUP BY status`);
    const noPhotos = await this.rows<{ id: string; code: string; project: string }>(sql`
      SELECT u.id, u.code, p.name AS project FROM units u JOIN projects p ON p.id = u.project_id
      WHERE NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.unit_id = u.id) ORDER BY p.name, u.code LIMIT 500`);
    const notUpdated = await this.rows<{ id: string; code: string; project: string; updated_at: string }>(sql`
      SELECT u.id, u.code, p.name AS project, u.updated_at FROM units u JOIN projects p ON p.id = u.project_id
      WHERE u.updated_at < ${stale} ORDER BY u.updated_at LIMIT 500`);
    const onMarket = await this.rows<{ id: string; code: string; project: string; days: string }>(sql`
      SELECT u.id, u.code, p.name AS project, floor(extract(epoch FROM ${now.toISOString()}::timestamptz - u.status_changed_at) / 86400) AS days
      FROM units u JOIN projects p ON p.id = u.project_id
      WHERE u.status = 'AVAILABLE' ORDER BY days DESC LIMIT 500`);
    const days = onMarket.map((r) => num(r.days));
    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, num(r.n)])),
      withoutPhotos: noPhotos,
      notUpdatedIn30Days: notUpdated.map((r) => ({ ...r, updatedAt: r.updated_at, updated_at: undefined })),
      daysOnMarket: onMarket.map((r) => ({ id: r.id, code: r.code, project: r.project, days: num(r.days) })),
      averageDaysOnMarket: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
    };
  }

  // ---------- Rentals (task 18) ----------
  private managedUnits = sql`(u.landlord_id IS NOT NULL OR EXISTS (SELECT 1 FROM leases l WHERE l.unit_id = u.id))`;

  async occupancy() {
    const today = addisDateString(this.clock.now());
    const byStatus = await this.rows<{ status: string; n: string }>(sql`SELECT u.status, count(*) AS n FROM units u WHERE ${this.managedUnits} GROUP BY u.status`);
    const counts = Object.fromEntries(byStatus.map((r) => [r.status, num(r.n)]));
    const managed = Object.values(counts).reduce((a, b) => a + b, 0);
    const vacant = await this.rows<{ id: string; code: string; status: string; days: string }>(sql`
      SELECT u.id, u.code, u.status, (${today}::date - (u.status_changed_at AT TIME ZONE 'Africa/Addis_Ababa')::date) AS days
      FROM units u WHERE ${this.managedUnits} AND u.status <> 'LEASED' ORDER BY days DESC`);
    return {
      managedUnits: managed,
      byStatus: counts,
      occupancyRate: managed ? (counts.LEASED ?? 0) / managed : 0,
      vacantUnits: vacant.map((r) => ({ id: r.id, code: r.code, status: r.status, vacantDays: num(r.days) })),
    };
  }

  /** Charged and collected per month. Collection counts only payments on charges due in that month. */
  async rent(range: Range, landlordId?: string) {
    const landlordFilter = landlordId ? sql`AND l.landlord_id = ${landlordId}` : sql``;
    const rows = await this.rows<{ month: string; charged: string; collected: string }>(sql`
      SELECT to_char(c.due_date, 'YYYY-MM') AS month, sum(c.amount_minor) AS charged, sum(least(c.paid_minor, c.amount_minor)) AS collected
      FROM rent_charges c JOIN leases l ON l.id = c.lease_id
      WHERE c.status <> 'WAIVED' AND c.due_date >= ${range.from}::date AND c.due_date <= ${range.to}::date ${landlordFilter}
      GROUP BY 1 ORDER BY 1`);
    const months = rows.map((r) => ({
      month: r.month,
      chargedMinor: num(r.charged),
      collectedMinor: num(r.collected),
      collectionRate: num(r.charged) ? num(r.collected) / num(r.charged) : 0,
    }));
    const chargedMinor = months.reduce((a, m) => a + m.chargedMinor, 0);
    const collectedMinor = months.reduce((a, m) => a + m.collectedMinor, 0);
    return { range, months, chargedMinor, collectedMinor, collectionRate: chargedMinor ? collectedMinor / chargedMinor : 0 };
  }

  async arrearsAging() {
    const today = addisDateString(this.clock.now());
    const [row] = await this.rows<Record<string, string | null>>(sql`
      WITH open AS (
        SELECT (c.amount_minor - c.paid_minor) AS due, (${today}::date - c.due_date) AS days
        FROM rent_charges c JOIN leases l ON l.id = c.lease_id
        WHERE c.status NOT IN ('PAID','WAIVED') AND c.paid_minor < c.amount_minor AND c.due_date < ${today}::date
      )
      SELECT sum(due) FILTER (WHERE days BETWEEN 1 AND 7) AS d1_7,
             sum(due) FILTER (WHERE days BETWEEN 8 AND 30) AS d8_30,
             sum(due) FILTER (WHERE days BETWEEN 31 AND 60) AS d31_60,
             sum(due) FILTER (WHERE days > 60) AS d61_plus,
             sum(due) AS total
      FROM open`);
    return {
      buckets: [
        { label: "1-7", amountMinor: num(row.d1_7) },
        { label: "8-30", amountMinor: num(row.d8_30) },
        { label: "31-60", amountMinor: num(row.d31_60) },
        { label: "61+", amountMinor: num(row.d61_plus) },
      ],
      totalMinor: num(row.total),
    };
  }

  async leasesExpiring() {
    const today = addisDateString(this.clock.now());
    const [row] = await this.rows<Record<string, string>>(sql`
      SELECT count(*) FILTER (WHERE end_date <= ${today}::date + 30) AS d30,
             count(*) FILTER (WHERE end_date <= ${today}::date + 60) AS d60,
             count(*) FILTER (WHERE end_date <= ${today}::date + 90) AS d90
      FROM leases WHERE status = 'ACTIVE' AND end_date >= ${today}::date`);
    const items = await this.rows<{ id: string; end_date: string; code: string; tenant: string }>(sql`
      SELECT l.id, to_char(l.end_date, 'YYYY-MM-DD') AS end_date, u.code, c.name AS tenant
      FROM leases l JOIN units u ON u.id = l.unit_id JOIN customers c ON c.id = l.tenant_id
      WHERE l.status = 'ACTIVE' AND l.end_date >= ${today}::date AND l.end_date <= ${today}::date + 90 ORDER BY l.end_date`);
    return {
      within30: num(row.d30),
      within60: num(row.d60),
      within90: num(row.d90),
      items: items.map((r) => ({ leaseId: r.id, endDate: r.end_date, unitCode: r.code, tenantName: r.tenant })),
    };
  }

  async maintenance(range: Range) {
    const { start, end } = this.bounds(range);
    const open = await this.rows<{ priority: string; n: string }>(sql`
      SELECT priority, count(*) AS n FROM maintenance_requests WHERE status NOT IN ('DONE','CANCELLED') GROUP BY priority`);
    const [avg] = await this.rows<{ days: string | null }>(sql`
      SELECT avg(extract(epoch FROM closed_at - created_at) / 86400) AS days FROM maintenance_requests
      WHERE status = 'DONE' AND closed_at >= ${start} AND closed_at < ${end}`);
    const byUnit = await this.rows<{ id: string; code: string; cost: string }>(sql`
      SELECT u.id, u.code, sum(m.cost_minor) AS cost FROM maintenance_requests m JOIN units u ON u.id = m.unit_id
      WHERE m.status = 'DONE' AND m.closed_at >= ${start} AND m.closed_at < ${end} GROUP BY u.id, u.code ORDER BY cost DESC`);
    const byMonth = await this.rows<{ month: string; cost: string }>(sql`
      SELECT to_char(closed_at AT TIME ZONE 'Africa/Addis_Ababa', 'YYYY-MM') AS month, sum(cost_minor) AS cost FROM maintenance_requests
      WHERE status = 'DONE' AND closed_at >= ${start} AND closed_at < ${end} GROUP BY 1 ORDER BY 1`);
    return {
      range,
      openByPriority: Object.fromEntries(open.map((r) => [r.priority, num(r.n)])),
      averageDaysToClose: avg.days === null ? null : Math.round(Number(avg.days) * 10) / 10,
      costByUnit: byUnit.map((r) => ({ unitId: r.id, code: r.code, costMinor: num(r.cost) })),
      costByMonth: byMonth.map((r) => ({ month: r.month, costMinor: num(r.cost) })),
    };
  }
}
