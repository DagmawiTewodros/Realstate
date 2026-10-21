import { Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import type { Channel } from "@platform/shared";
import type { LocalizedMessage } from "./templates";

export interface Contact {
  id: string;
  name: string;
  locale: "am" | "en";
  email?: string | null;
  phone?: string | null;
  telegramChatId?: string | null;
}

export interface MessageTransport {
  channel: Channel;
  /** Throws on failure. */
  send(to: Contact, message: LocalizedMessage): Promise<void>;
}

export class TelegramTransport implements MessageTransport {
  readonly channel = "TELEGRAM" as const;
  constructor(private readonly botToken: string) {}

  async send(to: Contact, message: LocalizedMessage): Promise<void> {
    if (!to.telegramChatId) throw new Error("No Telegram chat id");
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: to.telegramChatId, text: `${message.subject}\n\n${message.text}`, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Telegram returned ${res.status}`);
  }
}

export class EmailTransport implements MessageTransport {
  readonly channel = "EMAIL" as const;
  private readonly transporter: Transporter;
  constructor(
    opts: { host: string; port: number; user?: string; password?: string },
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.port === 465,
      auth: opts.user ? { user: opts.user, pass: opts.password } : undefined,
    });
  }

  async send(to: Contact, message: LocalizedMessage): Promise<void> {
    if (!to.email) throw new Error("No email address");
    await this.transporter.sendMail({ from: this.from, to: to.email, subject: message.subject, text: message.text });
  }
}

/** Used when a channel is not configured (development): logs instead of sending. */
export class LogTransport implements MessageTransport {
  private readonly logger = new Logger("Messages");
  constructor(readonly channel: Channel) {}
  async send(to: Contact, message: LocalizedMessage): Promise<void> {
    this.logger.log(`[${this.channel}] to ${to.id}: ${message.subject}`);
  }
}

/** Test transport that records what would have been sent. */
export class CapturingTransport implements MessageTransport {
  readonly sent: Array<{ to: Contact; message: LocalizedMessage }> = [];
  failNext = false;
  constructor(readonly channel: Channel) {}
  async send(to: Contact, message: LocalizedMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Simulated failure");
    }
    this.sent.push({ to, message });
  }
}
