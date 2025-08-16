import { describe, it, expect } from 'vitest';
import { sniffDelimiter } from '../csvSampler.js';

describe('delimiter sniff', () => {
	it('detects comma', () => {
		const sample = ['a,b,c','1,2,3','4,5,6'].join('\n');
		expect(sniffDelimiter(sample)).toBe(',');
	});
	it('detects tab', () => {
		const sample = ['a\tb\tc','1\t2\t3','4\t5\t6'].join('\n');
		expect(sniffDelimiter(sample)).toBe('\t');
	});
});