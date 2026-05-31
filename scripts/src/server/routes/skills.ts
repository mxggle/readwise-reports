import { spawn } from "node:child_process";
import { Hono } from "hono";
import { z } from "zod";
import { findSkill, loadRegistry } from "../../kernel/registry.js";
import { describeSkillStatus } from "../../kernel/status.js";
import { ApiError, handle, ok, param } from "../http.js";
import { fileTree, readSkillFile, writeSkillFile } from "../services/files.js";
import { setSkillEnabled } from "../services/manifest.js";
import { latestReportDate, listReportDates, readReport } from "../services/reports.js";
import { getRunRecord, isSkillRunning, listRuns, startRun } from "../services/runner.js";
import { trashSkill } from "../services/trash.js";

const PatchSchema = z.object({ enabled: z.boolean() });
const RunSchema = z.object({
  dryRun: z.boolean().default(false),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const WriteFileSchema = z.object({ path: z.string().min(1), content: z.string() });

function requireEnv(required: string[]): { name: string; present: boolean }[] {
  return required.map((name) => ({ name, present: Boolean(process.env[name]) }));
}

export function skillsRoutes(): Hono {
  const app = new Hono();

  app.get(
    "/",
    handle(async (c) => {
      const entries = await loadRegistry();
      const data = await Promise.all(
        entries.map(async (e) => ({
          id: e.manifest.id,
          title: e.manifest.title,
          description: e.manifest.description ?? null,
          enabled: e.manifest.enabled !== false,
          status: describeSkillStatus(e),
          running: isSkillRunning(e.manifest.id),
          lastReport: (await latestReportDate(e.manifest.id)) ?? null,
        })),
      );
      return ok(c, data);
    }),
  );

  app.get(
    "/:id",
    handle(async (c) => {
      const id = param(c, "id");
      const entry = findSkill(await loadRegistry(), id);
      if (!entry) throw new ApiError(404, `Skill "${id}" not found`);
      return ok(c, {
        manifest: entry.manifest,
        status: describeSkillStatus(entry),
        running: isSkillRunning(id),
        env: requireEnv(entry.manifest.env?.required ?? []),
        tree: await fileTree(id),
        reports: await listReportDates(id),
        runs: await listRuns(id),
      });
    }),
  );

  // Read a file inside the skill (prompts, skill.json, index.ts, ...).
  app.get(
    "/:id/file",
    handle(async (c) => {
      const id = param(c, "id");
      const rel = c.req.query("path");
      if (!rel) throw new ApiError(400, "path query param required");
      return ok(c, { id, path: rel, content: await readSkillFile(id, rel) });
    }),
  );

  // Edit a file inside the skill (manifest is schema-validated on save).
  app.put(
    "/:id/file",
    handle(async (c) => {
      const id = param(c, "id");
      const body = WriteFileSchema.parse(await c.req.json());
      await writeSkillFile(id, body.path, body.content);
      return ok(c, { id, path: body.path });
    }),
  );

  // Open the skill folder in the local editor ($EDITOR or VS Code).
  app.post(
    "/:id/open",
    handle(async (c) => {
      const id = param(c, "id");
      const entry = findSkill(await loadRegistry(), id);
      if (!entry) throw new ApiError(404, `Skill "${id}" not found`);
      const editor = process.env.EDITOR || "code";
      try {
        const child = spawn(editor, [entry.skillDir], { detached: true, stdio: "ignore" });
        child.unref();
      } catch (err) {
        throw new ApiError(500, `Could not launch "${editor}": ${err instanceof Error ? err.message : String(err)}`);
      }
      return ok(c, { opened: true, editor });
    }),
  );

  // Past run records (newest first).
  app.get(
    "/:id/runs",
    handle(async (c) => {
      const id = param(c, "id");
      return ok(c, await listRuns(id));
    }),
  );

  // Full stored log for one past run.
  app.get(
    "/:id/runs/:runId",
    handle(async (c) => {
      const id = param(c, "id");
      const record = await getRunRecord(id, param(c, "runId"));
      if (!record) throw new ApiError(404, "Run record not found");
      return ok(c, record);
    }),
  );

  app.patch(
    "/:id",
    handle(async (c) => {
      const id = param(c, "id");
      const { enabled } = PatchSchema.parse(await c.req.json());
      await setSkillEnabled(id, enabled);
      return ok(c, { id, enabled });
    }),
  );

  app.delete(
    "/:id",
    handle(async (c) => {
      const id = param(c, "id");
      const dest = await trashSkill(id);
      return ok(c, { id, trashedTo: dest });
    }),
  );

  app.post(
    "/:id/run",
    handle(async (c) => {
      const id = param(c, "id");
      const entry = findSkill(await loadRegistry(), id);
      if (!entry) throw new ApiError(404, `Skill "${id}" not found`);
      const body = RunSchema.parse(await c.req.json().catch(() => ({})));
      const run = startRun({ skillId: id, dryRun: body.dryRun, date: body.date });
      return ok(c, { runId: run.id }, 202);
    }),
  );

  app.get(
    "/:id/report",
    handle(async (c) => {
      const id = param(c, "id");
      const date = c.req.query("date");
      if (!date) throw new ApiError(400, "date query param required");
      const markdown = await readReport(id, date);
      return ok(c, { id, date, markdown });
    }),
  );

  return app;
}
