import 'dotenv/config';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
export function createLLM() {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey)
        throw new Error('Missing GOOGLE_API_KEY');
    const modelId = process.env.WEIRD_MODEL || 'gemini-2.5-pro-latest';
    const model = google({ apiKey }).text(modelId);
    return {
        async explainField(column, sampleValues) {
            const prompt = [
                'Explain briefly what this field likely represents.',
                `Field: ${column}`,
                'Sample values:',
                JSON.stringify(sampleValues.slice(0, 20))
            ].join('\n');
            const res = await generateText({ model, prompt });
            return res.text;
        },
        async suggestQueries(domainSpec, table) {
            const prompt = [
                'Return 2–5 short parameterized SQL templates as JSON array. No prose.',
                `Use table name: ${table}`,
                `DomainSpec: ${JSON.stringify(domainSpec)}`,
                'Format: [ { name, sql } ]'
            ].join('\n');
            const res = await generateText({ model, prompt });
            try {
                return JSON.parse(res.text);
            }
            catch {
                return [];
            }
        }
    };
}
//# sourceMappingURL=client.js.map