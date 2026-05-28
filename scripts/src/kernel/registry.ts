import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillManifest } from "./types.js";

export interface SkillEntry {
  manifest: SkillManifest;
  skillDir: string;
  entryPath: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..", "..", "..", "skills");

export async function loadRegistry(): Promise<SkillEntry[]> {
  const entries: SkillEntry[] = [];
  let folders: string[];
  try {
    folders = await readdir(skillsRoot);
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  for (const folder of folders) {
    if (folder.startsWith(".") || folder.startsWith("_")) continue;
    const skillDir = path.join(skillsRoot, folder);
    const folderStat = await stat(skillDir);
    if (!folderStat.isDirectory()) continue;

    const manifestPath = path.join(skillDir, "skill.json");
    let manifestText: string;
    try {
      manifestText = await readFile(manifestPath, "utf8");
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }

    const manifest = JSON.parse(manifestText) as SkillManifest;
    if (manifest.id !== folder) {
      throw new Error(`Skill manifest id "${manifest.id}" does not match folder name "${folder}"`);
    }

    const entryPath = path.join(skillDir, "index.ts");
    entries.push({ manifest, skillDir, entryPath });
  }

  return entries.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

export function findSkill(entries: SkillEntry[], id: string): SkillEntry | undefined {
  return entries.find((e) => e.manifest.id === id);
}
