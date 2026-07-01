import { defineTool } from "eve/tools";
import { z } from "zod";
import { targetRepos } from "../lib/gh.ts";
import { initialMemory, memoryDir, memoryFilename } from "../lib/memory.ts";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// Read one repo's memory file, seeding it with the initial template on first run
// (ENOENT). Keyed by repo (the file name), so a failure for one repo doesn't
// sink the others.
async function resolveMemory(
  repo: string,
): Promise<
  | { repo: string; ok: true; content: string; created: boolean }
  | { repo: string; ok: false; reason: string }
> {
  const path = join(memoryDir(), memoryFilename(repo));
  try {
    return { repo, ok: true as const, content: await readFile(path, "utf8"), created: false };
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT") {
      return { repo, ok: false as const, reason: (err as Error).message };
    }
    try {
      const content = initialMemory(repo);
      await writeFile(path, content, "utf8");
      return { repo, ok: true as const, content, created: true };
    } catch (writeErr) {
      return { repo, ok: false as const, reason: (writeErr as Error).message };
    }
  }
}

export default defineTool({
  description:
    "Read the agent's persistent memory (one local markdown file per repo, on a persistent volume); creates any that are missing. Returns one entry per repo in `memories`, each with { repo, content }.",
  inputSchema: z.object({}),
  async execute() {
    const repos = targetRepos();
    if (repos.length === 0)
      return { ok: false as const, reason: "TARGET_REPO env is required (comma-delimited owner/name list)" };
    await mkdir(memoryDir(), { recursive: true });
    const memories = await Promise.all(repos.map((repo) => resolveMemory(repo)));
    return { ok: true as const, memories };
  },
});
