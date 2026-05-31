import { access, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { resolveSkillDir, trashRoot } from "../paths.js";
import { ApiError } from "../http.js";

/** Move a skill folder into `.trash/{timestamp}-{id}/` instead of deleting it. */
export async function trashSkill(id: string): Promise<string> {
  const skillDir = resolveSkillDir(id);
  try {
    await access(skillDir);
  } catch {
    throw new ApiError(404, `Skill "${id}" not found`);
  }

  await mkdir(trashRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(trashRoot, `${stamp}-${id}`);
  await rename(skillDir, dest);
  return dest;
}
