import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { addDays, addisDateString, diffDays, gymSettingsSchema } from "@platform/shared";
import { CLOCK, DB, SettingsService, type Clock, type Database } from "@platform/nest-common";
import { GYM_SETTINGS_KEY } from "../automation/scheduler";

/** Addis Ababa local time of a timestamptz column, independent of the database server time zone. */
const LOCAL = (col: string) => sql.raw(`((${col} AT TIME ZONE 'UTC') + interval '3 hours')`);

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly settings: SettingsService,
  ) {}

  private today(): string {
    return addisDateString(this.clock.now());
  }

  private monthRange(month?: string): { from: string; to: string; month: string } {
    const m = month ?? this.today().slice(0, 7);
    const from = `${m}-01`;
    const [y, mo] = m.split("-").map(Number);
    const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
    return { from, to: addDays(next, -1), month: m };
  }

  async summary() {
    const today = this.today();
    const { from } = this.monthRange();
    const result = await this.db.execute(sql`
      SELECT
        (SELECT count(DISTINCT ms.member_id)::int FROM memberships ms JOIN members m ON m.id = ms.member_id
          WHERE ms.status <> 'CANCELLED' AND ms.start_date <= ${today} AND ms.end_date >= ${today} AND m.anonymized_at IS NULL) AS active_members,
        (SELECT count(*)::int FROM memberships ms
          WHERE ms.status IN ('ACTIVE','FROZEN') AND ms.end_date BETWEEN ${today} AND ${addDays(today, 7)}
            AND NOT EXISTS (SELECT 1 FROM memberships later WHERE later.member_id = ms.member_id AND later.status <> 'CANCELLED' AND later.start_date > ms.end_date)) AS expiring_7_days,
        (SELECT count(*)::int FROM members WHERE joined_at BETWEEN ${from} AND ${today}) AS new_members_this_month`);
    const r = result.rows[0] as { active_members: number; expiring_7_days: number; new_members_this_month: number };
    return { activeMembers: Number(r.active_members), expiringIn7Days: Number(r.expiring_7_days), newMembersThisMonth: Number(r.new_members_this_month) };
  }

  /** Valid payments in the month, grouped by plan. Payments without a membership are grouped as "Other". */
  async revenue(month?: string) {
    const range = this.monthRange(month);
    const result = await this.db.execute(sql`
      SELECT p2.id AS plan_id, coalesce(p2.name, 'Other') AS plan_name, sum(p.amount_minor)::bigint AS total_minor, count(*)::int AS payments
      FROM payments p
      LEFT JOIN memberships ms ON ms.id = p.membership_id
      LEFT JOIN plans p2 ON p2.id = ms.plan_id
      WHERE p.status = 'VALID' AND p.paid_at BETWEEN ${range.from} AND ${range.to}
      GROUP BY p2.id, p2.name
      ORDER BY total_minor DESC, plan_name`);
    const byPlan = (result.rows as Array<{ plan_id: string | null; plan_name: string; total_minor: string; payments: number }>).map((r) => ({
      planId: r.plan_id,
      planName: r.plan_name,
      totalMinor: Number(r.total_minor),
      payments: Number(r.payments),
    }));
    return { month: range.month, currency: "ETB", totalMinor: byPlan.reduce((s, r) => s + r.totalMinor, 0), byPlan };
  }

  /** Allowed visits in the last 30 days: per day (zero-filled), per hour of day and per weekday (Addis time). */
  async attendance() {
    const today = this.today();
    const from = addDays(today, -29);
    const fromInstant = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10))) - 3 * 3600_000);
    const local = LOCAL("c.at");
    const perDay = await this.db.execute(sql`
      SELECT (${local})::date::text AS day, count(*)::int AS visits FROM checkins c
      WHERE c.result = 'ALLOWED' AND c.at >= ${fromInstant.toISOString()} GROUP BY 1 ORDER BY 1`);
    const perHour = await this.db.execute(sql`
      SELECT extract(hour FROM ${local})::int AS hour, count(*)::int AS visits FROM checkins c
      WHERE c.result = 'ALLOWED' AND c.at >= ${fromInstant.toISOString()} GROUP BY 1 ORDER BY 1`);
    const perWeekday = await this.db.execute(sql`
      SELECT extract(dow FROM ${local})::int AS weekday, count(*)::int AS visits FROM checkins c
      WHERE c.result = 'ALLOWED' AND c.at >= ${fromInstant.toISOString()} GROUP BY 1 ORDER BY 1`);
    const dayMap = new Map((perDay.rows as Array<{ day: string; visits: number }>).map((r) => [r.day, Number(r.visits)]));
    const days = Array.from({ length: 30 }, (_, i) => addDays(from, i)).map((day) => ({ day, visits: dayMap.get(day) ?? 0 }));
    const hourMap = new Map((perHour.rows as Array<{ hour: number; visits: number }>).map((r) => [Number(r.hour), Number(r.visits)]));
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, visits: hourMap.get(hour) ?? 0 }));
    const wdMap = new Map((perWeekday.rows as Array<{ weekday: number; visits: number }>).map((r) => [Number(r.weekday), Number(r.visits)]));
    const weekdays = Array.from({ length: 7 }, (_, weekday) => ({ weekday, visits: wdMap.get(weekday) ?? 0 }));
    const busiestHour = hours.reduce((best, h) => (h.visits > best.visits ? h : best), { hour: -1, visits: 0 });
    const busiestWeekday = weekdays.reduce((best, w) => (w.visits > best.visits ? w : best), { weekday: -1, visits: 0 });
    return {
      from,
      to: today,
      days,
      hours,
      weekdays,
      busiestHour: busiestHour.visits ? busiestHour.hour : null,
      busiestWeekday: busiestWeekday.visits ? busiestWeekday.weekday : null,
    };
  }

  /** Members with a membership covering today (not frozen) and no allowed visit for N days (setting, default 14). */
  async atRisk() {
    const today = this.today();
    const { inactiveDays } = await this.settings.get(GYM_SETTINGS_KEY, gymSettingsSchema);
    const result = await this.db.execute(sql`
      SELECT m.id, m.name, m.phone, ms.start_date::text AS start_date, ms.end_date::text AS end_date,
             (SELECT max((${LOCAL("c.at")})::date)::text FROM checkins c WHERE c.member_id = m.id AND c.result = 'ALLOWED') AS last_visit
      FROM members m
      JOIN memberships ms ON ms.member_id = m.id AND ms.status <> 'CANCELLED' AND ms.start_date <= ${today} AND ms.end_date >= ${today}
      WHERE m.status = 'ACTIVE' AND m.anonymized_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM membership_freezes f WHERE f.membership_id = ms.id AND f.start_date <= ${today} AND f.end_date >= ${today})
      ORDER BY m.name`);
    const items = (result.rows as Array<{ id: string; name: string; phone: string | null; start_date: string; end_date: string; last_visit: string | null }>)
      .map((r) => {
        const anchor = r.last_visit ?? r.start_date;
        return { memberId: r.id, name: r.name, phone: r.phone, lastVisit: r.last_visit, membershipEnd: r.end_date, daysSince: diffDays(anchor, today) };
      })
      .filter((r) => r.daysSince >= inactiveDays)
      .sort((a, b) => b.daysSince - a.daysSince || a.name.localeCompare(b.name));
    return { inactiveDays, items };
  }
}
