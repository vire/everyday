import { defineTool } from "eve/tools";
import { z } from "zod";
import { selectMemoryProvider } from "../lib/memory-provider.ts";

export default defineTool({
  description:
    "Overwrite the agent's persistent memory with new content — one entry per repo. Pass each repo's `ref` (from read-memory) with its updated memory document.",
  inputSchema: z.object({
    memories: z
      .array(z.object({ ref: z.string(), content: z.string() }))
      .min(1)
      .describe("one entry per repo: the ref returned by read-memory and the updated memory markdown"),
  }),
  async execute({ memories }) {
    return selectMemoryProvider(process.env).write(memories);
  },
});
