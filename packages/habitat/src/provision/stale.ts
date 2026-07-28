/**
 * The stale mark (umwelten #276).
 *
 * A Dormant habitat cannot be refreshed in place — there is no process to
 * ask. Gaia drops this marker on its volume instead, and the habitat picks it
 * up on its next wake, refreshes, and clears it. The mark lives on the volume
 * rather than on the registry entry so the habitat itself is the thing that
 * clears it: a mark cleared by the caller says "I asked", not "it happened".
 *
 * Shared by the habitat's provisioner and Gaia's `refresh_habitat`, so the two
 * cannot drift on the filename.
 */

import { join } from "node:path";

/** Marker file, relative to the habitat work directory. */
export const STALE_MARKER_FILE = ".needs-refresh";

/** Marker written once a volume has been fully provisioned at least once. */
export const PROVISIONED_MARKER_FILE = ".provisioned";

export function staleMarkerPath(workDir: string): string {
  return join(workDir, STALE_MARKER_FILE);
}

export function provisionedMarkerPath(workDir: string): string {
  return join(workDir, PROVISIONED_MARKER_FILE);
}
