import type { SkillEntry } from "./registry.js";

export type SkillStatus =
  | { kind: "ready" }
  | { kind: "disabled" }
  | { kind: "missing-env"; missing: string[] };

/**
 * Computes a skill's runnability from its manifest + the current environment.
 * Shared by the CLI (`--list`) and the management panel so the two never drift.
 */
export function describeSkillStatus(entry: SkillEntry, env: NodeJS.ProcessEnv = process.env): SkillStatus {
  const enabled = entry.manifest.enabled !== false;
  if (!enabled) return { kind: "disabled" };

  const required = entry.manifest.env?.required ?? [];
  const missing = required.filter((v) => !env[v]);
  if (missing.length > 0) return { kind: "missing-env", missing };

  return { kind: "ready" };
}

/** Human-readable one-liner, matching the CLI's previous inline format. */
export function formatSkillStatus(status: SkillStatus): string {
  switch (status.kind) {
    case "disabled":
      return "disabled";
    case "missing-env":
      return `missing env: ${status.missing.join(", ")}`;
    case "ready":
      return "ready";
  }
}
