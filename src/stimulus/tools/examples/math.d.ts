import { z } from "zod";
import { ToolDefinition } from "../types.js";
declare const calculatorSchema: z.ZodObject<{
    operation: z.ZodEnum<{
        add: "add";
        subtract: "subtract";
        multiply: "multiply";
        divide: "divide";
    }>;
    a: z.ZodNumber;
    b: z.ZodNumber;
}, z.core.$strip>;
declare const randomNumberSchema: z.ZodObject<{
    min: z.ZodNumber;
    max: z.ZodNumber;
    integer: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
declare const statisticsSchema: z.ZodObject<{
    numbers: z.ZodArray<z.ZodNumber>;
}, z.core.$strip>;
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
