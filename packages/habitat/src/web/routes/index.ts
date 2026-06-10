import type { RouteHandler } from '../types.js';
import { meRoute } from './me.js';
import { habitatRoute } from './habitat.js';
import { usageRoute } from './usage.js';
import {
  sessionsListRoute,
  sessionShowRoute,
  sessionMessagesRoute,
  sessionBeatsRoute,
} from './sessions.js';
import { contextShowRoute, contextTranscriptRoute } from './contexts.js';

/**
 * The default route set every web app gets for free.
 * Apps can add their own routes via WebServerConfig.routes.
 */
export function defaultRoutes(): RouteHandler[] {
  return [
    meRoute,
    usageRoute,
    habitatRoute,
    sessionsListRoute,
    // Order matters: more specific paths first so the :id route doesn't
    // swallow /api/sessions/:id/messages or /beats.
    sessionMessagesRoute,
    sessionBeatsRoute,
    sessionShowRoute,
    contextTranscriptRoute,
    contextShowRoute,
  ];
}
