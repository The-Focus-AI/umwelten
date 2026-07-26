/**
 * Carrying the agent-call chain across an A2A hop.
 *
 * The recursion guard in `agent-call-context.ts` tracks depth and cycles in
 * AsyncLocalStorage, which follows the async call tree inside one process and
 * stops dead at the container boundary. Neither `ask_remote_agent` nor Gaia's
 * `ask_habitat` enters it, and the chain has never been put on the wire — so
 * an A2A cycle (operations → client → operations) starts fresh at every hop
 * and runs forever. With LLM agents on both ends and output caps forbidden by
 * this repo's hard rules, forever means unbounded spend.
 *
 * ADR 0008 makes cycles structurally impossible by keeping the call graph a
 * directed tree. This module is the defence in depth for the case where one
 * prompt-injected agent ignores the convention: serialise the chain into
 * outgoing A2A message metadata, rehydrate it on receipt, and let the
 * existing guard do its job.
 *
 * The chain is untrusted input — it arrives from another container. It is
 * only ever used to *refuse* work, never to grant it, so a caller who strips
 * it gains nothing beyond the depth budget they would have had anyway.
 * Malformed and oversized chains are rejected rather than trusted.
 */

/** Metadata key carrying the chain on an A2A message. */
export const AGENT_CHAIN_METADATA_KEY = "umwelten.agentChain";

/** Hard ceiling on a wire chain, well above any legitimate depth. */
export const MAX_WIRE_CHAIN_LENGTH = 32;
/** Hard ceiling on one agent id, to bound the metadata a peer can inject. */
export const MAX_WIRE_AGENT_ID_LENGTH = 128;

/** Serialise the current chain for an outgoing A2A message. */
export function encodeAgentChain(chain: string[]): Record<string, unknown> {
	return { [AGENT_CHAIN_METADATA_KEY]: chain };
}

/**
 * Read a chain out of inbound A2A message metadata.
 *
 * Returns an empty chain for anything malformed — a peer sending nonsense
 * gets the same treatment as a peer sending nothing, rather than crashing the
 * receiver. Oversized chains are truncated to the ceiling rather than
 * rejected outright, so a hostile peer cannot use a huge chain to make the
 * receiver refuse legitimate work.
 */
export function decodeAgentChain(
	metadata: Record<string, unknown> | undefined,
): string[] {
	const raw = metadata?.[AGENT_CHAIN_METADATA_KEY];
	if (!Array.isArray(raw)) return [];

	const chain: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string") continue;
		const trimmed = entry.trim();
		if (!trimmed) continue;
		chain.push(trimmed.slice(0, MAX_WIRE_AGENT_ID_LENGTH));
		if (chain.length >= MAX_WIRE_CHAIN_LENGTH) break;
	}
	return chain;
}

/**
 * Merge an inbound chain with this habitat's own identity.
 *
 * The receiving habitat appends itself, so the next hop sees the full path.
 * A chain that already contains this habitat is a cycle, which the guard
 * catches when the next call is attempted.
 */
export function extendAgentChain(
	inbound: string[],
	selfId: string | undefined,
): string[] {
	if (!selfId) return inbound;
	return [...inbound, selfId];
}
