import { defineTool } from "eve/tools";
import { z } from "zod";
import { targetRepos } from "../lib/gh.ts";
import { selectMemoryProvider } from "../lib/memory-provider.ts";

export default defineTool({
  description:
    "Read the agent's persistent memory (one document per repo, backed by GitHub gists or local files per MEMORY_PROVIDER); creates any that are missing. Returns one entry per repo in `memories`, each with a `ref` to pass back to write-memory.",
  inputSchema: z.object({}),
  async execute() {
    const repos = targetRepos();
    if (repos.length === 0)
      return { ok: false as const, reason: "TARGET_REPO env is required (comma-delimited owner/name list)" };
    return selectMemoryProvider(process.env).read(repos);
  },
});
