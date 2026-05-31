import type { MiddlewareHandler } from "hono";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    // Host header is "host:port", not a full URL.
    return value.replace(/:\d+$/, "");
  }
}

/**
 * Blocks DNS-rebinding and cross-site requests: only localhost Host/Origin are
 * allowed. A page on attacker.com cannot drive this shell-capable backend even
 * though it binds 127.0.0.1.
 */
export const originGuard: MiddlewareHandler = async (c, next) => {
  const host = hostnameOf(c.req.header("host"));
  if (host && !LOCAL_HOSTS.has(host)) {
    return c.json({ success: false, error: "Forbidden host" }, 403);
  }
  const origin = c.req.header("origin");
  if (origin) {
    const oh = hostnameOf(origin);
    if (!oh || !LOCAL_HOSTS.has(oh)) {
      return c.json({ success: false, error: "Forbidden origin" }, 403);
    }
  }
  await next();
};
