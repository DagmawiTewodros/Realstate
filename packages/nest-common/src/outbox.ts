import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { eq, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { APP_CONFIG, AUTOMATION_RULES, CLOCK, DB } from "./tokens";
import type { BaseConfig } from "./config";
import type { Clock } from "./clock";
import type { Database, Executor } from "./db";
import { outboxEvents } from "./schema";
import { AlertService } from "./alerts";
import { safeEqual } from "./auth/auth.guard";

export interface OutboxEvent {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/**
 * What an app does with its events.
 * - handleLocal: work that always runs inside the API when automation is on (for example matching saved searches).
 * - handleMessaging: message rules that run inside the API only in AUTOMATION_MODE=direct; in n8n mode,
 *   n8n workflows do this instead by calling POST /internal/messages/send.
 * Handlers must be safe to run twice for the same event (the dispatcher retries on failure).
 */
export interface AutomationRules {
  handleLocal?(event: OutboxEvent): Promise<void>;
  handleMessaging?(event: OutboxEvent): Promise<void>;
}

export const MAX_ATTEMPTS = 8;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
}

/** Signature header value for a webhook body: "sha256=<hex>" of "<timestamp>.<body>". */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** For receivers (n8n Code node, tests): verifies a webhook signature and rejects timestamps older than 5 minutes. */
export function verifyWebhook(secret: string, timestamp: string, body: string, signature: string, nowMs = Date.now()): boolean {
  const age = Math.abs(nowMs - Number(timestamp));
  if (!Number.isFinite(age) || age > 5 * 60_000) return false;
  return safeEqual(signature, signWebhook(secret, timestamp, body));
}

/**
 * Writes events in the SAME transaction as the change that caused them (transactional outbox),
 * so a rolled-back change never produces an event. Event names are versioned, for example "lead.created.v1".
 * Payloads hold ids and the few fields the receiver needs, never full personal data.
 */
@Injectable()
export class OutboxService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async emit(tx: Executor | undefined, name: string, payload: Record<string, unknown>): Promise<void> {
    if (!/^[a-z_]+\.[a-z_]+\.v\d+$/.test(name)) throw new Error(`Event name "${name}" must look like "entity.action.v1"`);
    await (tx ?? this.db).insert(outboxEvents).values({ name, payload });
  }
}

/**
 * Delivers pending events. Rows are locked with FOR UPDATE SKIP LOCKED, so two dispatchers running at
 * the same time never deliver the same event twice. Failures retry with exponential backoff, and after
 * MAX_ATTEMPTS the event is marked FAILED and an alert is raised.
 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("OutboxDispatcher");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
    private readonly alerts: AlertService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** The app registers its rules in its own module, so they are looked up at run time. */
  private get rules(): AutomationRules | null {
    try {
      return this.moduleRef.get<AutomationRules>(AUTOMATION_RULES, { strict: false });
    } catch {
      return null;
    }
  }

  onModuleInit(): void {
    if (this.config.DISPATCHER_ENABLED && this.config.NODE_ENV !== "test") {
      this.timer = setInterval(() => void this.tick(), 5_000);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.dispatchOnce();
    } catch (e) {
      this.logger.error(`Dispatch failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }

  /** Delivers up to `batch` due events. Returns how many were delivered. */
  async dispatchOnce(batch = 50): Promise<number> {
    return this.db.transaction(async (tx) => {
      const now = this.clock.now();
      const result = await tx.execute(
        sql`SELECT id, name, payload, attempts, created_at FROM outbox_events
            WHERE status = 'PENDING' AND next_attempt_at <= ${now.toISOString()}
            ORDER BY created_at, id LIMIT ${batch} FOR UPDATE SKIP LOCKED`,
      );
      const rows = result.rows as Array<{ id: string; name: string; payload: Record<string, unknown>; attempts: number; created_at: string | Date }>;
      let delivered = 0;
      for (const row of rows) {
        const event: OutboxEvent = { id: row.id, name: row.name, payload: row.payload, createdAt: new Date(row.created_at) };
        try {
          await this.deliver(event);
          await tx.update(outboxEvents).set({ status: "SENT", sentAt: now, attempts: row.attempts + 1, lastError: null }).where(eq(outboxEvents.id, row.id));
          delivered += 1;
        } catch (e) {
          const attempts = row.attempts + 1;
          const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
          const failed = attempts >= MAX_ATTEMPTS;
          await tx
            .update(outboxEvents)
            .set({
              status: failed ? "FAILED" : "PENDING",
              attempts,
              lastError: message,
              nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
            })
            .where(eq(outboxEvents.id, row.id));
          if (failed) await this.alerts.alert(`Event ${event.name} (${event.id}) failed after ${attempts} attempts: ${message}`);
        }
      }
      return delivered;
    });
  }

  private async deliver(event: OutboxEvent): Promise<void> {
    switch (this.config.AUTOMATION_MODE) {
      case "off":
        return;
      case "direct":
        await this.rules?.handleLocal?.(event);
        await this.rules?.handleMessaging?.(event);
        return;
      case "n8n": {
        await this.rules?.handleLocal?.(event);
        const body = JSON.stringify({ id: event.id, name: event.name, payload: event.payload, createdAt: event.createdAt.toISOString() });
        const timestamp = String(this.clock.now().getTime());
        const res = await fetch(this.config.N8N_WEBHOOK_URL!, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-event-id": event.id,
            "x-event-name": event.name,
            "x-timestamp": timestamp,
            "x-signature": signWebhook(this.config.WEBHOOK_SIGNING_SECRET, timestamp, body),
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
        return;
      }
    }
  }
}
