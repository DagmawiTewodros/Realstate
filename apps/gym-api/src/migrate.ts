import { migrate } from "drizzle-orm/node-postgres/migrator";
import { join } from "node:path";
import { createDatabase } from "@platform/nest-common";

/** Applies all pending migrations from ./drizzle. Safe to run on every deploy. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { pool, db } = createDatabase(databaseUrl, 1);
  try {
    await migrate(db, { migrationsFolder: join(__dirname, "..", "drizzle") });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.warn("Migrations applied");
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
}
