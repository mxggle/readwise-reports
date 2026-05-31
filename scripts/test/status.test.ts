import { describe, expect, it } from "vitest";
import type { SkillEntry } from "../src/kernel/registry.js";
import { describeSkillStatus } from "../src/kernel/status.js";
import { SkillManifestSchema } from "../src/kernel/types.js";

function entry(overrides: Record<string, unknown> = {}): SkillEntry {
  const manifest = SkillManifestSchema.parse({ id: "t", title: "T", ...overrides });
  return { manifest, skillDir: "/x", entryPath: "/x/index.ts" };
}

describe("describeSkillStatus", () => {
  it("is ready when enabled and no env required", () => {
    expect(describeSkillStatus(entry(), {})).toEqual({ kind: "ready" });
  });

  it("is disabled when manifest.enabled === false", () => {
    expect(describeSkillStatus(entry({ enabled: false }), {})).toEqual({ kind: "disabled" });
  });

  it("reports missing env vars", () => {
    const status = describeSkillStatus(entry({ env: { required: ["FOO", "BAR"] } }), { FOO: "1" });
    expect(status).toEqual({ kind: "missing-env", missing: ["BAR"] });
  });

  it("is ready when all required env vars are present", () => {
    const status = describeSkillStatus(entry({ env: { required: ["FOO"] } }), { FOO: "1" });
    expect(status).toEqual({ kind: "ready" });
  });

  it("treats disabled as disabled even if env is missing", () => {
    const status = describeSkillStatus(entry({ enabled: false, env: { required: ["FOO"] } }), {});
    expect(status).toEqual({ kind: "disabled" });
  });
});
