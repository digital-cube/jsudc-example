import { z } from "zod";

/** One message on the wire: a request (`udc.<action>`) or its answer (`udc.<action>.ok|.err`). */
export interface UdcMessage<P = unknown> {
  kind: string;
  id: string;
  payload: P;
}

export const UdcMessageSchema = z.object({
  kind: z.string().min(1),
  id: z.string(),
  payload: z.unknown(),
});

export const KIND_PREFIX = "udc.";

/** `list` → `udc.list` */
export function requestKind(action: string): string {
  return `${KIND_PREFIX}${action}`;
}

/** `list` → `udc.list.ok` */
export function okKind(action: string): string {
  return `${requestKind(action)}.ok`;
}

/** `list` → `udc.list.err` */
export function errKind(action: string): string {
  return `${requestKind(action)}.err`;
}

export type KindStatus = "request" | "ok" | "err";

/** Split a kind back into its action and status; `null` when it is not a `udc.` kind. */
export function parseKind(kind: string): { action: string; status: KindStatus } | null {
  if (!kind.startsWith(KIND_PREFIX)) return null;
  const rest = kind.slice(KIND_PREFIX.length);
  if (rest.endsWith(".ok")) return { action: rest.slice(0, -3), status: "ok" };
  if (rest.endsWith(".err")) return { action: rest.slice(0, -4), status: "err" };
  return rest ? { action: rest, status: "request" } : null;
}

export const ERROR_CODES = [
  "not_found",
  "validation_error",
  "version_conflict",
  "forbidden",
  "unsupported_op",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCodeSchema = z.enum(ERROR_CODES);

export const ErrorPayloadSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

/** A typed protocol error. Thrown by the server's dispatcher and by the client on a `.err` reply. */
export class UdcError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "UdcError";
    this.code = code;
    this.details = details;
  }

  toPayload(): ErrorPayload {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }

  static fromPayload(payload: ErrorPayload): UdcError {
    return new UdcError(payload.code, payload.message, payload.details);
  }
}

export function isUdcError(err: unknown): err is UdcError {
  return err instanceof UdcError;
}

export function isVersionConflict(err: unknown): err is UdcError {
  return err instanceof UdcError && err.code === "version_conflict";
}
