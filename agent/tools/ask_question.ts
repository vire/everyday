import { disableTool } from "eve/tools";

// Disable the framework "ask_question" tool. This agent runs unattended on a
// schedule (fire-and-forget, no channel), so it must never park awaiting user
// input — it should complete the digest autonomously.
export default disableTool();
