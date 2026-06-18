import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["agent/lib/**/*.test.ts"], environment: "node" },
});
