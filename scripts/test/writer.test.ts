import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildWriter } from "../src/kernel/services/writer.js";
import type { SkillPaths } from "../src/kernel/types.js";

async function withTempPaths(fn: (paths: SkillPaths, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "writer-test-"));
  const paths: SkillPaths = {
    outputDir: path.join(root, "docs"),
    rawDir: path.join(root, "raw"),
    generatedDir: root,
  };
  try {
    await fn(paths, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("writer", () => {
  it("writes report and raw files in normal mode", async () => {
    await withTempPaths(async (paths) => {
      const writer = buildWriter("2026-05-29", paths, false);
      const reportPath = await writer.writeReport("# hello");
      const rawPath = await writer.writeRaw({ a: 1 });

      expect(await readFile(reportPath, "utf8")).toBe("# hello");
      expect(JSON.parse(await readFile(rawPath, "utf8"))).toEqual({ a: 1 });
    });
  });

  it("writes nothing to disk in dry-run mode but still returns the paths", async () => {
    await withTempPaths(async (paths) => {
      const writer = buildWriter("2026-05-29", paths, true);
      const reportPath = await writer.writeReport("# hello");
      const rawPath = await writer.writeRaw({ a: 1 });

      // paths are returned for logging...
      expect(reportPath).toContain("2026-05-29.md");
      expect(rawPath).toContain("2026-05-29.json");
      // ...but no file exists on disk
      await expect(readFile(reportPath, "utf8")).rejects.toThrow();
      await expect(readFile(rawPath, "utf8")).rejects.toThrow();
    });
  });
});
