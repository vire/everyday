import { describe, it, expect } from "vitest";
import { memoryFilename, initialMemory } from "./memory";

describe("memory helpers", () => {
  it("derives a safe per-repo filename", () => {
    expect(memoryFilename("vire/eve-agent")).toBe("memory-vire-eve-agent.md");
  });
  it("collapses the owner/name separator and unusual characters", () => {
    expect(memoryFilename("acme/widgets v2")).toBe("memory-acme-widgets-v2.md");
  });
  it("initial memory mentions the repo", () => {
    expect(initialMemory("vire/eve-agent")).toContain("vire/eve-agent");
  });
});
