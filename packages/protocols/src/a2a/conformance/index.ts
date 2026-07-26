/**
 * A2A conformance suite — one fixture set, two clients.
 *
 * ADR 0007 rejects a shared client package between this repo and the control
 * plane; this is what replaces it. Run the same cases against your client and
 * a live agent, and the two implementations stay honest about the Task
 * lifecycle without either depending on the other.
 *
 * ```ts
 * const agent = await startConformanceAgent();
 * const subject = createHttpConformanceSubject({
 *   endpoint: () => agent.url,
 *   restart: () => agent.restart(),
 * });
 * const report = await runA2AConformance(subject);
 * console.log(formatConformanceReport(report));
 * ```
 */

export { CONFORMANCE_CASES } from "./cases.js";
export { runA2AConformance, formatConformanceReport } from "./runner.js";
export type { RunConformanceOptions } from "./runner.js";
export { ConformanceAssertionError } from "./assertions.js";
export {
	ScriptedConformanceAgent,
	CONFORMANCE_DIRECTIVES,
	intentFromText,
} from "./scripted-agent.js";
export { startConformanceAgent } from "./local-agent.js";
export type {
	ConformanceAgentHandle,
	StartConformanceAgentOptions,
} from "./local-agent.js";
export { createHttpConformanceSubject } from "./http-subject.js";
export type { HttpConformanceSubjectOptions } from "./http-subject.js";
export { CONFORMANCE_INTENTS } from "./types.js";
export type {
	ConformanceCase,
	ConformanceCaseResult,
	ConformanceCaseStatus,
	ConformanceContext,
	ConformanceIntent,
	ConformanceReport,
	ConformanceRequirements,
	ConformanceSubject,
	SubjectSendOptions,
} from "./types.js";
