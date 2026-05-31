import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";

const TOKEN = "test-token";
const app = createApp(TOKEN);

describe("panel API", () => {
  it("lists skills (read, no token needed)", async () => {
    const res = await app.request("/api/skills");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    const ids = json.data.map((s: { id: string }) => s.id);
    expect(ids).toContain("hn");
    expect(ids).toContain("readwise");
  });

  it("blocks a cross-site Origin (CSRF / DNS-rebinding guard)", async () => {
    const res = await app.request("/api/skills", { headers: { origin: "http://evil.example.com" } });
    expect(res.status).toBe(403);
  });

  it("rejects a write without the panel token", async () => {
    const res = await app.request("/api/skills", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4319", "content-type": "application/json" },
      body: JSON.stringify({ id: "should-not-create", title: "Nope" }),
    });
    expect(res.status).toBe(401);
  });
});
