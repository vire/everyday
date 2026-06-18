import { defineTool } from "eve/tools";
import { z } from "zod";
import { gh, ghJson, targetRepo } from "../lib/gh.ts";
import { findMemoryGist, initialMemory, memoryGistDescription, MEMORY_FILENAME } from "../lib/memory.ts";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineTool({
  description: "Read the agent's persistent memory (private gist); creates it if missing.",
  inputSchema: z.object({}),
  async execute() {
    const repo = targetRepo();
    if (!repo) return { ok: false as const, reason: "TARGET_REPO env is required (owner/name)" };

    // Fast path: if MEMORY_GIST_ID is set, skip the gist listing and read directly.
    const envGistId = process.env.MEMORY_GIST_ID;
    if (envGistId) {
      const view = await gh(["gist", "view", envGistId, "--filename", MEMORY_FILENAME, "--raw"]);
      if (!view.ok) return view;
      return { ok: true as const, gistId: envGistId, content: view.stdout, created: false };
    }

    // gh gist list --json is not supported; use gh api gists instead.
    // --paginate without --jq returns one merged JSON array; --jq emits one array per page (NDJSON).
    const list = await ghJson<{ id: string; description: string }[]>([
      "api", "gists", "--paginate",
    ]);
    if (!list.ok) return list;
    let gistId = findMemoryGist(list.data, repo);

    if (!gistId) {
      // execFile cannot pipe stdin, so write a temp file for gist create
      const dir = await mkdtemp(join(tmpdir(), "eve-mem-"));
      try {
        const path = join(dir, MEMORY_FILENAME);
        await writeFile(path, initialMemory(repo), "utf8");
        const created = await gh([
          "gist", "create", "--desc", memoryGistDescription(repo), path,
        ]);
        if (!created.ok) return created;
        const url = created.stdout.trim();
        gistId = url.split("/").pop() ?? null;
        if (!gistId) return { ok: false as const, reason: `Could not parse gist ID from: ${url}` };
        console.error(`memory gist id: ${gistId} — set MEMORY_GIST_ID to skip the gist scan`);
        return { ok: true as const, gistId, content: initialMemory(repo), created: true };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }

    const view = await gh(["gist", "view", gistId, "--filename", MEMORY_FILENAME, "--raw"]);
    if (!view.ok) return view;
    return { ok: true as const, gistId, content: view.stdout, created: false };
  },
});
