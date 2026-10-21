import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const logger = new Logger("HTTP");

/** Adds a request id to every request and logs method, path, status and time. Never logs bodies. */
export function requestIdMiddleware(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  const started = Date.now();
  res.on("finish", () => {
    if (process.env.NODE_ENV === "test") return;
    logger.log(JSON.stringify({ requestId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started }));
  });
  next();
}

/** Basic security headers (the API serves JSON and files only). */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.removeHeader("X-Powered-By");
  next();
}
