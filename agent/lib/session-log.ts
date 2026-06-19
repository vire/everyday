// Pure, side-effect-free formatting for the session logger hook
// (agent/hooks/session-logger.ts). Kept here so the rendering logic is unit
// tested without touching the filesystem.
//
// `StreamEventLike` is a structural subset of eve's runtime stream-event union
// (HandleMessageStreamEvent) — only the fields we read. The real event objects
// the hook receives are structurally assignable to it, so we avoid importing
// eve's internal `protocol/message` types (not a public export) while staying
// type-safe at the call site.

export interface StreamEventLike {
  type: string;
  data?: Record<string, unknown>;
  meta?: { at?: string };
}

// Streaming partials that are superseded by their `.completed` counterpart.
// Skipped in BOTH sinks: they'd dominate the log with redundant token-by-token
// deltas and obscure the events that actually matter for spotting trouble.
const DELTA_EVENTS = new Set(["message.appended", "reasoning.appended"]);

export function isNoiseEvent(type: string): boolean {
  return DELTA_EVENTS.has(type);
}

const nowIsoDefault = (): string => new Date().toISOString();

/**
 * The structured record appended to the `.ndjson` sink: the original stream
 * event, stamped with `sessionId` and guaranteed a `meta.at` timestamp. The
 * `.type` / `.data` / `.meta` shape is preserved verbatim so the existing
 * `eve_pretty` / `eve_tokens` helpers (which parse the HTTP stream) read these
 * lines unchanged.
 */
export function toRecord(
  event: StreamEventLike,
  sessionId: string,
  nowIso: () => string = nowIsoDefault,
): Record<string, unknown> {
  const at = event.meta?.at ?? nowIso();
  return { sessionId, ...event, meta: { ...event.meta, at } };
}

function trunc(value: unknown, max = 500): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s === undefined) return "";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function hhmmss(at: string): string {
  // ISO 8601 → HH:MM:SS; fall back to the raw value if it isn't ISO-shaped.
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(at);
  return m ? m[1] : at;
}

/**
 * Render one stream event as human-readable, greppable log line(s). Returns an
 * array because a single `actions.requested` event can carry several tool calls
 * (parallel batch) — one line each. Every line is self-prefixed with
 * `HH:MM:SS [shortSessionId]` so lines stay meaningful when sessions interleave.
 */
export function formatLines(
  event: StreamEventLike,
  sessionId: string,
  nowIso: () => string = nowIsoDefault,
): string[] {
  if (isNoiseEvent(event.type)) return [];

  const at = event.meta?.at ?? nowIso();
  const prefix = `${hhmmss(at)} [${sessionId.slice(0, 8)}]`;
  const d = (event.data ?? {}) as Record<string, any>;
  const line = (body: string) => `${prefix} ${body}`;

  switch (event.type) {
    case "session.started": {
      const r = d.runtime ?? {};
      const sub = d.invocation?.kind === "subagent" ? ` subagent=${d.invocation.name}` : "";
      return [line(`▶ session.started agent=${r.agentName ?? r.agentId ?? "?"} model=${r.modelId ?? "?"}${sub}`)];
    }
    case "turn.started":
      return [line(`▷ turn ${d.sequence} start`)];
    case "message.received":
      return [line(`👤 ${trunc(d.message)}`)];
    case "actions.requested": {
      const actions = (d.actions ?? []) as Array<Record<string, any>>;
      return actions.map((a) =>
        line(`🔧 ${a.toolName ?? a.subagentName ?? a.kind ?? "action"}(${trunc(a.input, 300)})`),
      );
    }
    case "input.requested":
      return [line(`⌨️  input.requested (${(d.requests ?? []).length} request(s))`)];
    case "action.result": {
      const tool = d.result?.toolName ?? "action";
      const icon = d.status === "failed" ? "❌" : d.status === "rejected" ? "🚫" : "✅";
      const ok = d.result?.output?.ok;
      const okStr = ok === undefined ? "" : ` ok=${ok}`;
      const err = d.error ? ` — ${d.error.code}: ${trunc(d.error.message, 300)}` : "";
      return [line(`${icon} ${tool} ${d.status}${okStr}${err}`)];
    }
    case "step.completed": {
      const u = d.usage ?? {};
      const cache = u.cacheReadTokens ? ` cacheR=${u.cacheReadTokens}` : "";
      return [line(`· step ${d.stepIndex} (${d.finishReason}) tok in=${u.inputTokens ?? "?"} out=${u.outputTokens ?? "?"}${cache}`)];
    }
    case "step.failed":
      return [line(`❌ step ${d.stepIndex} failed ${d.code}: ${trunc(d.message, 300)}`)];
    case "message.completed":
      return [line(`🤖 ${trunc(d.message ?? "(no text)")}`)];
    case "result.completed":
      return [line(`🎁 result ${trunc(d.result, 300)}`)];
    case "turn.completed":
      return [line(`── turn ${d.sequence} done`)];
    case "turn.failed":
      return [line(`❌ turn ${d.sequence} failed ${d.code}: ${trunc(d.message, 300)}`)];
    case "session.waiting":
      return [line(`⏸  waiting (${d.wait})`)];
    case "session.failed":
      return [line(`🛑 session.failed ${d.code}: ${trunc(d.message, 300)}`)];
    case "session.completed":
      return [line("✔ session.completed")];
    case "subagent.called":
    case "subagent.started":
    case "subagent.completed":
    case "subagent.event":
      return [line(`↪ ${event.type} ${d.name ?? d.toolName ?? ""}`.trimEnd())];
    default:
      return [line(`· ${event.type}`)];
  }
}
