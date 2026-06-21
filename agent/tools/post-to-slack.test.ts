import { describe, expect, it } from "vitest";
import { digestRejection } from "./post-to-slack";

// A minimal valid digest: carries the title and enough body to clear the floor.
const VALID = "*PR & CI Digest — 2026-06-21*\nvire/jsonl-tools-private — quiet day";

describe("digestRejection — post-to-slack payload guard", () => {
  it("rejects the literal placeholder that shipped the bug", () => {
    const r = digestRejection("placeholder");
    expect(r).not.toBeNull();
    expect(r).toMatchObject({ ok: false, rejected: true });
  });

  it("rejects other stub payloads", () => {
    for (const stub of ["", "  ", "TODO", "tbd", "...", "<the composed digest>"]) {
      expect(digestRejection(stub), `stub: ${JSON.stringify(stub)}`).not.toBeNull();
    }
  });

  it("rejects text missing the digest title even when long enough", () => {
    expect(digestRejection("Here is a long enough summary of the day's activity, but no title.")).not.toBeNull();
  });

  it("rejects text that has the title but is too short to be a real digest", () => {
    expect(digestRejection("PR & CI Digest")).not.toBeNull();
  });

  it("accepts a complete digest (including a quiet-day one)", () => {
    expect(digestRejection(VALID)).toBeNull();
  });

  it("accepts a digest with surrounding whitespace", () => {
    expect(digestRejection(`\n\n${VALID}\n`)).toBeNull();
  });

  it("carries a retry instruction in the rejection reason", () => {
    expect(digestRejection("placeholder")?.reason).toMatch(/recompose|re-compose/i);
  });
});
