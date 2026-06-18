import { describe, it, expect } from "vitest";
import { memoryGistDescription, findMemoryGist, MEMORY_FILENAME, initialMemory } from "./memory";

describe("memory gist helpers", () => {
  it("description marker is repo-scoped", () => {
    expect(memoryGistDescription("vire/eve-agent")).toBe("eve-pr-digest-memory:vire/eve-agent");
  });
  it("finds the matching gist id", () => {
    const list = [
      { id: "g1", description: "something else" },
      { id: "g2", description: "eve-pr-digest-memory:vire/eve-agent" },
    ];
    expect(findMemoryGist(list, "vire/eve-agent")).toBe("g2");
  });
  it("returns null when absent", () => {
    expect(findMemoryGist([{ id: "g1", description: "x" }], "vire/eve-agent")).toBeNull();
  });
  it("initial memory mentions the repo and filename constant is stable", () => {
    expect(MEMORY_FILENAME).toBe("memory.md");
    expect(initialMemory("vire/eve-agent")).toContain("vire/eve-agent");
  });
});
