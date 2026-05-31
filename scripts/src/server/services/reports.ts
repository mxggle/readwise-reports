import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { docsRoot } from "../paths.js";
import { ApiError } from "../http.js";

const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

/** Report dates for a skill, newest first. */
export async function listReportDates(id: string): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(path.join(docsRoot, id));
  } catch {
    return [];
  }
  return files
    .map((f) => DATE_RE.exec(f)?.[1])
    .filter((d): d is string => Boolean(d))
    .sort()
    .reverse();
}

export async function latestReportDate(id: string): Promise<string | undefined> {
  return (await listReportDates(id))[0];
}

export async function readReport(id: string, date: string): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, "Invalid date");
  try {
    return await readFile(path.join(docsRoot, id, `${date}.md`), "utf8");
  } catch {
    throw new ApiError(404, `No report for ${id} on ${date}`);
  }
}
