import { describe, it, expect } from 'vitest';
import { detectHeaderAndData } from '../headerDetector.js';

describe('headerDetector', () => {
	it('detects immediate header at row 0', async () => {
		const rows = [
			['id','name'],
			['1','Alice'],
			['2','Bob'],
			['3','Cara'],
			['4','Dan'],
			['5','Ed']
		];
		const res = await detectHeaderAndData(rows, ',', false, '');
		expect(res.header_row_index).toBe(0);
		expect(res.data_start_row_index).toBe(1);
		expect(res.has_header).toBe(true);
	});

	it('handles preamble of 8 junk lines', async () => {
		const pre = Array.from({ length: 8 }, (_, i) => [`junk ${i}`]);
		const body = [
			['id','name'],
			['1','Alice'],
			['2','Bob'],
			['3','Cara'],
			['4','Dan'],
		];
		const rows = [...pre, ...body];
		const res = await detectHeaderAndData(rows, ',', false, '');
		expect(res.data_start_row_index).toBe(9);
	});
});