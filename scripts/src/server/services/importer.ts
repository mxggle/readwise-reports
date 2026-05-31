import { access, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { SkillManifestSchema, type SkillManifest } from "../../kernel/types.js";
import { resolveSkillDir, skillsRoot } from "../paths.js";
import { ApiError } from "../http.js";

export interface ImportResult {
  id: string;
  skillDir: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function parseManifest(text: string): SkillManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError(400, "skill.json is not valid JSON");
  }
  try {
    return SkillManifestSchema.parse(json);
  } catch (err) {
    throw new ApiError(400, `Invalid skill.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function placeFromDir(sourceDir: string, root?: string): Promise<ImportResult> {
  const manifestPath = path.join(sourceDir, "skill.json");
  if (!(await exists(manifestPath))) {
    throw new ApiError(400, "No skill.json found at the root of the import");
  }
  if (!(await exists(path.join(sourceDir, "index.ts")))) {
    throw new ApiError(400, "No index.ts found at the root of the import");
  }
  const manifest = parseManifest(await readFile(manifestPath, "utf8"));

  const skillDir = resolveSkillDir(manifest.id, root);
  if (await exists(skillDir)) {
    throw new ApiError(409, `Skill "${manifest.id}" already exists`);
  }

  await cp(sourceDir, skillDir, { recursive: true });
  return { id: manifest.id, skillDir };
}

/** Import from a local folder path (the folder itself contains skill.json). */
export async function importFromFolder(localPath: string, root?: string): Promise<ImportResult> {
  const resolved = path.resolve(localPath);
  let st;
  try {
    st = await stat(resolved);
  } catch {
    throw new ApiError(400, `Path not found: ${localPath}`);
  }
  if (!st.isDirectory()) throw new ApiError(400, "Import path must be a directory");
  if (resolved === skillsRoot || resolved.startsWith(skillsRoot + path.sep)) {
    throw new ApiError(400, "Source folder must be outside skills/");
  }
  return placeFromDir(resolved, root);
}

/** Guard against zip-slip: reject absolute paths or any `..` segment. */
export function isSafeEntryPath(entryPath: string): boolean {
  if (path.isAbsolute(entryPath) || /^[a-zA-Z]:/.test(entryPath)) return false;
  const normalized = path.normalize(entryPath);
  return !normalized.split(/[\\/]/).includes("..");
}

/** Import from an uploaded zip archive. */
export async function importFromZip(data: Uint8Array, root?: string): Promise<ImportResult> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new ApiError(400, "Could not read zip archive");
  }

  const filePaths = Object.keys(entries).filter((p) => !p.endsWith("/"));
  for (const p of filePaths) {
    if (!isSafeEntryPath(p)) throw new ApiError(400, `Unsafe path in zip: ${p}`);
  }

  // Locate the shallowest skill.json — its directory is the skill root.
  const manifestEntry = filePaths
    .filter((p) => path.basename(p) === "skill.json")
    .sort((a, b) => a.split("/").length - b.split("/").length)[0];
  if (!manifestEntry) throw new ApiError(400, "No skill.json found in zip");

  const rootPrefix = path.dirname(manifestEntry) === "." ? "" : path.dirname(manifestEntry) + "/";
  parseManifest(Buffer.from(entries[manifestEntry]).toString("utf8")); // validate early

  const tmp = await mkdtemp(path.join(os.tmpdir(), "skill-import-"));
  try {
    for (const p of filePaths) {
      if (rootPrefix && !p.startsWith(rootPrefix)) continue;
      const rel = rootPrefix ? p.slice(rootPrefix.length) : p;
      if (!rel) continue;
      const dest = path.join(tmp, rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(entries[p]));
    }

    const result = await placeFromDir(tmp, root);
    return result;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
