import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono, type Context } from "hono";
import { originGuard } from "./middleware/origin-guard.js";
import { tokenGuard } from "./middleware/token-guard.js";
import { panelDir } from "./paths.js";
import { ok, handle } from "./http.js";
import { importRoutes } from "./routes/import.js";
import { runsRoutes } from "./routes/runs.js";
import { skillsRoutes } from "./routes/skills.js";
import { getHealth } from "./services/health.js";

export function createApp(token: string): Hono {
  const app = new Hono();
  app.use("*", originGuard);

  const api = new Hono();
  api.use("*", tokenGuard(token));
  api.get("/health", handle(async (c) => ok(c, await getHealth())));
  api.route("/skills", skillsRoutes());
  api.route("/import", importRoutes());
  api.route("/runs", runsRoutes());
  app.route("/api", api);

  const serveIndex = async (c: Context): Promise<Response> => {
    const html = await readFile(path.join(panelDir, "index.html"), "utf8");
    return c.html(html.replaceAll("__PANEL_TOKEN__", token));
  };
  app.get("/", serveIndex);
  app.get("/index.html", serveIndex);
  app.get("/app.js", async (c) =>
    c.body(await readFile(path.join(panelDir, "app.js"), "utf8"), 200, { "content-type": "text/javascript; charset=utf-8" }),
  );
  app.get("/styles.css", async (c) =>
    c.body(await readFile(path.join(panelDir, "styles.css"), "utf8"), 200, { "content-type": "text/css; charset=utf-8" }),
  );

  return app;
}
