export type ScalarType =
	| "string"
	| "integer"
	| "float"
	| "boolean"
	| "date"
	| "datetime"
	| "json";

export interface ParsingSpec {
	format: "csv";
	encoding: string;
	delimiter: string;
	has_header: boolean;
	header_row_index: number;
	data_start_row_index: number;
	null_tokens: string[];
	columns: Array<{ name: string; type: ScalarType }>;
}

export interface DomainSpec {
	table_name: string;
	primary_key: string[];
	time_fields: string[];
	dimensions: string[];
	measures: string[];
	faq_queries: Array<{ name: string; sql: string }>;
}