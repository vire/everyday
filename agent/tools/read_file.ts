import { disableTool } from "eve/tools";

// Disable the framework default "read-file" tool. This agent uses its own
// gh-backed tools (run in the host runtime) and must not invoke the
// Docker sandbox, which is unnecessary here and was hanging on prewarm.
export default disableTool();
