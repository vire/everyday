import { defineTool } from "eve/tools";
import { z } from "zod";
import { gh } from "../lib/gh.ts";
import { MEMORY_FILENAME } from "../lib/memory.ts";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function writeOne(
  gistId: string,
  content: string,
): Promise<{ gistId: string; ok: true } | { gistId: string; ok: false; reason: string }> {
  const dir = await mkdtemp(join(tmpdir(), "eve-mem-"));
  try {
    const path = join(dir, MEMORY_FILENAME);
    await writeFile(path, content, "utf8");
    // gh gist edit <id> --filename <name> <localfile>
    const res = await gh(["gist", "edit", gistId, "--filename", MEMORY_FILENAME, path]);
    if (!res.ok) return { gistId, ok: false as const, reason: res.reason };
    return { gistId, ok: true as const };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export default defineTool({
  description:
    "Overwrite the agent's persistent memory gists with new content — one entry per repo. Pass each repo's gistId (from read-memory) with its updated memory document.",
  inputSchema: z.object({
    memories: z
      .array(z.object({ gistId: z.string(), content: z.string() }))
      .min(1)
      .describe("one entry per repo: the gistId returned by read-memory and the updated memory markdown"),
  }),
  async execute({ memories }) {
    // Write all repos' gists in parallel; a failure for one is isolated to its entry.
    const results = await Promise.all(memories.map((m) => writeOne(m.gistId, m.content)));
    return { ok: true as const, results };
  },
});
