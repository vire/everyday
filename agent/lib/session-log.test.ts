import { describe, it, expect } from "vitest";
import { toRecord, formatLines, isNoiseEvent, type StreamEventLike } from "./session-log";

const SID = "sess_0123456789abcdef";
const AT = "2026-06-19T07:08:09.123Z";
const ev = (type: string, data?: Record<string, unknown>): StreamEventLike => ({
  type,
  data,
  meta: { at: AT },
});

describe("toRecord", () => {
  it("stamps sessionId and preserves the original type/data/meta shape", () => {
    const rec = toRecord(ev("message.received", { message: "hi", turnId: "t1", sequence: 0 }), SID);
    expect(rec).toMatchObject({
      sessionId: SID,
      type: "message.received",
      data: { message: "hi", turnId: "t1", sequence: 0 },
      meta: { at: AT },
    });
  });

  it("synthesizes meta.at when the event has none (uses injected clock)", () => {
    const rec = toRecord({ type: "session.completed" }, SID, () => AT);
    expect((rec.meta as { at: string }).at).toBe(AT);
  });
});

describe("isNoiseEvent", () => {
  it("flags streaming deltas as noise, keeps their completed counterparts", () => {
    expect(isNoiseEvent("message.appended")).toBe(true);
    expect(isNoiseEvent("reasoning.appended")).toBe(true);
    expect(isNoiseEvent("message.completed")).toBe(false);
    expect(isNoiseEvent("session.failed")).toBe(false);
  });
});

describe("formatLines", () => {
  it("drops noise (delta) events entirely", () => {
    expect(formatLines(ev("message.appended", { text: "par" }), SID)).toEqual([]);
  });

  it("prefixes every line with HH:MM:SS and a short session id", () => {
    const [l] = formatLines(ev("message.received", { message: "hello" }), SID);
    expect(l.startsWith("07:08:09 [sess_012]")).toBe(true);
    expect(l).toContain("👤 hello");
  });

  it("renders session.started with agent + model", () => {
    const [l] = formatLines(
      ev("session.started", { runtime: { agentName: "eve-agent", modelId: "gpt-5-nano" } }),
      SID,
    );
    expect(l).toContain("▶ session.started agent=eve-agent model=gpt-5-nano");
  });

  it("emits one line per tool call in a parallel actions batch", () => {
    const lines = formatLines(
      ev("actions.requested", {
        actions: [
          { kind: "tool-call", toolName: "pull-requests", input: { state: "open" } },
          { kind: "tool-call", toolName: "ci-health", input: {} },
        ],
      }),
      SID,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('🔧 pull-requests({"state":"open"})');
    expect(lines[1]).toContain("🔧 ci-health({})");
  });

  it("marks a successful action result with ok flag", () => {
    const [l] = formatLines(
      ev("action.result", { status: "completed", result: { toolName: "post-to-slack", output: { ok: true } } }),
      SID,
    );
    expect(l).toContain("✅ post-to-slack completed ok=true");
  });

  it("surfaces failed action results with the error code and message", () => {
    const [l] = formatLines(
      ev("action.result", {
        status: "failed",
        result: { toolName: "bash" },
        error: { code: "E_EXEC", message: "command not found" },
      }),
      SID,
    );
    expect(l).toContain("❌ bash failed");
    expect(l).toContain("E_EXEC: command not found");
  });

  it("reports token usage on step.completed", () => {
    const [l] = formatLines(
      ev("step.completed", { stepIndex: 2, finishReason: "stop", usage: { inputTokens: 1200, outputTokens: 80, cacheReadTokens: 1000 } }),
      SID,
    );
    expect(l).toContain("· step 2 (stop) tok in=1200 out=80 cacheR=1000");
  });

  it("highlights session failures (the key abnormality signal)", () => {
    const [l] = formatLines(ev("session.failed", { code: "MODEL_ERROR", message: "provider 500" }), SID);
    expect(l).toContain("🛑 session.failed MODEL_ERROR: provider 500");
  });

  it("truncates very long messages", () => {
    const [l] = formatLines(ev("message.completed", { message: "x".repeat(2000) }), SID);
    expect(l.length).toBeLessThan(600);
    expect(l).toContain("…");
  });

  it("falls back to a generic line for unmapped event types", () => {
    const [l] = formatLines(ev("compaction.completed", {}), SID);
    expect(l).toContain("· compaction.completed");
  });
});
