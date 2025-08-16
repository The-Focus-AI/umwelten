import 'dotenv/config';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

export type HeaderDecision = { header_row_index: number; data_start_row_index: number };

export function createLLMClient(modelId = process.env.WEIRD_MODEL || 'gemini-2.5-pro-latest') {
	const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
	if (!apiKey) {
		throw new Error('Missing GOOGLE_API_KEY in environment');
	}
	const model = google(modelId);

	return {
		async decideHeaderBoundary(snippet: string, delimiter: string): Promise<HeaderDecision | null> {
			const system = 'You are a CSV structure detector. Output JSON with two integers only.';
			const user = `Delimiter: ${delimiter}\nLines:\n${snippet}\nRespond strictly as JSON: { "header_row_index": <int>, "data_start_row_index": <int> }`;
			const res = await generateText({ model, prompt: `${system}\n${user}` });
			return safeParseJSON(res.text.trim());
		},
		async generateParsingSpec(payload: string): Promise<any> {
			const system = 'Output only valid JSON matching the ParsingSpec schema. No prose.';
			const res = await generateText({ model, prompt: `${system}\n${payload}` });
			return safeParseJSON(res.text.trim());
		},
		async generateDomainSpec(payload: string): Promise<any> {
			const system = 'Output only valid JSON matching the DomainSpec schema. No prose.';
			const res = await generateText({ model, prompt: `${system}\n${payload}` });
			return safeParseJSON(res.text.trim());
		},
	};
}

function safeParseJSON(text: string): any | null {
	try {
		return JSON.parse(text);
	} catch {
		// attempt to extract first {...} block
		const m = text.match(/\{[\s\S]*\}/);
		if (!m) return null;
		try { return JSON.parse(m[0]); } catch { return null; }
	}
}