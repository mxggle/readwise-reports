import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SkillManifestSchema } from "../../kernel/types.js";
import { resolveSkillDir } from "../paths.js";
import { ApiError } from "../http.js";

/**
 * Flips a skill's `enabled` flag by rewriting its skill.json immutably,
 * preserving the existing (minimal) shape rather than the schema-defaulted one.
 */
export async function setSkillEnabled(id: string, enabled: boolean): Promise<void> {
  const manifestPath = path.join(resolveSkillDir(id), "skill.json");
  try {
    await access(manifestPath);
  } catch {
    throw new ApiError(404, `Skill "${id}" not found`);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new ApiError(400, "skill.json is not valid JSON");
  }

  const next = { ...raw, enabled };
  try {
    SkillManifestSchema.parse(next);
  } catch (err) {
    throw new ApiError(400, `Resulting manifest invalid: ${err instanceof Error ? err.message : String(err)}`);
  }
  await writeFile(manifestPath, JSON.stringify(next, null, 2) + "\n", "utf8");
}
