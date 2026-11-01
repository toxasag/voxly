import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError, type ZodIssue } from "zod";
import type { ApiError } from "../types/index.js";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, string[]>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, string[]>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, string[]>) {
    super(400, "VALIDATION_ERROR", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, "NOT_FOUND", message);
  }
}

export class PermissionDeniedError extends AppError {
  constructor(message = "Permission denied") {
    super(403, "PERMISSION_DENIED", message);
  }
}

// ---------------------------------------------------------------------------
// Zod formatting
// ---------------------------------------------------------------------------

/** Dotted path for a field issue; array indices are kept (`line_items.0.quantity`). */
function issuePath(issue: ZodIssue): string {
  return issue.path.length === 0 ? "_root" : issue.path.join(".");
}

/**
 * Collapses a ZodError into the documented `details` shape: one entry per
 * field, each holding every message raised for it.
 */
export function formatZodIssues(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issuePath(issue);
    const bucket = details[key];

    if (bucket === undefined) {
      details[key] = [issue.message];
    } else if (!bucket.includes(issue.message)) {
      bucket.push(issue.message);
    }
  }

  return details;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface ErrorEnvelope extends ApiError {
  status: "error";
  requestId: string;
}

/** Fastify's own schema-validation failures carry a `validation` array. */
function isFastifyValidationError(error: FastifyError): boolean {
  return Array.isArray(error.validation) && error.validation.length > 0;
}

/**
 * Normalises every thrown value into the `{ status, error }` envelope.
 *
 * ZodError is handled explicitly: route handlers call `schema.parse(...)`
 * directly, and a ZodError carries no statusCode, so without this branch it
 * fell through to the 500 path and every validation failure was reported as an
 * internal error instead of `400 VALIDATION_ERROR`.
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  let statusCode: number;
  let payload: ErrorEnvelope;
  const requestId = request.id;

  if (error instanceof ZodError) {
    statusCode = 400;
    payload = {
      status: "error",
      requestId,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: formatZodIssues(error),
      },
    };
  } else if (error instanceof AppError) {
    statusCode = error.statusCode;
    payload = {
      status: "error",
      requestId,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details }),
      },
    };
  } else if (isFastifyValidationError(error)) {
    statusCode = 400;
    payload = {
      status: "error",
      requestId,
      error: { code: "VALIDATION_ERROR", message: "Validation failed" },
    };
  } else if (error.statusCode !== undefined && error.statusCode < 500) {
    // Plugin-raised client errors (rate limit 429, unsupported media type, …)
    // keep their status and code rather than being masked as a 500.
    statusCode = error.statusCode;
    payload = {
      status: "error",
      requestId,
      error: {
        code: error.code ?? "REQUEST_ERROR",
        message: error.message,
      },
    };
  } else {
    statusCode = 500;
    payload = {
      status: "error",
      requestId,
      error: { code: "INTERNAL_SERVER_ERROR", message: "Internal server error" },
    };
  }

  if (statusCode >= 500) {
    request.log.error(error);
  }

  reply.status(statusCode).send(payload);
}
