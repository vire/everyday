import { describe, it, expect } from "vitest";
import { parseJsonOutput } from "./gh";

describe("parseJsonOutput", () => {
  it("parses valid JSON", () => {
    expect(parseJsonOutput<{ a: number }>('{"a":1}')).toEqual({ ok: true, data: { a: 1 } });
  });
  it("returns structured error on invalid JSON", () => {
    const r = parseJsonOutput("not json");
    expect(r.ok).toBe(false);
  });
});
