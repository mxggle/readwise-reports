import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SkillManifestSchema } from "../../kernel/types.js";
import { ApiError } from "../http.js";
import { resolveSkillDir } from "../paths.js";

export interface FileNode {
  name: string;
  path: string; // relative to the skill dir
  type: "file" | "dir";
  children?: FileNode[];
}

const IGNORED = new Set(["node_modules", ".DS_Store"]);

/** Recursive file tree for a skill, relative paths only. */
export async function fileTree(id: string): Promise<FileNode[]> {
  const root = resolveSkillDir(id);
  async function walk(dir: string, rel: string): Promise<FileNode[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nodes: FileNode[] = [];
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (IGNORED.has(e.name)) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        nodes.push({ name: e.name, path: relPath, type: "dir", children: await walk(path.join(dir, e.name), relPath) });
      } else {
        nodes.push({ name: e.name, path: relPath, type: "file" });
      }
    }
    return nodes.sort((a, b) => (a.type === b.type ? 0 : a.type === "dir" ? -1 : 1));
  }
  return walk(root, "");
}

/** Resolve a path inside a skill dir, refusing traversal outside it. */
function resolveInside(id: string, relPath: string): string {
  const root = resolveSkillDir(id);
  const full = path.resolve(root, relPath);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new ApiError(400, "Path escapes the skill directory");
  }
  return full;
}

export async function readSkillFile(id: string, relPath: string): Promise<string> {
  const full = resolveInside(id, relPath);
  try {
    if ((await stat(full)).isDirectory()) throw new ApiError(400, "Path is a directory");
    return await readFile(full, "utf8");
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(404, `File not found: ${relPath}`);
  }
}

export async function writeSkillFile(id: string, relPath: string, content: string): Promise<void> {
  const full = resolveInside(id, relPath);
  // Keep skill.json valid: never let the UI save a manifest that breaks the registry.
  if (path.basename(full) === "skill.json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ApiError(400, "skill.json must be valid JSON");
    }
    const manifest = SkillManifestSchema.safeParse(parsed);
    if (!manifest.success) throw new ApiError(400, `Invalid manifest: ${manifest.error.issues[0]?.message ?? "unknown"}`);
    if (manifest.data.id !== id) throw new ApiError(400, `manifest id must stay "${id}"`);
  }
  await writeFile(full, content, "utf8");
}
