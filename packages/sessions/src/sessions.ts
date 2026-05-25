/**
 * Re-export shim. The implementation moved to ./sessions/ (one file
 * per domain) in Wave G. This file exists so the established import
 * paths (`@umwelten/sessions/sessions.js`, `./sessions.js`) keep
 * working — only `sessionsCommand` itself is re-exported because
 * that's the only public surface this file ever had.
 */

export { sessionsCommand } from "./sessions/index.js";
