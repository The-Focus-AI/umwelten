/**
 * Report Adapters
 *
 * Convert specific result types to the unified Report format.
 */

export { adaptToolTestResults } from './tool-test-adapter.js';
export {
  adaptSimpleTestResults,
  adaptSingleTestResult,
  type SimpleTestResult,
  type SimpleTestReportOptions,
} from './simple-test-adapter.js';
