import { ToolDefinition } from "../types.js";
declare const calculatorSchema: any;
declare const randomNumberSchema: any;
declare const statisticsSchema: any;
/**
 * Calculator tool for basic arithmetic operations
 */
export declare const calculatorTool: ToolDefinition<typeof calculatorSchema>;
/**
 * Random number generator tool
 */
export declare const randomNumberTool: ToolDefinition<typeof randomNumberSchema>;
/**
 * Statistics tool for basic statistical calculations
 */
export declare const statisticsTool: ToolDefinition<typeof statisticsSchema>;
export {};
