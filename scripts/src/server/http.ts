import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

export type ApiResponse<T> = { success: true; data: T } | { success: false; error: string };

/** Domain error whose message is safe to surface and whose status maps to HTTP. */
export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Reads a required path param (typed as string; throws 400 if somehow absent). */
export function param(c: Context, name: string): string {
  const value = c.req.param(name);
  if (value === undefined) throw new ApiError(400, `Missing path param: ${name}`);
  return value;
}

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json<ApiResponse<T>>({ success: true, data }, status);
}

export function fail(c: Context, error: string, status: ContentfulStatusCode = 400) {
  return c.json<ApiResponse<never>>({ success: false, error }, status);
}

/**
 * Wraps an async handler so thrown ApiErrors become structured responses and
 * unexpected errors become a generic 500 (without leaking internals to the client).
 */
export function handle(fn: (c: Context) => Promise<Response>) {
  return async (c: Context): Promise<Response> => {
    try {
      return await fn(c);
    } catch (err) {
      if (err instanceof ApiError) return fail(c, err.message, err.status);
      if (err instanceof z.ZodError) {
        const msg = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        return fail(c, `Invalid request: ${msg}`, 400);
      }
      console.error("[panel] unhandled error:", err);
      return fail(c, "Internal error", 500);
    }
  };
}
