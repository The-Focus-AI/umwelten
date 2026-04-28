/**
 * @deprecated The implementation now lives in
 * `examples/local-providers/harness/{eviction,system-state}.ts`. This
 * file is a thin re-export shim so the old `run-quality.ts` keeps
 * working during the migration. New code should import from
 * `../harness/index.js` directly. Delete once `run-quality.ts` is gone.
 */

export {
  evictAll,
  waitForMemoryBelow,
  fmtBytes,
} from '../harness/eviction.js';

export { getModelMemoryBytes as sampleModelRssBytes } from '../harness/system-state.js';
