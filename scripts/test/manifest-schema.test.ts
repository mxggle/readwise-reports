import { describe, expect, it } from "vitest";
import { SkillManifestSchema } from "../src/kernel/types.js";

describe("SkillManifestSchema", () => {
  it("accepts the minimum manifest (id + title) and fills defaults", () => {
    const parsed = SkillManifestSchema.parse({ id: "minimal", title: "Min" });
    expect(parsed.enabled).toBe(true);
    expect(parsed.ai.mode).toBe("auto");
    expect(parsed.ai.provider).toBe("openai");
    expect(parsed.ai.outputLanguage).toBe("en-US");
    expect(parsed.schedule.timezone).toBe("UTC");
    expect(parsed.schedule.lookbackHours).toBe(24);
    expect(parsed.digest.maxItems).toBe(50);
    expect(parsed.notification.channels).toEqual([]);
  });

  it("rejects ids with invalid characters", () => {
    expect(() => SkillManifestSchema.parse({ id: "Not_Kebab", title: "x" })).toThrow();
    expect(() => SkillManifestSchema.parse({ id: "1starts-with-digit", title: "x" })).toThrow();
    expect(() => SkillManifestSchema.parse({ id: "kebab-ok", title: "x" })).not.toThrow();
  });

  it("rejects unknown top-level fields (strict)", () => {
    expect(() => SkillManifestSchema.parse({ id: "x", title: "x", outputt: { dir: "docs/x" } })).toThrow();
  });

  it("rejects invalid ai.mode (catches typos like agnet)", () => {
    expect(() => SkillManifestSchema.parse({ id: "x", title: "x", ai: { mode: "agnet" } })).toThrow();
  });

  it("rejects unknown fields inside nested objects", () => {
    expect(() => SkillManifestSchema.parse({ id: "x", title: "x", ai: { mode: "auto", weird: true } })).toThrow();
  });

  it("rejects negative lookbackHours", () => {
    expect(() => SkillManifestSchema.parse({ id: "x", title: "x", schedule: { lookbackHours: -1 } })).toThrow();
  });
});
