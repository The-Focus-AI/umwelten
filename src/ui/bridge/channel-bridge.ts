/**
 * ChannelBridge — the shared core that all platform adapters use.
 *
 * Absorbs the duplicated logic from Discord, Telegram, and Gaia:
 *  - Interaction caching (keyed by channelKey)
 *  - Route resolution (channelKey → agent → stimulus)
 *  - Transcript resume (reload last N pairs on restart)
 *  - Transcript persistence (write to session dir on every update)
 *  - Tool-call-with-no-text follow-up
 *  - Event emission (text deltas, tool calls, done, error)
 *
 * Platform adapters become thin: receive message → call bridge → format + send.
 */

import type { CoreMessage } from 'ai';
import type { Habitat } from '../../habitat/habitat.js';
import { buildAgentStimulus } from '../../habitat/habitat-agent.js';
import { Interaction } from '../../interaction/core/interaction.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { writeSessionTranscript } from '../../habitat/transcript.js';
import { loadRecentHabitatTranscriptCoreMessages } from '../../session-record/habitat-transcript-load.js';
import { resolveChannelRoute, loadRouting, routeSignature } from './routing.js';
import type {
  ChannelMessage,
  BridgeEventHandlers,
  BridgeResult,
  ChannelBridgeOptions,
  RouteResolution,
} from './types.js';

// ── Cached interaction entry ─────────────────────────────────────────

interface InteractionEntry {
  interaction: Interaction;
  sessionId: string;
  sessionDir: string;
  routeSig: string;
}

// ── ChannelBridge ────────────────────────────────────────────────────

export class ChannelBridge {
  private habitat: Habitat;
  private cache = new Map<string, InteractionEntry>();
  private resumeMessagePairs: number;
  private platformInstruction?: string;
  private routingPath?: string;

