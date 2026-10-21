import { Client } from "pg";
import { runMigrations } from "../src/migrate";
import { TEST_DATABASE_URL } from "./env";

/** Creates an empty test database and applies every migration, exactly as production does. */
export default async function globalSetup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();
  await runMigrations(TEST_DATABASE_URL);
}
