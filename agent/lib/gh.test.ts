import { describe, it, expect } from "vitest";
import { parseJsonOutput, parseRepos } from "./gh";

describe("parseJsonOutput", () => {
  it("parses valid JSON", () => {
    expect(parseJsonOutput<{ a: number }>('{"a":1}')).toEqual({ ok: true, data: { a: 1 } });
  });
  it("returns structured error on invalid JSON", () => {
    const r = parseJsonOutput("not json");
    expect(r.ok).toBe(false);
  });
});

describe("parseRepos", () => {
  it("parses a single repo into a one-element list", () => {
    expect(parseRepos("foo/bar")).toEqual(["foo/bar"]);
  });
  it("splits comma-delimited repos and trims whitespace", () => {
    expect(parseRepos("foo/bar, vire/foobar")).toEqual(["foo/bar", "vire/foobar"]);
  });
  it("drops blank entries (trailing/empty commas)", () => {
    expect(parseRepos("foo/bar,,vire/foobar, ")).toEqual(["foo/bar", "vire/foobar"]);
  });
  it("de-duplicates while preserving first-seen order", () => {
    expect(parseRepos("a/b, c/d, a/b")).toEqual(["a/b", "c/d"]);
  });
  it("returns [] for undefined/empty", () => {
    expect(parseRepos(undefined)).toEqual([]);
    expect(parseRepos("")).toEqual([]);
    expect(parseRepos("   ")).toEqual([]);
  });
});
