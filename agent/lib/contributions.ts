export interface RawCommit {
  sha: string;
  authorLogin: string | null;
  committerLogin: string | null;
  message: string;
}

export type Bucket = "human_me" | "me_ai_assist" | "agent" | "other";

export interface AgentMarkers {
  botLoginPattern: RegExp;
  coAuthorIdentities: string[];
}

export const DEFAULT_AGENT_MARKERS: AgentMarkers = {
  botLoginPattern: /\[bot\]$/i,
  coAuthorIdentities: ["claude", "noreply@anthropic.com", "cursor", "copilot", "devin"],
};

export function parseCoAuthors(message: string): string[] {
  const out: string[] = [];
  for (const line of message.split("\n")) {
    const m = line.match(/^\s*Co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/i);
    if (m) {
      out.push(m[1].toLowerCase());
      out.push(m[2].toLowerCase());
    }
  }
  return out;
}

function isBot(login: string | null, markers: AgentMarkers): boolean {
  return !!login && markers.botLoginPattern.test(login);
}

function hasAiCoAuthor(message: string, markers: AgentMarkers): boolean {
  const ids = parseCoAuthors(message);
  return ids.some((id) =>
    markers.coAuthorIdentities.some((marker) => id.includes(marker.toLowerCase())),
  );
}

export function classifyCommit(c: RawCommit, me: string, markers: AgentMarkers): Bucket {
  if (isBot(c.authorLogin, markers) || isBot(c.committerLogin, markers)) return "agent";
  const mine = c.authorLogin === me;
  if (mine) return hasAiCoAuthor(c.message, markers) ? "me_ai_assist" : "human_me";
  return "other";
}

export interface ContributionsSummary {
  total: number;
  humanMe: number;
  meAiAssist: number;
  agent: number;
  other: number;
}

export function summarizeContributions(
  commits: RawCommit[],
  me: string,
  markers: AgentMarkers,
): ContributionsSummary {
  const s: ContributionsSummary = { total: commits.length, humanMe: 0, meAiAssist: 0, agent: 0, other: 0 };
  for (const c of commits) {
    const b = classifyCommit(c, me, markers);
    if (b === "human_me") s.humanMe++;
    else if (b === "me_ai_assist") s.meAiAssist++;
    else if (b === "agent") s.agent++;
    else s.other++;
  }
  return s;
}
