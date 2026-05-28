import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SkillPaths, SkillWriter } from "../types.js";

export function buildWriter(date: string, paths: SkillPaths): SkillWriter {
  return {
    writeReport: async (body) => {
      const outputPath = path.join(paths.outputDir, `${date}.md`);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, body);
      return outputPath;
    },
    writeRaw: async (data) => {
      const outputPath = path.join(paths.rawDir, `${date}.json`);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(data, null, 2));
      return outputPath;
    },
  };
}
