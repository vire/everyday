import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Result<T> = { ok: true; data: T } | { ok: false; reason: string };

export function parseJsonOutput<T>(stdout: string): Result<T> {
  try {
    return { ok: true, data: JSON.parse(stdout) as T };
  } catch (e) {
    return { ok: false, reason: `JSON parse failed: ${String(e)}` };
  }
}

export async function gh(
  args: string[],
): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
  try {
    const { stdout } = await run("gh", args, { maxBuffer: 20 * 1024 * 1024 });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, reason: `gh ${args.join(" ")} failed: ${String(e)}` };
  }
}

export async function ghJson<T>(args: string[]): Promise<Result<T>> {
  const r = await gh(args);
  if (!r.ok) return r;
  return parseJsonOutput<T>(r.stdout);
}

export async function resolveMe(): Promise<Result<string>> {
  if (process.env.GITHUB_LOGIN) return { ok: true, data: process.env.GITHUB_LOGIN };
  const r = await gh(["api", "user", "--jq", ".login"]);
  if (!r.ok) return r;
  return { ok: true, data: r.stdout.trim() };
}

export function targetRepo(): string | null {
  return process.env.TARGET_REPO ?? null;
}
