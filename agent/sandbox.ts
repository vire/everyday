import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

// Use the pure-JS just-bash backend instead of the default Docker sandbox.
// Docker provisioning hangs in some environments, and this agent never needs
// sandbox isolation: its tools call `gh` directly in the host runtime and
// deliver via an HTTP fetch. just-bash provisions instantly (no daemon/VM).
export default defineSandbox({ backend: justbash() });
