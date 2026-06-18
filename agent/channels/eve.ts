import { eveChannel } from "eve/channels/eve";
import { localDev, vercelOidc, httpBasic, none } from "eve/channels/auth";

// Trigger auth for self-hosted production. The 12h cron POSTs to this channel's
// session endpoint to start a digest run, so the endpoint needs an auth strategy
// that works off-Vercel (placeholderAuth blocks prod requests; localDev is
// ignored in prod).
//
// - If AGENT_BASIC_USER/AGENT_BASIC_PASS are set, require HTTP Basic (the cron
//   sends them). Safe even if the port is publicly exposed.
// - If unset, fall back to none() (open) — only acceptable when port 3000 is
//   NOT published publicly (internal Docker network only).
const basicUser = process.env.AGENT_BASIC_USER;
const basicPass = process.env.AGENT_BASIC_PASS;
const triggerAuth =
  basicUser && basicPass ? httpBasic({ username: basicUser, password: basicPass }) : none();

export default eveChannel({
  auth: [
    localDev(), // open on localhost for `eve dev` / REPL; ignored in production
    vercelOidc(), // lets the eve TUI / Vercel deployments reach the agent
    triggerAuth, // self-hosted cron trigger (Basic when configured, else open)
  ],
});
