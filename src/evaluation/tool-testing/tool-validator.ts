/**
 * Tool Validator - validates tool calls against expectations
 */

import {
  ConversationStep,
  ExpectedToolCall,
  StepValidation,
  StepValidationResult,
  ToolCall,
} from './types.js';
import { ModelResponse } from '../../cognition/types.js';

export class ToolValidator {
  /**
   * Validate a step's response against expectations
   */
  validateStep(
    step: ConversationStep,
    response: ModelResponse,
    toolCalls: ToolCall[],
    duration: number
  ): StepValidationResult {
    const failures: string[] = [];

    // Validate expected tool calls
    if (step.expectedToolCalls) {
      const toolCallFailures = this.validateToolCalls(
        step.expectedToolCalls,
        toolCalls
      );
      failures.push(...toolCallFailures);
    }

    // Validate step validation rules
    if (step.validation) {
      const validationFailures = this.validateResponse(
        step.validation,
        response,
        toolCalls
      );
      failures.push(...validationFailures);
    }

    return {
      passed: failures.length === 0,
      failures,
      toolCalls,
      response,
      duration,
    };
  }

  /**
   * Validate tool calls against expectations
   */
  private validateToolCalls(
    expected: ExpectedToolCall[],
    actual: ToolCall[]
  ): string[] {
    const failures: string[] = [];

    for (const expectedCall of expected) {
      const required = expectedCall.required !== false;

      // Find matching tool call
      const matchingCall = actual.find(
        (call) => call.toolName === expectedCall.toolName
      );

      if (!matchingCall) {
        if (required) {
          failures.push(
            `Expected tool '${expectedCall.toolName}' was not called`
          );
        }
        continue;
      }

      // Validate parameters if specified
      if (expectedCall.parameters !== undefined) {
        const paramResult = this.validateParameters(
          expectedCall.parameters,
          matchingCall.args,
          expectedCall.toolName
        );
        if (paramResult) {
          failures.push(paramResult);
        }
      }

      // Validate result if specified
      if (expectedCall.result !== undefined && matchingCall.result !== undefined) {
        const resultValid = this.compareValue(
          expectedCall.result,
          matchingCall.result
        );
        if (!resultValid) {
          failures.push(
            `Tool '${expectedCall.toolName}' result mismatch: ` +
            `expected ${JSON.stringify(expectedCall.result)}, ` +
            `got ${JSON.stringify(matchingCall.result)}`
          );
        }
      }
    }

    return failures;
  }

  /**
   * Validate parameters against expectation
   */
  private validateParameters(
    expected: Record<string, any> | ((params: any) => boolean),
    actual: Record<string, any>,
    toolName: string
  ): string | null {
    // Predicate function
    if (typeof expected === 'function') {
      try {
        const valid = expected(actual);
        if (!valid) {
          return `Tool '${toolName}' parameters failed validation predicate`;
        }
      } catch (error) {
        return `Tool '${toolName}' parameter validation threw error: ${error}`;
      }
      return null;
    }

    // Object comparison - check expected keys exist in actual
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (!(key in actual)) {
        return `Tool '${toolName}' missing parameter '${key}'`;
      }

      const actualValue = actual[key];
      if (!this.compareValue(expectedValue, actualValue)) {
        return (
          `Tool '${toolName}' parameter '${key}' mismatch: ` +
          `expected ${JSON.stringify(expectedValue)}, ` +
          `got ${JSON.stringify(actualValue)}`
        );
      }
    }

    return null;
  }

  /**
   * Validate response against validation rules
   */
  private validateResponse(
    validation: StepValidation,
    response: ModelResponse,
    toolCalls: ToolCall[]
  ): string[] {
    const failures: string[] = [];
    const content = response.content || '';

    // contentContains check
    if (validation.contentContains) {
      for (const expected of validation.contentContains) {
        if (!content.includes(expected)) {
          failures.push(`Response should contain '${expected}'`);
        }
      }
    }

    // contentMatches check
    if (validation.contentMatches) {
      if (!validation.contentMatches.test(content)) {
        failures.push(
          `Response should match pattern ${validation.contentMatches}`
        );
      }
    }

    // toolCallCount check
    if (validation.toolCallCount) {
      const count = toolCalls.length;
      const { min, max } = validation.toolCallCount;

      if (min !== undefined && count < min) {
        failures.push(
          `Expected at least ${min} tool calls, got ${count}`
        );
      }
      if (max !== undefined && count > max) {
        failures.push(
          `Expected at most ${max} tool calls, got ${count}`
        );
      }
    }

    // custom validation
    if (validation.custom) {
      try {
        const valid = validation.custom(response, toolCalls);
        if (!valid) {
          failures.push('Custom validation failed');
        }
      } catch (error) {
        failures.push(`Custom validation threw error: ${error}`);
      }
    }

    return failures;
  }

  /**
   * Compare expected and actual values
   * Supports predicate functions
   */
  private compareValue(expected: any, actual: any): boolean {
    // Predicate function
    if (typeof expected === 'function') {
      try {
        return expected(actual);
      } catch {
        return false;
      }
    }

    // Array comparison
    if (Array.isArray(expected) && Array.isArray(actual)) {
      if (expected.length !== actual.length) return false;
      return expected.every((val, i) => this.compareValue(val, actual[i]));
    }

    // Object comparison
    if (
      typeof expected === 'object' &&
      expected !== null &&
      typeof actual === 'object' &&
      actual !== null
    ) {
      const expectedKeys = Object.keys(expected);
      for (const key of expectedKeys) {
        if (!(key in actual)) return false;
        if (!this.compareValue(expected[key], actual[key])) return false;
      }
      return true;
    }

    // Primitive comparison
    return expected === actual;
  }
}
