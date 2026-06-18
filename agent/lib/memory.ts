export const MEMORY_FILENAME = "memory.md";

export function memoryGistDescription(repo: string): string {
  return `eve-pr-digest-memory:${repo}`;
}

export interface GistListItem {
  id: string;
  description: string;
}

export function findMemoryGist(list: GistListItem[], repo: string): string | null {
  const marker = memoryGistDescription(repo);
  return list.find((g) => g.description === marker)?.id ?? null;
}

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
