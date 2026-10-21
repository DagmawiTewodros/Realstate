import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { configureApp } from "@platform/nest-common";
import { AppModule } from "./app.module";
import { loadGymConfig } from "./config";
import { runMigrations } from "./migrate";

async function bootstrap(): Promise<void> {
  const config = loadGymConfig();
  if (process.env.MIGRATE_ON_START === "true") await runMigrations(config.DATABASE_URL);
  const app = await NestFactory.create(AppModule.register({ config }), { bodyParser: true, bufferLogs: false });
  configureApp(app, config);
  await app.listen(config.PORT);
  new Logger("Bootstrap").log(`Gym API listening on port ${config.PORT}`);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
