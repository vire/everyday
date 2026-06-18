import { describe, it, expect } from "vitest";
import {
  parseCoAuthors,
  classifyCommit,
  summarizeContributions,
  DEFAULT_AGENT_MARKERS,
  type RawCommit,
} from "./contributions";

const me = "vire";
const M = DEFAULT_AGENT_MARKERS;

describe("parseCoAuthors", () => {
  it("extracts lowercased identities from Co-authored-by trailers", () => {
    const msg = "Fix bug\n\nCo-authored-by: Claude Opus <noreply@anthropic.com>";
    expect(parseCoAuthors(msg)).toEqual(["claude opus", "noreply@anthropic.com"]);
  });
  it("returns [] when there are no trailers", () => {
    expect(parseCoAuthors("plain message")).toEqual([]);
  });
});

describe("classifyCommit", () => {
  const base: RawCommit = { sha: "a", authorLogin: me, committerLogin: me, message: "x" };
  it("human_me: my commit, no AI", () => {
    expect(classifyCommit(base, me, M)).toBe("human_me");
  });
  it("me_ai_assist: my commit with AI co-author", () => {
    const c = { ...base, message: "x\n\nCo-authored-by: Claude <noreply@anthropic.com>" };
    expect(classifyCommit(c, me, M)).toBe("me_ai_assist");
  });
  it("agent: bot author", () => {
    const c = { ...base, authorLogin: "dependabot[bot]" };
    expect(classifyCommit(c, me, M)).toBe("agent");
  });
  it("other: someone else's human commit", () => {
    const c = { ...base, authorLogin: "alice", committerLogin: "alice" };
    expect(classifyCommit(c, me, M)).toBe("other");
  });
});

describe("summarizeContributions", () => {
  it("counts each bucket", () => {
    const commits: RawCommit[] = [
      { sha: "1", authorLogin: me, committerLogin: me, message: "a" },
      { sha: "2", authorLogin: me, committerLogin: me, message: "b\n\nCo-authored-by: Claude <noreply@anthropic.com>" },
      { sha: "3", authorLogin: "github-actions[bot]", committerLogin: "github-actions[bot]", message: "c" },
      { sha: "4", authorLogin: "bob", committerLogin: "bob", message: "d" },
    ];
    expect(summarizeContributions(commits, me, M)).toEqual({
      total: 4, humanMe: 1, meAiAssist: 1, agent: 1, other: 1,
    });
  });
});
