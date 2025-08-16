import 'dotenv/config';
export declare function createLLM(): {
    explainField(column: string, sampleValues: any[]): Promise<string>;
    suggestQueries(domainSpec: any, table: string): Promise<any>;
};
