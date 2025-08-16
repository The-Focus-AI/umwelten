import { z } from 'zod';

export const ScalarTypeSchema = z.enum([
	"string",
	"integer",
	"float",
	"boolean",
	"date",
	"datetime",
	"json",
]);

export const ParsingSpecSchema = z.object({
	format: z.literal("csv"),
	encoding: z.string().min(1),
	delimiter: z.string().min(1),
	has_header: z.boolean(),
	header_row_index: z.number().int().min(0),
	data_start_row_index: z.number().int().min(0),
	null_tokens: z.array(z.string()),
	columns: z.array(
		z.object({
			name: z.string().min(1),
			type: ScalarTypeSchema,
		})
	).min(1),
});

export const DomainSpecSchema = z.object({
	table_name: z.string().min(1),
	primary_key: z.array(z.string()).default([]),
	time_fields: z.array(z.string()).default([]),
	dimensions: z.array(z.string()).default([]),
	measures: z.array(z.string()).default([]),
	faq_queries: z.array(
		z.object({ name: z.string().min(1), sql: z.string().min(1) })
	).default([]),
});

export type ParsingSpec = z.infer<typeof ParsingSpecSchema>;
export type DomainSpec = z.infer<typeof DomainSpecSchema>;

export function validateParsingSpec(input: unknown) {
	const result = ParsingSpecSchema.safeParse(input);
	if (!result.success) {
		const message = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
		throw new Error(`ParsingSpec validation failed:\n${message}`);
	}
	return result.data;
}

export function validateDomainSpec(input: unknown) {
	const result = DomainSpecSchema.safeParse(input);
	if (!result.success) {
		const message = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
		throw new Error(`DomainSpec validation failed:\n${message}`);
	}
	return result.data;
}