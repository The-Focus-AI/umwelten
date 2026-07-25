/**
 * never — the control.
 *
 * Never forks. Every experiment needs the "one long chat" baseline to compare
 * context growth and cost against; this is it.
 */

import type { DetectorResult } from "../types.js";
import { continueResult, type DetectorContext, type FissionDetector } from "./types.js";

export const neverDetector: FissionDetector = {
  id: "never",
  name: "Never fork (control)",
  description: "Always continues. The single-long-chat baseline.",
  usesLlm: false,
  async detect(ctx: DetectorContext): Promise<DetectorResult> {
    return continueResult("never", ctx, "Control detector — never forks.");
  },
};
