import type { AIClient, SkillManifest } from "../types.js";

export function buildAiClient(_manifest: SkillManifest): AIClient {
  return {
    complete: async () => {
      throw new Error(
        "ctx.ai.complete() not yet implemented. Pending step 5 of skill refactor (api/agent/auto modes).",
      );
    },
  };
}
