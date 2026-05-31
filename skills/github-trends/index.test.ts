import { describe, expect, it } from "vitest";
import { findSkill, loadRegistry } from "../../scripts/src/kernel/registry.js";

describe("github-trends skill", () => {
  it("is discovered with a valid manifest matching its folder", async () => {
    const entry = findSkill(await loadRegistry(), "github-trends");
    expect(entry).toBeDefined();
    expect(entry?.manifest.id).toBe("github-trends");
  });

  it("exports a default run function", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.default).toBe("function");
  });
});
