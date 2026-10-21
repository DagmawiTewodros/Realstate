import { DynamicModule, Global, Module, OnApplicationShutdown, Inject, Provider } from "@nestjs/common";
import { APP_GUARD, DiscoveryModule } from "@nestjs/core";
import type { Pool } from "pg";
import { APP_CONFIG, CLOCK, DB, DB_POOL, MESSAGE_TEMPLATES, MESSAGE_TRANSPORTS, PLATFORM_OPTIONS } from "./tokens";
import type { BaseConfig } from "./config";
import { createDatabase } from "./db";
import { SystemClock, type Clock } from "./clock";
import type { PlatformOptions } from "./options";
import { AuditService } from "./audit";
import { RateLimiter } from "./rate-limit";
import { AuthService } from "./auth/auth.service";
import { AuthGuard } from "./auth/auth.guard";
import { AuthController } from "./auth/auth.controller";
import { UsersController } from "./auth/users.controller";
import { ConsentService } from "./consent";
import { MessageService } from "./messaging";
import { OutboxDispatcher, OutboxService } from "./outbox";
import { AlertService } from "./alerts";
import { StorageService } from "./storage";
import { CounterService } from "./counters";
import { ReminderLogService } from "./reminders";
import { SettingsService } from "./settings";
import { InvitationService } from "./invitations";
import { HealthController, InternalController, MessageLogController, OptOutController } from "./controllers";
import { EmailTransport, LogTransport, TelegramTransport, type MessageTransport } from "./transports";
import type { TemplateSet } from "./templates";

export interface PlatformModuleOptions {
  config: BaseConfig;
  options: PlatformOptions;
  templates: TemplateSet;
  /** App providers for CONTACT_RESOLVER and AUTOMATION_RULES, plus any overrides. */
  providers?: Provider[];
  clock?: Clock;
  transports?: MessageTransport[];
}

export function defaultTransports(config: BaseConfig): MessageTransport[] {
  return [
    config.TELEGRAM_BOT_TOKEN ? new TelegramTransport(config.TELEGRAM_BOT_TOKEN) : new LogTransport("TELEGRAM"),
    config.SMTP_HOST
      ? new EmailTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, user: config.SMTP_USER || undefined, password: config.SMTP_PASSWORD || undefined }, config.SMTP_FROM)
      : new LogTransport("EMAIL"),
  ];
}

const SERVICES = [
  AuditService,
  RateLimiter,
  AuthService,
  ConsentService,
  MessageService,
  OutboxService,
  OutboxDispatcher,
  AlertService,
  StorageService,
  CounterService,
  ReminderLogService,
  SettingsService,
  InvitationService,
];

/** Everything both APIs share: database, sign-in and roles, audit, outbox, consent, messaging, storage. */
@Global()
@Module({})
export class PlatformModule implements OnApplicationShutdown {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  static forRoot(input: PlatformModuleOptions): DynamicModule {
    const { pool, db } = createDatabase(input.config.DATABASE_URL);
    const providers: Provider[] = [
      { provide: APP_CONFIG, useValue: input.config },
      { provide: PLATFORM_OPTIONS, useValue: input.options },
      { provide: DB_POOL, useValue: pool },
      { provide: DB, useValue: db },
      { provide: CLOCK, useValue: input.clock ?? new SystemClock() },
      { provide: MESSAGE_TEMPLATES, useValue: input.templates },
      { provide: MESSAGE_TRANSPORTS, useValue: input.transports ?? defaultTransports(input.config) },
      { provide: APP_GUARD, useClass: AuthGuard },
      ...SERVICES,
      ...(input.providers ?? []),
    ];
    return {
      module: PlatformModule,
      imports: [DiscoveryModule],
      controllers: [AuthController, UsersController, HealthController, InternalController, OptOutController, MessageLogController],
      providers,
      exports: [APP_CONFIG, PLATFORM_OPTIONS, DB, DB_POOL, CLOCK, MESSAGE_TEMPLATES, MESSAGE_TRANSPORTS, ...SERVICES, ...(input.providers ?? [])],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
