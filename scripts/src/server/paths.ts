import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root: scripts/src/server -> up 3. */
export const repoRoot = path.resolve(here, "..", "..", "..");
export const skillsRoot = path.join(repoRoot, "skills");
export const docsRoot = path.join(repoRoot, "docs");
export const trashRoot = path.join(repoRoot, ".trash");
export const panelDir = path.join(repoRoot, "panel");
export const templatesDir = path.join(here, "templates");
export const cliEntry = path.join(repoRoot, "scripts", "src", "cli.ts");

/** Resolve a skill folder under `root`, refusing anything that escapes it. */
export function resolveSkillDir(id: string, root: string = skillsRoot): string {
  const base = path.resolve(root);
  const dir = path.resolve(base, id);
  if (path.dirname(dir) !== base) {
    throw new Error(`Illegal skill id: ${id}`);
  }
  return dir;
}
