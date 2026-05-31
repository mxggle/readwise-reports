import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Requires a per-boot token on all mutating requests (CSRF defense-in-depth on
 * top of the origin guard). The token is injected into the served panel page.
 */
export function tokenGuard(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (c.req.header("x-panel-token") !== token) {
      return c.json({ success: false, error: "Invalid or missing panel token" }, 401);
    }
    await next();
  };
}
