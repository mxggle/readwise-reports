import "dotenv/config";
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const token = randomBytes(24).toString("hex");
const port = Number(process.env.PANEL_PORT ?? 4319);

serve({ fetch: createApp(token).fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`\n  Skill panel  →  http://127.0.0.1:${info.port}/`);
  console.log(`  Bound to 127.0.0.1 only. Token auto-injected into the page.`);
  console.log(`  API token (for curl):  ${token}\n`);
});
