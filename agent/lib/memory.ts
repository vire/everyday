// Pure helpers for the agent's persistent memory. Memory is a local markdown
// file per repo, persisted on a Docker volume (see docker-compose.yml) — no
// external service, and it survives container restarts / redeploys. The
// read-memory / write-memory tools do the file I/O; path derivation here stays
// side-effect-free and unit-tested (memory.test.ts).

export function initialMemory(repo: string): string {
  return [
    `# PR Digest Memory — ${repo}`,
    "",
    "## CI baselines",
    "_(p50 duration & pass rate per workflow, updated each run)_",
    "",
    "## Open improvement suggestions",
    "",
    "## Notes & recurring patterns",
    "",
  ].join("\n");
}

// One file per repo: owner/name → memory-owner-name.md. Any character outside a
// safe set (including the `/` separator) collapses to `-` so the slug is a valid
// single filename.
export function memoryFilename(repo: string): string {
  return `memory-${repo.replace(/[^A-Za-z0-9._-]+/g, "-")}.md`;
}

// Directory holding the memory files — persisted on the eve-memory volume in
// production (default /app/memory), ./memory locally. Override with EVE_MEMORY_DIR.
export function memoryDir(): string {
  return process.env.EVE_MEMORY_DIR || (process.env.NODE_ENV === "production" ? "/app/memory" : "./memory");
}
