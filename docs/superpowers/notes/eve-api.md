# Eve API — Ground Truth Reference

Recorded from `eve@0.11.4` installed at `/Users/vire/code/github/eve-agent/node_modules/eve`.
Verified by reading `.d.ts` type files directly, not from docs speculation.

> **Scaffold note**: `npx eve@latest init .` refused the non-empty repo root and instead
> created the agent at `./agent/` (nested layout). All relative paths in later tasks are
> relative to `agent/`. The layout is `nested` as confirmed by `eve info`.

---

## 1. `defineAgent` — `import { defineAgent } from "eve"`

**File**: `agent/agent.ts`

```ts
import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-sonnet-4.6",
});
```

**Signature** (from `dist/src/public/definitions/agent.d.ts`):
```ts
export declare function defineAgent<TAgent extends AgentDefinition>(
  definition: ExactDefinition<TAgent, AgentDefinition>
): TAgent;
```

`AgentDefinition` is `PublicAgentDefinition` from `#shared/agent-definition.js`. Fields include:
- `model`: string (model ID, e.g. `"anthropic/claude-sonnet-4.6"`)
- `compaction`, `experimental`, `build` — optional config sub-objects

**Note**: Do NOT include a `name` field — identity is derived at compile time from `manifest.agentId` (package name or basename).

---

## 2. `defineTool` — `import { defineTool } from "eve/tools"`

**File**: `agent/tools/<slug>.ts` — the filename slug (without `.ts`) is the tool name the model sees.

**Signature** (from `dist/src/public/definitions/tool.d.ts`):
```ts
export declare function defineTool<TInputSchema extends StandardJSONSchemaV1, TOutputSchema extends StandardJSONSchemaV1>(
  definition: {
    description: string;
    inputSchema: TInputSchema;          // Zod schema, Standard Schema, or plain JSON Schema object
    outputSchema?: TOutputSchema;       // optional — types the execute return
    execute(
      input: InferOutput<TInputSchema>,
      ctx: ToolContext
    ): Promise<InferOutput<TOutputSchema>> | InferOutput<TOutputSchema>;
    needsApproval?: ToolDefinition["needsApproval"];
    toModelOutput?: ToolDefinition["toModelOutput"];
    auth?: ToolAuthDefinition;
  }
): ToolDefinition<...>;
```

**Minimal example** (confirmed in docs and scaffold):
```ts
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({ city: z.string().min(1) }),
  async execute({ city }, ctx) {
    return { city, condition: "Sunny", temperatureF: 72 };
  },
});
```

**`ToolContext`** fields (from `dist/src/public/definitions/tool.d.ts`):
- `ctx.session`: session metadata, turn, auth
- `ctx.getSandbox()`: live sandbox handle
- `ctx.getSkill(id)`: packaged skill metadata
- `ctx.getToken()`: bearer token for declared `auth` strategy
- `ctx.requireAuth()`: signals auth required (throws)

**`inputSchema: z.object({})`** — pass this for tools with no inputs.

**Additional exports** from `"eve/tools"**:
- `defineDynamic` — resolver evaluated from stream-event handlers
- `disableTool` — sentinel to disable a framework default tool
- `defineBashTool`, `defineGlobTool`, `defineGrepTool`, `defineReadFileTool`, `defineWriteFileTool` — built-in tool factories

---

## 3. `defineSandbox` — `import { defineSandbox } from "eve/sandbox"`

**File**: `agent/sandbox.ts`

**Signature** (from `dist/src/public/sandbox/index.d.ts`):
```ts
export declare function defineSandbox<BO = Record<string, never>, SO = Record<string, never>>(
  definition: SandboxDefinition<BO, SO>
): SandboxDefinition<BO, SO>;
```

`SandboxDefinition` has optional `backend` (defaults to `defaultBackend()` at runtime) and optional `bootstrap` / `onSession` hooks.

**Sandbox backends** (separate import paths):
- `import { defaultBackend } from "eve/sandbox"` — default backend
- `import { vercel } from "eve/sandbox/vercel"` — Vercel Sandbox
- `import { docker } from "eve/sandbox/docker"` (not yet confirmed in exports)
- `import { justBash } from "eve/sandbox/just-bash"` — runs commands directly without isolation

**Note**: The brief mentioned `vercelSandboxBackend` but the actual export from `"eve/sandbox/vercel"` is `vercel` (not `vercelSandboxBackend`). There is no `"eve/sandbox"` export named `vercelSandboxBackend` — it lives at `"eve/sandbox/vercel"` as `vercel`.

```ts
import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

