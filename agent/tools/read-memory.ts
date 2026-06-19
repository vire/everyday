import { defineTool } from "eve/tools";
import { z } from "zod";
import { gh, ghJson, targetRepos } from "../lib/gh.ts";
import { findMemoryGist, initialMemory, memoryGistDescription, MEMORY_FILENAME } from "../lib/memory.ts";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Resolve (find-or-create) one repo's memory gist and read its content. Returns
// a per-repo entry so a failure for one repo doesn't sink the others.
async function resolveMemory(
  repo: string,
  list: { id: string; description: string }[],
): Promise<
  | { repo: string; ok: true; gistId: string; content: string; created: boolean }
  | { repo: string; ok: false; reason: string }
> {
  let gistId = findMemoryGist(list, repo);

  if (!gistId) {
    // execFile cannot pipe stdin, so write a temp file for gist create.
    const dir = await mkdtemp(join(tmpdir(), "eve-mem-"));
    try {
      const path = join(dir, MEMORY_FILENAME);
      await writeFile(path, initialMemory(repo), "utf8");
      const created = await gh(["gist", "create", "--desc", memoryGistDescription(repo), path]);
      if (!created.ok) return { repo, ok: false as const, reason: created.reason };
      const url = created.stdout.trim();
      const newId = url.split("/").pop() ?? "";
      if (!newId) return { repo, ok: false as const, reason: `Could not parse gist ID from: ${url}` };
      console.error(`memory gist for ${repo}: ${newId}`);
      return { repo, ok: true as const, gistId: newId, content: initialMemory(repo), created: true };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const view = await gh(["gist", "view", gistId, "--filename", MEMORY_FILENAME, "--raw"]);
  if (!view.ok) return { repo, ok: false as const, reason: view.reason };
  return { repo, ok: true as const, gistId, content: view.stdout, created: false };
}

export default defineTool({
  description:
    "Read the agent's persistent memory (one private gist per repo); creates any that are missing. Returns one entry per repo in `memories`.",
  inputSchema: z.object({}),
  async execute() {
    const repos = targetRepos();
    if (repos.length === 0)
      return { ok: false as const, reason: "TARGET_REPO env is required (comma-delimited owner/name list)" };

    // Fast path: a single repo with an explicit gist id skips the gist listing.
    // (MEMORY_GIST_ID can only name one gist, so it's ignored for multi-repo.)
    const envGistId = process.env.MEMORY_GIST_ID;
    if (repos.length === 1 && envGistId) {
      const repo = repos[0];
      const view = await gh(["gist", "view", envGistId, "--filename", MEMORY_FILENAME, "--raw"]);
      if (!view.ok) return view;
      return {
        ok: true as const,
        memories: [{ repo, ok: true as const, gistId: envGistId, content: view.stdout, created: false }],
      };
    }

    // gh gist list --json is not supported; use gh api gists instead. One scan
    // resolves every repo's gist (matched by description) — see lib/memory.ts.
    // --paginate without --jq returns one merged JSON array.
    const list = await ghJson<{ id: string; description: string }[]>(["api", "gists", "--paginate"]);
    if (!list.ok) return list;

    const memories = await Promise.all(repos.map((repo) => resolveMemory(repo, list.data)));
    return { ok: true as const, memories };
  },
});
