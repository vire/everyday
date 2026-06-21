import { defineTool } from "eve/tools";
import { z } from "zod";

// A real digest always carries this title (see the digest-format skill).
const DIGEST_MARKER = /PR & CI Digest/i;
// Stub payloads a weak model emits when it defers composing the real message.
const PLACEHOLDER = /^(placeholder|todo|tbd|\.{1,3}|<.*>)$/i;

export type DigestRejection = { ok: false; rejected: true; reason: string };

// Pure guard: returns a rejection when `text` is not a complete digest, else null.
// Keeps a weak model from silently posting a stub ("placeholder") to Slack;
// rejected:true tells the agent to recompose and retry (vs. a transport failure
// it should skip). Exported so the rejection contract is unit-tested.
export function digestRejection(text: string): DigestRejection | null {
  const trimmed = text.trim();
  if (trimmed.length < 40 || PLACEHOLDER.test(trimmed) || !DIGEST_MARKER.test(trimmed)) {
    return {
      ok: false,
      rejected: true,
      reason:
        "Refused to post: text is not a complete digest (must contain the 'PR & CI Digest' title and full content). Re-compose per the digest-format skill and call post-to-slack again with the real text.",
    };
  }
  return null;
}

export default defineTool({
  description:
    "Post the FULL composed digest to the configured Slack channel. Pass the complete digest text — never a placeholder, summary, or empty string. Text without the digest title is rejected.",
  inputSchema: z.object({ text: z.string() }),
  async execute({ text }) {
    const rejection = digestRejection(text);
    if (rejection) return rejection;
    const token = process.env.SLACK_BOT_TOKEN;
    const channel = process.env.SLACK_CHANNEL_ID;
    if (!token || !channel) return { ok: false as const, reason: "SLACK_BOT_TOKEN and SLACK_CHANNEL_ID env are required" };
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel, text }),
      });
      const body = await res.json().catch(() => null) as { ok?: boolean; ts?: string; error?: string } | null;
      if (!body) return { ok: false as const, reason: `Slack returned non-JSON (HTTP ${res.status})` };
      return body.ok ? { ok: true as const, ts: body.ts } : { ok: false as const, reason: `Slack error: ${body.error}` };
    } catch (e) {
      return { ok: false as const, reason: `Slack request failed: ${String(e)}` };
    }
  },
});
