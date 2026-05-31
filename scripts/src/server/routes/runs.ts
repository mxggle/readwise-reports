import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ApiError, handle, ok, param } from "../http.js";
import { cancelRun, getRun } from "../services/runner.js";

export function runsRoutes(): Hono {
  const app = new Hono();

  app.get("/:runId/stream", (c) => {
    const run = getRun(c.req.param("runId"));
    if (!run) return c.json({ success: false, error: "Run not found" }, 404);

    return streamSSE(c, async (stream) => {
      // Replay everything emitted so far, then follow live until exit.
      for (const line of run.history) {
        await stream.writeSSE({ event: "log", data: line });
      }
      if (run.status === "done") {
        await stream.writeSSE({ event: "exit", data: String(run.exitCode ?? "") });
        return;
      }

      await new Promise<void>((resolve) => {
        const onLog = (line: string) => {
          void stream.writeSSE({ event: "log", data: line });
        };
        const cleanup = () => {
          run.off("log", onLog);
          run.off("exit", onExit);
        };
        const onExit = (code: number | null) => {
          void stream.writeSSE({ event: "exit", data: String(code ?? "") }).then(() => {
            cleanup();
            resolve();
          });
        };
        run.on("log", onLog);
        run.once("exit", onExit);
        stream.onAbort(() => {
          cleanup();
          resolve();
        });
      });
    });
  });

  app.delete(
    "/:runId",
    handle(async (c) => {
      if (!cancelRun(param(c, "runId"))) throw new ApiError(404, "Run not found");
      return ok(c, { cancelled: true });
    }),
  );

  return app;
}
