import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Executor } from "./db";

/**
 * Sequential numbers per scope and year, for receipts. The counter row is locked by the update until
 * the surrounding transaction ends, so concurrent callers wait in line and a rolled-back transaction
 * gives its number back: numbers are unique and have no gaps.
 */
@Injectable()
export class CounterService {
  async next(tx: Executor, scope: string, year: number): Promise<number> {
    const result = await tx.execute(
      sql`INSERT INTO counters (scope, year, last_value) VALUES (${scope}, ${year}, 1)
          ON CONFLICT (scope, year) DO UPDATE SET last_value = counters.last_value + 1
          RETURNING last_value`,
    );
    return Number((result.rows[0] as { last_value: number }).last_value);
  }
}

/** "R-2026-000123" */
export function formatReceiptNumber(prefix: string, year: number, value: number): string {
  return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
}
