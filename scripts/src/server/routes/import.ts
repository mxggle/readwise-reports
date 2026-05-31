import { Hono } from "hono";
import { z } from "zod";
import { ApiError, handle, ok } from "../http.js";
import { importFromFolder, importFromZip } from "../services/importer.js";

const FolderSchema = z.object({ kind: z.literal("folder"), path: z.string().min(1) });

export function importRoutes(): Hono {
  const app = new Hono();

  app.post(
    "/",
    handle(async (c) => {
      const contentType = c.req.header("content-type") ?? "";

      if (contentType.includes("multipart/form-data")) {
        const body = await c.req.parseBody();
        const file = body["file"];
        if (!(file instanceof File)) throw new ApiError(400, "Expected a 'file' upload (zip)");
        const buf = new Uint8Array(await file.arrayBuffer());
        const result = await importFromZip(buf);
        return ok(c, { id: result.id }, 201);
      }

      const parsed = FolderSchema.parse(await c.req.json());
      const result = await importFromFolder(parsed.path);
      return ok(c, { id: result.id }, 201);
    }),
  );

  return app;
}
