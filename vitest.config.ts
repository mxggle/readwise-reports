import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Don't run tests that belong to trashed skills.
    exclude: ["node_modules/**", "dist/**", "site/**", ".trash/**"],
  },
});
