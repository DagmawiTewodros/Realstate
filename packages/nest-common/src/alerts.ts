import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG } from "./tokens";
import type { BaseConfig } from "./config";

/** Operational alerts (failed events, failed jobs) to a Telegram chat. Always also written to the error log. */
@Injectable()
export class AlertService {
  private readonly logger = new Logger("Alerts");
  readonly sent: string[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: BaseConfig) {}

  async alert(text: string): Promise<void> {
    this.logger.error(`ALERT: ${text}`);
    this.sent.push(text);
    const chat = this.config.ALERT_TELEGRAM_CHAT_ID;
    const token = this.config.TELEGRAM_BOT_TOKEN;
    if (!chat || !token || this.config.NODE_ENV === "test") return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: `[${this.config.COMPANY_NAME}] ${text}` }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      this.logger.error(`Could not send alert: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Reports an unexpected error to ERROR_WEBHOOK_URL (any service that accepts JSON). Fire and forget. */
  reportError(error: unknown, requestId: string): void {
    const url = this.config.ERROR_WEBHOOK_URL;
    if (!url || this.config.NODE_ENV === "test") return;
    const body = JSON.stringify({
      requestId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      at: new Date().toISOString(),
    });
    void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
  }
}
