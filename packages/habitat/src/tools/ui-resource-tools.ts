/**
 * UI-resource tool — lets an agent emit an mcp-ui UI resource that the runtime
 * carries to the user (ADR 0005 slice B, #195). The agent author never picks a
 * transport: it publishes one resource; the A2A executor drains and emits it.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  buildHabitatUIResource,
  publishUIResource,
  withUIResources,
} from "../ui-resources.js";

export interface UIResourceToolsContext {
  getWorkDir(): string;
  /** Public origin to absolutize a relative externalUrl (#194). */
  getPublicOrigin?(): string | undefined;
}

export function createUIResourceTools(
  ctx: UIResourceToolsContext,
): Record<string, Tool> {
  const publishUiResource = tool({
    description:
      "Emit a renderable UI resource (mcp-ui) to show the user — a chart, form, " +
      "card, or embedded view — instead of plain text. Provide EITHER `html` " +
      "(inline HTML, rendered in a sandboxed iframe) OR `externalUrl` (a page " +
      "you host). The resource is rendered by the chat client; you do not pick a " +
      "transport. Use a stable `ui://` id.",
    inputSchema: z
      .object({
        uri: z
          .string()
          .describe("Resource id — must start with ui:// (e.g. ui://habitat/sales-chart)"),
        html: z
          .string()
          .optional()
          .describe("Inline HTML for the rawHtml modality (mutually exclusive with externalUrl)"),
        externalUrl: z
          .string()
          .optional()
          .describe("URL to embed for the externalUrl modality (mutually exclusive with html)"),
      })
      .describe("Exactly one of html / externalUrl must be set."),
    execute: async ({ uri, html, externalUrl }) => {
      // buildHabitatUIResource validates uri/arity and rejects remoteDom.
      const resource = buildHabitatUIResource({
        uri,
        html,
        externalUrl,
        origin: ctx.getPublicOrigin?.(),
      });
      await publishUIResource(ctx.getWorkDir(), resource);
      // Carry the resource on the result so the MCP bridge emits it as an
      // EmbeddedResource block (#196); the A2A path drains it from the buffer.
      return withUIResources(
        {
          published: true,
          uri: resource.uri,
          mimeType: resource.mimeType,
          note: "UI resource queued for this turn; it renders in the chat client.",
        },
        [resource],
      );
    },
  });

  return { publish_ui_resource: publishUiResource };
}
