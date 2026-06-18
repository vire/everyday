import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Post a message to the configured Slack channel.",
  inputSchema: z.object({ text: z.string() }),
  async execute({ text }) {
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
