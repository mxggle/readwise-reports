import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SkillPaths, SkillWriter } from "../types.js";

/**
 * In dry-run, writes are skipped entirely (no report, no raw snapshot) so a
 * dry-run never touches the working tree. The resolved path is still returned
 * so callers can log where output *would* land.
 */
export function buildWriter(date: string, paths: SkillPaths, dryRun = false): SkillWriter {
  return {
    writeReport: async (body) => {
      const outputPath = path.join(paths.outputDir, `${date}.md`);
      if (dryRun) return outputPath;
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, body);
      return outputPath;
    },
    writeRaw: async (data) => {
      const outputPath = path.join(paths.rawDir, `${date}.json`);
      if (dryRun) return outputPath;
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(data, null, 2));
      return outputPath;
    },
  };
}
