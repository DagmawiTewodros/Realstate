import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";

/** An expected error with a stable code that clients can rely on. */
export class AppError extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super({ code, message: message ?? code, details }, status);
  }
}

export const badRequest = (code: string, message?: string, details?: unknown) => new AppError(400, code, message, details);
export const notFound = (code = "NOT_FOUND", message?: string) => new AppError(404, code, message);
export const conflict = (code: string, message?: string, details?: unknown) => new AppError(409, code, message, details);
export const forbidden = (code = "FORBIDDEN", message?: string) => new AppError(403, code, message);

/** Turns every error into { code, message } with no stack traces. Unexpected errors are logged with the request id. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Errors");

  constructor(private readonly onUnexpected?: (error: unknown, requestId: string) => void) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = req?.requestId ?? "-";

    if (exception instanceof ZodError) {
      res.status(400).json({ code: "VALIDATION_FAILED", message: "Some fields are not valid", issues: exception.issues, requestId });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "object" && body !== null && "code" in body) {
        res.status(status).json({ ...(body as object), requestId });
        return;
      }
      const message = typeof body === "string" ? body : ((body as { message?: unknown }).message ?? exception.message);
      res.status(status).json({ code: codeForStatus(status), message, requestId });
      return;
    }
    const pgCode = (exception as { code?: string })?.code;
    if (pgCode === "23505") {
      res.status(409).json({ code: "DUPLICATE", message: "A record with the same unique value already exists", requestId });
      return;
    }
    if (pgCode === "23P01") {
      res.status(409).json({ code: "OVERLAP", message: "This overlaps an existing record", requestId });
      return;
    }
    this.logger.error(`[${requestId}] ${exception instanceof Error ? exception.stack : String(exception)}`);
    this.onUnexpected?.(exception, requestId);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ code: "INTERNAL_ERROR", message: "Something went wrong", requestId });
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 413:
      return "FILE_TOO_LARGE";
    case 429:
      return "TOO_MANY_REQUESTS";
    default:
      return "ERROR";
  }
}
