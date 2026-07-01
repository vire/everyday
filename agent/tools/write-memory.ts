import { defineTool } from "eve/tools";
import { z } from "zod";
import { memoryDir, memoryFilename } from "../lib/memory.ts";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

async function writeOne(
  repo: string,
  content: string,
): Promise<{ repo: string; ok: true } | { repo: string; ok: false; reason: string }> {
  try {
    await writeFile(join(memoryDir(), memoryFilename(repo)), content, "utf8");
    return { repo, ok: true as const };
  } catch (err) {
    return { repo, ok: false as const, reason: (err as Error).message };
  }
}

export default defineTool({
  description:
    "Overwrite the agent's persistent memory files — one entry per repo. Pass each repo (the slug from read-memory) with its updated memory markdown.",
  inputSchema: z.object({
    memories: z
      .array(z.object({ repo: z.string(), content: z.string() }))
      .min(1)
      .describe("one entry per repo: the repo slug returned by read-memory and the updated memory markdown"),
  }),
  async execute({ memories }) {
    await mkdir(memoryDir(), { recursive: true });
    // Write all repos' files in parallel; a failure for one is isolated to its entry.
    const results = await Promise.all(memories.map((m) => writeOne(m.repo, m.content)));
    return { ok: true as const, results };
  },
});