  constructor(
    habitat: Habitat,
    options?: ChannelBridgeOptions & { routingPath?: string },
  ) {
    this.habitat = habitat;
    this.resumeMessagePairs = options?.resumeMessagePairs ?? 4;
    this.platformInstruction = options?.platformInstruction;
    this.routingPath = options?.routingPath;
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * The ONE method every adapter calls.
   * Resolves routing, gets or creates an Interaction, streams the LLM,
   * persists the transcript, and emits events to the adapter.
   */
  async handleMessage(
    msg: ChannelMessage,
    events: BridgeEventHandlers,
  ): Promise<void> {
    try {
      const entry = await this.getOrCreateEntry(msg);
      const { interaction, sessionId, sessionDir } = entry;

      // Wire transcript persistence and event emission
      const msgCountBefore = interaction.getMessages().length;
      const originalCallback = interaction.onTranscriptUpdate;
      interaction.setOnTranscriptUpdate((messages) => {
        // Detect tool calls / results in new messages
        for (let i = msgCountBefore + 1; i < messages.length; i++) {
          const m = messages[i];
          if (m.role === 'assistant' && Array.isArray(m.content)) {
            for (const part of m.content as unknown as Array<Record<string, unknown>>) {
              if (part.type === 'tool-call' && events.onToolCall) {
                events.onToolCall(
                  part.toolName as string,
                  part.input ?? part.args,
                );
              }
            }
          }
          if (m.role === 'tool' && Array.isArray(m.content)) {
            for (const part of m.content as unknown as Array<Record<string, unknown>>) {
              if (part.type === 'tool-result' && events.onToolResult) {
                const output = part.output as Record<string, unknown> | undefined;
                const outputStr = output?.value != null
                  ? String(output.value).slice(0, 500)
                  : typeof part.content === 'string'
                    ? (part.content as string).slice(0, 500)
                    : '';
                events.onToolResult(
                  part.toolName as string,
                  outputStr,
                  output?.type === 'error-text',
                );
              }
            }
          }
        }
        // Persist to disk
        void writeSessionTranscript(sessionDir, messages);
      });

      // Add the user message
      interaction.addMessage({ role: 'user', content: msg.text });

      // Stream the response
      let response;
      try {
        response = await interaction.streamText();
      } finally {
        interaction.onTranscriptUpdate = originalCallback ?? undefined;
      }

      let content = typeof response.content === 'string' ? response.content : '';
      const reasoning = typeof response.reasoning === 'string'
        ? response.reasoning
        : response.reasoning != null
          ? String(response.reasoning)
          : undefined;

      // Handle tool-call-with-no-text follow-up (duplicated in Discord + Telegram)
      if (!content.trim() && response.metadata) {
        const meta = response.metadata as { toolCalls?: unknown[] };
        if (Array.isArray(meta.toolCalls) && meta.toolCalls.length > 0) {
          try {
            const followUp = await interaction.streamText();
            const followText = typeof followUp.content === 'string' ? followUp.content : '';
            if (followText.trim()) {
              content = followText;
            }
          } catch {
            // fall through with empty content
          }
        }
      }

      // Final transcript write
      await writeSessionTranscript(sessionDir, interaction.getMessages());

      // Emit done
      const result: BridgeResult = {
        content,
        sessionId,
        channelKey: msg.channelKey,
        reasoning,
      };
      await events.onDone(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (events.onError) {
        events.onError(message);
      } else {
        console.error(`[ChannelBridge] Error for ${msg.channelKey}:`, err);
      }
    }
  }

  /** Clear the cached interaction for a channel (used on /reset, /start). */
  resetChannel(channelKey: string): void {
    this.cache.delete(channelKey);
  }

  /** Get the session id for a channel (if an interaction exists). */
  getChannelSessionId(channelKey: string): string | undefined {
    return this.cache.get(channelKey)?.sessionId;
  }

  /** Clear all cached interactions (e.g. on routing reload). */
  resetAll(): void {
    this.cache.clear();
  }

  /** Resolve routing for a channel key (useful for platform adapters that need route info). */
  async resolveRoute(
    channelKey: string,
    parentChannelKey?: string,
  ): Promise<RouteResolution> {
    const routing = await loadRouting(this.habitat.workDir, this.routingPath);
    return resolveChannelRoute(channelKey, routing, parentChannelKey);
  }

  // ── Internals ──────────────────────────────────────────────────────

  /**
   * Get or create an InteractionEntry for a channel.
   * Invalidates the cache if the route signature changed.
   */
  private async getOrCreateEntry(msg: ChannelMessage): Promise<InteractionEntry> {
    const { channelKey, parentChannelKey } = msg;

    // Resolve current route
    const routing = await loadRouting(this.habitat.workDir, this.routingPath);
    const resolution = resolveChannelRoute(channelKey, routing, parentChannelKey);
    const sig = routeSignature(resolution);

    // Check cache: hit if entry exists and route hasn't changed
    const existing = this.cache.get(channelKey);
    if (existing && existing.routeSig === sig) {
      return existing;
    }

    // Build the stimulus for this route
    const stimulus = await this.buildStimulusForRoute(resolution);

    // Create interaction
    const interaction = new Interaction(
      this.habitat.getDefaultModelDetails()!,
      stimulus,
    );

    // Set userId if provided
    if (msg.userId) {
      interaction.userId = msg.userId;
    }

    // Create session on disk
    const platform = channelKey.slice(0, channelKey.indexOf(':')) || 'web';
    const identifier = channelKey.slice(channelKey.indexOf(':') + 1);
    const session = await this.habitat.getOrCreateSession(
      platform as any,
      identifier,
    );

    // Resume from transcript
    await this.resumeFromTranscript(session.sessionDir, interaction);

    const entry: InteractionEntry = {
      interaction,
      sessionId: session.sessionId,
      sessionDir: session.sessionDir,
      routeSig: sig,
    };
    this.cache.set(channelKey, entry);
    return entry;
  }

  /** Build a Stimulus for the resolved route. */
  private async buildStimulusForRoute(resolution: RouteResolution): Promise<Stimulus> {
    let baseStimulus: Stimulus;

    if (resolution.kind === 'agent') {
      const agent = this.habitat.getAgent(resolution.agentId);
      if (agent) {
        baseStimulus = await buildAgentStimulus(agent, this.habitat);
      } else {
        console.warn(
          `[ChannelBridge] Route references unknown agent "${resolution.agentId}"; using main stimulus.`,
        );
        baseStimulus = await this.habitat.getStimulus();
      }
    } else {
      baseStimulus = await this.habitat.getStimulus();
    }

    // Clone so we don't mutate the habitat's cached stimulus
    const stimulus = new Stimulus(baseStimulus.options);
    for (const [name, tool] of Object.entries(baseStimulus.getTools())) {
      stimulus.addTool(name, tool);
    }

    // Add platform-specific instruction
    if (this.platformInstruction) {
      stimulus.addInstruction(this.platformInstruction);
    }

    return stimulus;
  }

  /** Load the last N message pairs from a previous transcript. */
  private async resumeFromTranscript(
    sessionDir: string,
    interaction: Interaction,
  ): Promise<void> {
    try {
      const maxMessages = this.resumeMessagePairs * 2;
      const recent = await loadRecentHabitatTranscriptCoreMessages(
        sessionDir,
        maxMessages,
      );
      if (recent.length === 0) return;

      for (const msg of recent) {
        interaction.addMessage(msg);
      }
      console.log(
        `[ChannelBridge] Resumed ${recent.length} messages for session in ${sessionDir}`,
      );
    } catch {
      // Non-fatal — just start fresh
    }
  }
}
