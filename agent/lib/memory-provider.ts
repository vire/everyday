import { gh, ghJson } from "./gh.ts";
import { findMemoryGist, initialMemory, memoryGistDescription, MEMORY_FILENAME } from "./memory.ts";
import { writeFile, readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

// A memory backend. `read` find-or-creates every repo's memory in one call (so
// the gist provider can list gists once instead of per-repo); the `ref` it
// returns per repo is an opaque handle (gist id or file path) that the agent
// hands back to `write`. Global failures (e.g. GitHub auth) surface as top-level
// { ok:false }; per-repo failures live inside each `memories`/`results` entry.
export type MemoryRead =
  | { repo: string; ok: true; ref: string; content: string; created: boolean }
  | { repo: string; ok: false; reason: string };

export type MemoryWriteResult = { ref: string; ok: true } | { ref: string; ok: false; reason: string };

export type MemoryReadResult = { ok: false; reason: string } | { ok: true; memories: MemoryRead[] };

export interface MemoryProvider {
  read(repos: string[]): Promise<MemoryReadResult>;
  write(entries: { ref: string; content: string }[]): Promise<{ ok: true; results: MemoryWriteResult[] }>;
}

// ── gist provider ────────────────────────────────────────────────────────────

// Resolve (find-or-create) one repo's memory gist and read its content. Returns
// a per-repo entry so a failure for one repo doesn't sink the others.
async function gistResolve(repo: string, list: { id: string; description: string }[]): Promise<MemoryRead> {
  const gistId = findMemoryGist(list, repo);

  if (!gistId) {
    // execFile cannot pipe stdin, so write a temp file for gist create.
    const dir = await mkdtemp(join(tmpdir(), "eve-mem-"));
    try {
      const path = join(dir, MEMORY_FILENAME);
      await writeFile(path, initialMemory(repo), "utf8");
      const created = await gh(["gist", "create", "--desc", memoryGistDescription(repo), path]);
      if (!created.ok) return { repo, ok: false, reason: created.reason };
      const url = created.stdout.trim();
      const newId = url.split("/").pop() ?? "";
      if (!newId) return { repo, ok: false, reason: `Could not parse gist ID from: ${url}` };
      console.error(`memory gist for ${repo}: ${newId}`);
      return { repo, ok: true, ref: newId, content: initialMemory(repo), created: true };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const view = await gh(["gist", "view", gistId, "--filename", MEMORY_FILENAME, "--raw"]);
  if (!view.ok) return { repo, ok: false, reason: view.reason };
  return { repo, ok: true, ref: gistId, content: view.stdout, created: false };
}

async function gistWriteOne(ref: string, content: string): Promise<MemoryWriteResult> {
  const dir = await mkdtemp(join(tmpdir(), "eve-mem-"));
  try {
    const path = join(dir, MEMORY_FILENAME);
    await writeFile(path, content, "utf8");
    // gh gist edit <id> --filename <name> <localfile>
    const res = await gh(["gist", "edit", ref, "--filename", MEMORY_FILENAME, path]);
    if (!res.ok) return { ref, ok: false, reason: res.reason };
    return { ref, ok: true };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const gistProvider: MemoryProvider = {
  async read(repos) {
    // Fast path: a single repo with an explicit gist id skips the gist listing.
    // (MEMORY_GIST_ID can only name one gist, so it's ignored for multi-repo.)
    const envGistId = process.env.MEMORY_GIST_ID;
    if (repos.length === 1 && envGistId) {
      const view = await gh(["gist", "view", envGistId, "--filename", MEMORY_FILENAME, "--raw"]);
      if (!view.ok) return view;
      return { ok: true, memories: [{ repo: repos[0], ok: true, ref: envGistId, content: view.stdout, created: false }] };
    }

    // gh gist list --json is not supported; use gh api gists instead. One scan
    // resolves every repo's gist (matched by description) — see lib/memory.ts.
    // --paginate without --jq returns one merged JSON array.
    const list = await ghJson<{ id: string; description: string }[]>(["api", "gists", "--paginate"]);
    if (!list.ok) return list;

    const memories = await Promise.all(repos.map((repo) => gistResolve(repo, list.data)));
    return { ok: true, memories };
  },

  async write(entries) {
    // Write all repos' gists in parallel; a failure for one is isolated to its entry.
    const results = await Promise.all(entries.map((e) => gistWriteOne(e.ref, e.content)));
    return { ok: true, results };
  },
};

// ── fs provider ──────────────────────────────────────────────────────────────

// owner/name -> owner__name.md. Slugs come from the trusted TARGET_REPO env, not
// user input, so a plain separator swap is enough — no path-traversal guard.
// ponytail: sanitize `..` only if slugs ever become user-sourced.
export function slugToFile(repo: string): string {
  return `${repo.replace(/\//g, "__")}.md`;
}

function fsProvider(dir: string): MemoryProvider {
  return {
    async read(repos) {
      const memories = await Promise.all(
        repos.map(async (repo): Promise<MemoryRead> => {
          const ref = join(dir, slugToFile(repo));
          try {
            await mkdir(dir, { recursive: true });
            try {
              return { repo, ok: true, ref, content: await readFile(ref, "utf8"), created: false };
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
              const content = initialMemory(repo);
              await writeFile(ref, content, "utf8");
              return { repo, ok: true, ref, content, created: true };
            }
          } catch (e) {
            return { repo, ok: false, reason: `fs memory read failed for ${repo}: ${String(e)}` };
          }
        }),
      );
      return { ok: true, memories };
    },

    async write(entries) {
      const results = await Promise.all(
        entries.map(async (e): Promise<MemoryWriteResult> => {
          try {
            await mkdir(dirname(e.ref), { recursive: true });
            await writeFile(e.ref, e.content, "utf8");
            return { ref: e.ref, ok: true };
          } catch (err) {
            return { ref: e.ref, ok: false, reason: String(err) };
          }
        }),
      );
      return { ok: true, results };
    },
  };
}

// ── selection ────────────────────────────────────────────────────────────────

// MEMORY_PROVIDER=fs picks the local-file backend (dir from MEMORY_DIR, default
// /app/memory); anything else (incl. unset) keeps the gist backend.
export function selectMemoryProvider(env: NodeJS.ProcessEnv = process.env): MemoryProvider {
  if ((env.MEMORY_PROVIDER ?? "gist").toLowerCase() === "fs") {
    return fsProvider(env.MEMORY_DIR || "/app/memory");
  }
  return gistProvider;
}
