import { describe, expect, it } from "vitest";
import { findSkill, loadRegistry } from "../src/kernel/registry.js";

describe("registry", () => {
  it("discovers all skill folders with a skill.json", async () => {
    const entries = await loadRegistry();
    const ids = entries.map((e) => e.manifest.id);
    expect(ids).toContain("readwise");
    expect(ids).toContain("hn");
  });

  it("returns entries sorted by id", async () => {
    const entries = await loadRegistry();
    const ids = entries.map((e) => e.manifest.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("applies schema defaults during parse", async () => {
    const entries = await loadRegistry();
    const rw = findSkill(entries, "readwise");
    expect(rw).toBeDefined();
    expect(rw?.manifest.enabled).toBe(true);
    expect(rw?.manifest.ai.outputLanguage).toBe("zh-CN");
    expect(rw?.manifest.schedule.timezone).toBe("Asia/Tokyo");
  });

  it("findSkill returns undefined for unknown id", async () => {
    const entries = await loadRegistry();
    expect(findSkill(entries, "totally-not-a-skill")).toBeUndefined();
  });
});
