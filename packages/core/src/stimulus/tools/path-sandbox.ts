/**
 * Shared path-sandboxing helpers.
 *
 * `resolveSandboxPath` resolves a user-supplied path against a set of allowed roots.
 * Leading "/" is treated as a virtual root mapped to the first allowed root (chroot-style),
 * matching the convention used by the habitat file tools.
 *
 * `ensureAllowed` throws OUTSIDE_ALLOWED_PATH if the resolved path falls outside every
 * allowed root. Both functions are pure and synchronous.
 */

import { resolve, normalize, relative } from 'node:path';

export const OUTSIDE_ALLOWED_PATH = 'OUTSIDE_ALLOWED_PATH';

/**
 * Resolve a path against the first allowed root. If `rawPath` is absolute and
 * already falls under one of the roots, return it untouched. A leading "/" is
 * treated as the virtual workspace root (the first entry of `roots`).
 */
export function resolveSandboxPath(rawPath: string, roots: string[]): string {
  if (roots.length === 0) {
    throw new Error('resolveSandboxPath: roots must not be empty');
  }
  const workDir = roots[0];

  if (rawPath.startsWith('/') && !rawPath.startsWith('//')) {
    const asAbsolute = normalize(resolve(rawPath));
    for (const root of roots) {
      const rootNorm = normalize(root);
      const rel = relative(rootNorm, asAbsolute);
      if (rel === '' || (!rel.startsWith('..') && rel !== '..')) {
        return asAbsolute;
      }
    }
    const underWork = rawPath.slice(1) || '.';
    return resolve(workDir, underWork);
  }

  if (rawPath.startsWith('\\') || (process.platform === 'win32' && /^[A-Za-z]:/.test(rawPath))) {
    return normalize(resolve(rawPath));
  }

  return resolve(workDir, rawPath);
}

/**
 * Throw OUTSIDE_ALLOWED_PATH if `resolved` is not under any of `roots`.
 */
export function ensureAllowed(resolved: string, roots: string[]): void {
  const normalized = normalize(resolved);

  for (const root of roots) {
    const rootNorm = normalize(root);
    const rel = relative(rootNorm, normalized);
    if (rel && !rel.startsWith('..') && !rel.startsWith('/')) return;
    if (normalized === rootNorm) return;
  }
  throw new Error(
    `${OUTSIDE_ALLOWED_PATH}: path is not under the work directory, sessions directory, or any configured agent project`
  );
}
