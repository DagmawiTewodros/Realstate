import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import type { BaseConfig } from "./config";
import { AllExceptionsFilter } from "./errors";
import { requestIdMiddleware, securityHeadersMiddleware } from "./request-id";
import { AlertService } from "./alerts";

/** Applies the same HTTP setup to both APIs and to tests: cookies, request ids, headers, CORS, errors. */
export function configureApp(app: INestApplication, config: BaseConfig): void {
  const express = app as NestExpressApplication;
  express.set("trust proxy", 1);
  express.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(cookieParser());
  const origins = config.CORS_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false, credentials: true });
  const alerts = app.get(AlertService);
  app.useGlobalFilters(new AllExceptionsFilter((error, requestId) => alerts.reportError(error, requestId)));
  app.enableShutdownHooks();
}
