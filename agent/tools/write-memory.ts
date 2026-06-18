import { defineTool } from "eve/tools";
import { z } from "zod";
import { gh } from "../../lib/gh";
import { MEMORY_FILENAME } from "../../lib/memory";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineTool({
  description: "Overwrite the agent's persistent memory gist with new content.",
  inputSchema: z.object({ gistId: z.string(), content: z.string() }),
  async execute({ gistId, content }) {
    const dir = await mkdtemp(join(tmpdir(), "eve-mem-"));
    const path = join(dir, MEMORY_FILENAME);
    await writeFile(path, content, "utf8");
    // gh gist edit <id> --filename <name> <localfile>
    const res = await gh(["gist", "edit", gistId, "--filename", MEMORY_FILENAME, path]);
    if (!res.ok) return res;
    return { ok: true as const, gistId };
  },
});
