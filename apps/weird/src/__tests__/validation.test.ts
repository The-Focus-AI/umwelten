import { describe, it, expect } from 'vitest';
import { validateParsingSpec, validateDomainSpec } from '../validation.js';

describe('spec validation', () => {
	it('accepts minimal valid ParsingSpec', () => {
		const spec = validateParsingSpec({
			format: 'csv',
			encoding: 'utf-8',
			delimiter: ',',
			has_header: true,
			header_row_index: 0,
			data_start_row_index: 1,
			null_tokens: ['','NULL'],
			columns: [{ name: 'col1', type: 'string' }]
		});
		expect(spec.columns[0].name).toBe('col1');
	});

	it('rejects invalid ParsingSpec', () => {
		expect(() => validateParsingSpec({})).toThrow();
	});

	it('accepts minimal DomainSpec', () => {
		const dom = validateDomainSpec({
			table_name: 't',
			primary_key: [],
			time_fields: [],
			dimensions: [],
			measures: [],
			faq_queries: []
		});
		expect(dom.table_name).toBe('t');
	});
});