export default defineSandbox({
  backend: vercel(),
  async bootstrap({ use }) {
    await use(async (sandbox) => {
      // install tools, seed files, etc.
    });
  },
});
```

---

## 4. `slackChannel` — `import { slackChannel } from "eve/channels/slack"`

**File**: `agent/channels/slack.ts`

**Signature** (from `dist/src/public/channels/slack/index.d.ts`):
```ts
export { slackChannel } from "#public/channels/slack/slackChannel.js";
```

**Minimal usage** (requires `@vercel/connect` — already a dependency):
```ts
import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

export default slackChannel({
  credentials: connectSlackCredentials("slack/my-agent"),
});
```

**Key exports** from `"eve/channels/slack"`:
- `slackChannel(config)` — defines the channel
- `defaultSlackAuth(message, ctx)` — builds workspace-scoped auth from a mention
- `loadThreadContextMessages(thread, message, opts)` — pulls prior thread messages; use `since: "last-agent-reply"`
- `cardToBlocks`, `cardToFallbackText` — Block Kit helpers
- Card builders: `Card`, `Section`, `Button`, `Actions`, `Divider`, `Table`, etc.

**Credential provisioning**: Uses Vercel Connect — no `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` env vars to manage. Requires `vercel connect create slack` + attach to trigger path `/eve/v1/slack`.

**Event dispatch hooks** (all optional):
- `onAppMention(ctx, message)` — handles `@mentions`
- `onDirectMessage(ctx, message)` — handles DMs
- `onInteraction(action, ctx)` — handles `block_actions` callbacks

---

## 5. `eveChannel` — `import { eveChannel } from "eve/channels/eve"`

The default HTTP channel generated by `eve init`. Used in `agent/channels/eve.ts`.

```ts
import { eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [localDev(), vercelOidc(), placeholderAuth()],
});
```

---

## 6. Layout (Nested)

`eve info` confirmed the scaffold layout as **nested**:

```
<repo-root>/          ← app root (package.json, vitest.config.ts, lib/)
  agent/              ← agent root
    agent.ts          ← defineAgent(...)
    instructions.md   ← always-on system prompt
    channels/
      eve.ts          ← eveChannel(...) — default HTTP channel
    tools/
      <slug>.ts       ← defineTool(...) — filename = tool name
    sandbox.ts        ← defineSandbox(...) — optional
```

**`eve info` output** (run without cloud auth — worked fine):
- App Root: `/Users/vire/code/github/eve-agent`
- Agent Root: `/Users/vire/code/github/eve-agent/agent`
- Messaging endpoints:
  - Create: `POST /eve/v1/session`
  - Continue: `POST /eve/v1/session/:sessionId`
  - Stream: `GET /eve/v1/session/:sessionId/stream`

---

## 7. CLI Surface (from `eve --help`)

| Command | Description |
|---------|-------------|
| `eve init [target]` | Scaffold agent. Only flag: `--channel-web-nextjs` (do NOT use for Slack delivery) |
| `eve dev` | Local interactive dev server (requires MODEL env / `eve link`) |
| `eve build` | Production build |
| `eve start` | Run production build |
| `eve eval` | Run evals |
| `eve link` | Pull Vercel AI Gateway credentials |
| `eve info` | Print resolved app info (works without cloud auth) |
| `eve channels` | List/manage channels |

---

## 8. Spike 3 — gh Binary Reachability from Tool Execution

**Question**: Is `gh` callable from tool execution context (tools run in app runtime, not in sandbox)?

**Method**: Directly executed the probe tool's `execute()` body via `node --input-type=module`:
```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const { stdout } = await run("gh", ["--version"]);
```

**Result**:
```json
{ "ok": true, "version": "gh version 2.93.0 (2026-05-27)\nhttps://github.com/cli/cli/releases/tag/v2.93.0" }
```

**Conclusion**: `gh` IS reachable via `execFile` from the tool execution environment. No sandbox wrapper needed. The binary is at `/opt/homebrew/bin/gh` and resolves on `PATH`.

**gh auth status at time of spike**:
- Logged in to github.com as `vire` (keyring)
- Token scopes: `admin:public_key`, `gist`, `read:org`, `repo`

**Deferral**: Full live `eve dev` end-to-end smoke test (Step 5 of brief) is **deferred to Task 8** — requires a MODEL env var (OpenRouter key or `eve link` Vercel AI Gateway credentials) which are intentionally not configured yet.

---

## 9. Package Versions (locked)

```json
{
  "eve": "^0.11.4",
  "zod": "4.4.3",
  "ai": "7.0.0-beta.178",
  "@vercel/connect": "0.2.2",
  "vitest": "^4.1.9"
}
```

Node engine: `24.x`. Package manager: `pnpm@10.33.0`.
