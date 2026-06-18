import { disableTool } from "eve/tools";

// Disable the framework default "todo" tool. This scheduled digest agent uses
// only its own gh-backed tools; extra framework tools distract the model and
// (for web_fetch) were failing with 404s during runs.
export default disableTool();
