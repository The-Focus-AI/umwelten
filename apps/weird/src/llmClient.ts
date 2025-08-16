import 'dotenv/config';

export type HeaderDecision = { header_row_index: number; data_start_row_index: number };

type RunnerCtor = new (...args: any[]) => any;
type InteractionCtor = new (...args: any[]) => any;

async function loadCore(): Promise<{ BaseModelRunner: RunnerCtor; Interaction: InteractionCtor }> {
	try {
		// Prefer source (tsx can transpile)
		const { BaseModelRunner } = await import('../../../src/cognition/runner.ts');
		const { Interaction } = await import('../../../src/interaction/interaction.ts');
		return { BaseModelRunner, Interaction } as any;
	} catch {
		// Fallback to built dist
		const { BaseModelRunner } = await import('../../../dist/cognition/runner.js');
		const { Interaction } = await import('../../../dist/interaction/interaction.js');
		return { BaseModelRunner, Interaction } as any;
	}
}

async function runJsonPrompt(prompt: string, system: string, modelId: string): Promise<string> {
	const { BaseModelRunner, Interaction } = await loadCore();
	const runner = new BaseModelRunner();
	const interaction = new Interaction({ name: modelId, provider: 'google' }, system);
	interaction.addMessage({ role: 'user', content: prompt });
	const result = await runner.generateText(interaction);
	return (result?.content || '').toString();
}

export function createLLMClient(modelId = process.env.WEIRD_MODEL || 'gemini-2.5-pro-latest') {
	const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
	if (!apiKey) {
		throw new Error('Missing GOOGLE_API_KEY in environment');
	}
	return {
		async decideHeaderBoundary(snippet: string, delimiter: string): Promise<HeaderDecision | null> {
			const system = 'You are a CSV structure detector. Output JSON with two integers only.';
			const user = `Delimiter: ${delimiter}\nLines:\n${snippet}\nRespond strictly as JSON: { "header_row_index": <int>, "data_start_row_index": <int> }`;
			const text = await runJsonPrompt(user, system, modelId as string);
			return safeParseJSON(text);
		},
		async generateParsingSpec(payload: string): Promise<any> {
			const system = 'Output only valid JSON matching the ParsingSpec schema. No prose.';
			const text = await runJsonPrompt(payload, system, modelId as string);
			return safeParseJSON(text);
		},
		async generateDomainSpec(payload: string): Promise<any> {
			const system = 'Output only valid JSON matching the DomainSpec schema. No prose.';
			const text = await runJsonPrompt(payload, system, modelId as string);
			return safeParseJSON(text);
		},
	};
}

function safeParseJSON(text: string): any | null {
	try {
		return JSON.parse(text);
	} catch {
		const m = text.match(/\{[\s\S]*\}/);
		if (!m) return null;
		try { return JSON.parse(m[0]); } catch { return null; }
	}
}