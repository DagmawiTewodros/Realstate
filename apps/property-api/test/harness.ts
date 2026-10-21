import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import request from "supertest";
import { addisInstant } from "@platform/shared";
import {
  CapturingTransport,
  configureApp,
  DB,
  FakeClock,
  OutboxDispatcher,
  RateLimiter,
  users,
  type Database,
} from "@platform/nest-common";
import { AppModule } from "../src/app.module";
import { loadPropertyConfig } from "../src/config";
import { TEST_ENV } from "./env";

export const PASSWORD = "correct-horse-battery";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

/** 09:00 on Thursday 22 October 2026, Addis Ababa time. */
export const START = addisInstant("2026-10-22", 9, 0);

export type Agent = ReturnType<typeof request.agent>;

export interface TestApp {
  app: INestApplication;
  db: Database;
  clock: FakeClock;
  telegram: CapturingTransport;
  email: CapturingTransport;
  http: () => ReturnType<typeof request>;
  agent: () => Agent;
  reset: () => Promise<void>;
  createUser: (role: string, overrides?: Partial<typeof users.$inferInsert>) => Promise<typeof users.$inferSelect>;
  as: (role: string, overrides?: Partial<typeof users.$inferInsert>) => Promise<{ agent: Agent; user: typeof users.$inferSelect }>;
  dispatch: () => Promise<number>;
  close: () => Promise<void>;
}

let counter = 0;

export async function createTestApp(envOverrides: Record<string, string> = {}): Promise<TestApp> {
  const config = loadPropertyConfig({ ...TEST_ENV, ...envOverrides });
  const clock = new FakeClock(START);
  const telegram = new CapturingTransport("TELEGRAM");
  const email = new CapturingTransport("EMAIL");
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ config, clock, transports: [telegram, email] })],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: ["error"] });
  configureApp(app, config);
  await app.init();
  const db = app.get<Database>(DB);
  const server = app.getHttpServer();

  const createUser: TestApp["createUser"] = async (role, overrides = {}) => {
    counter += 1;
    const [u] = await db
      .insert(users)
      .values({ name: `${role} ${counter}`, email: `${role.toLowerCase()}${counter}@test.local`, role, passwordHash: PASSWORD_HASH, ...overrides })
      .returning();
    return u;
  };

  return {
    app,
    db,
    clock,
    telegram,
    email,
    http: () => request(server),
    agent: () => request.agent(server),
    reset: async () => {
      const tables = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
      const names = (tables.rows as Array<{ tablename: string }>).map((r) => `"${r.tablename}"`).join(", ");
      if (names) await db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`));
      app.get(RateLimiter).reset();
      clock.set(START);
      telegram.sent.length = 0;
      email.sent.length = 0;
    },
    createUser,
    as: async (role, overrides = {}) => {
      const user = await createUser(role, overrides);
      const agent = request.agent(server);
      const res = await agent.post("/auth/login").send({ email: user.email, password: PASSWORD });
      if (res.status !== 200) throw new Error(`Login failed for ${role}: ${res.status} ${JSON.stringify(res.body)}`);
      return { agent, user };
    },
    dispatch: () => app.get(OutboxDispatcher).dispatchOnce(),
    close: () => app.close(),
  };
}

/** A tiny valid JPEG (1x1 pixel). */
export const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
