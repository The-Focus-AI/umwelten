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
import type { AgentHost } from '../types.js';
import { Interaction } from '@umwelten/core/interaction/core/interaction.js';
import { Stimulus } from '@umwelten/core/stimulus/stimulus.js';
import { writeSessionTranscript } from '@umwelten/core/session-record/transcript-write.js';
import { loadRecentHabitatTranscriptCoreMessages } from '@umwelten/core/session-record/habitat-transcript-load.js';
import { resolveChannelRoute, loadRouting, routeSignature, setChannelRoute } from './routing.js';
import type {
  ChannelMessage,
  BridgeEventHandlers,
  BridgeResult,
  ChannelBridgeOptions,
  ChannelRuntimeMode,
  RouteResolution,
  RuntimeContext,
  RuntimeRunner,
} from './types.js';

// ── Cached interaction entry ─────────────────────────────────────────

interface InteractionEntry {
  interaction: Interaction;
  sessionId: string;
  sessionDir: string;
  routeSig: string;
}

// ── ChannelBridge ────────────────────────────────────────────────────

/**
 * Callback to build a Stimulus for a specific agent.
 * Injected by the caller so ChannelBridge doesn't import habitat-agent.ts directly.
 */
export type BuildAgentStimulusFn = (
  agent: import('../types.js').AgentEntry,
  host: AgentHost,
) => Promise<Stimulus>;

/**
 * Legacy callback to run a message through the Claude Agent SDK.
 * Kept for callers that haven't moved to the RuntimeRunner seam (#118);
 * the bridge wraps it into a RuntimeRunner internally. New code should
 * register `runtimeRunners: { 'claude-sdk': createClaudeSdkRuntimeRunner() }`.
 */
export type RunClaudeSdkFn = (
  prompt: string,
  options: { cwd: string; apiKey?: string; maxTurns?: number },
) => Promise<{ content: string; success: boolean; errors: string[] }>;

/** Wrap the legacy claude-sdk callback in the RuntimeRunner contract. */
function wrapLegacyClaudeSdkFn(fn: RunClaudeSdkFn): RuntimeRunner {
  return {
    async run(prompt, ctx) {
      const result = await fn(prompt, {
        cwd: ctx.agent.projectPath,
        apiKey: process.env.ANTHROPIC_API_KEY,
        maxTurns: 25,
      });
      // The legacy fn surfaces no native session id — no ref to record.
      return {
        content: result.content,
        success: result.success,
        errors: result.errors,
      };
    },
  };
}

export class ChannelBridge {
  private host: AgentHost;
  private cache = new Map<string, InteractionEntry>();
  private resumeMessagePairs: number;
  private platformInstruction?: string;
  private routingPath?: string;
  private buildAgentStimulusFn?: BuildAgentStimulusFn;
  private runtimeRunners = new Map<ChannelRuntimeMode, RuntimeRunner>();

  constructor(
    host: AgentHost,
    options?: ChannelBridgeOptions & {
      routingPath?: string;
      buildAgentStimulus?: BuildAgentStimulusFn;
      /** Legacy seam — wrapped into a claude-sdk RuntimeRunner. */
      runClaudeSdk?: RunClaudeSdkFn;
      /** Runners for non-default runtimes (#118). Takes precedence. */
      runtimeRunners?: Partial<Record<ChannelRuntimeMode, RuntimeRunner>>;
    },
  ) {
    this.host = host;
    this.resumeMessagePairs = options?.resumeMessagePairs ?? 4;
    this.platformInstruction = options?.platformInstruction;
    this.routingPath = options?.routingPath;
    this.buildAgentStimulusFn = options?.buildAgentStimulus;
    if (options?.runClaudeSdk) {
      this.runtimeRunners.set('claude-sdk', wrapLegacyClaudeSdkFn(options.runClaudeSdk));
    }
    for (const [mode, runner] of Object.entries(options?.runtimeRunners ?? {})) {
      if (runner) this.runtimeRunners.set(mode as ChannelRuntimeMode, runner);
    }
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * The ONE method every adapter calls.
   * Resolves routing, gets or creates an Interaction, streams the LLM,
   * persists the transcript, and emits events to the adapter.
   *
   * When the route resolves to `runtime: claude-sdk`, the message is
   * forwarded to the Claude Agent SDK instead of the normal LLM flow.
   */
  async handleMessage(
    msg: ChannelMessage,
    events: BridgeEventHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      // Non-default runtimes dispatch through the RuntimeRunner seam (#118)
      const route = await this.resolveRoute(msg.channelKey, msg.parentChannelKey);
      if (route.kind === 'agent' && route.runtime !== 'default') {
        return await this.handleRuntime(msg, route.agentId, route.runtime, events);
      }

      const entry = await this.getOrCreateEntry(msg);
      const { interaction, sessionId, sessionDir } = entry;

      // Wire transcript persistence (no more event extraction here — the
      // StreamObserver below receives events directly from the runner).
      const originalCallback = interaction.onTranscriptUpdate;
      interaction.setOnTranscriptUpdate((messages) => {
        void writeSessionTranscript(sessionDir, messages);
      });

      // Bridge the runner's stream events to adapter event handlers.
      const observer = {
        onTextDelta: (delta: string) => {
          events.onText?.(delta);
        },
        onReasoningDelta: (delta: string) => {
          events.onReasoning?.(delta);
        },
        onToolCall: (call: { toolCallId: string; toolName: string; input: unknown }) => {
          events.onToolCall?.(call.toolName, call.input);
        },
        onToolResult: (res: { toolCallId: string; toolName: string; output: unknown; isError: boolean }) => {
          const outputStr =
            typeof res.output === 'string'
              ? res.output.slice(0, 500)
              : JSON.stringify(res.output ?? '').slice(0, 500);
          events.onToolResult?.(res.toolName, outputStr, res.isError);
        },
      };

      // Add the user message
      interaction.addMessage({ role: 'user', content: msg.text });

      // Stream the response
      let response;
      try {
        response = await interaction.streamText(signal, observer);
      } finally {
        interaction.onTranscriptUpdate = originalCallback ?? undefined;
      }
      let finalResponse = response;

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
            const followUp = await interaction.streamText(signal, observer);
            const followText = typeof followUp.content === 'string' ? followUp.content : '';
            if (followText.trim()) {
              content = followText;
              finalResponse = followUp;
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
        metadata: finalResponse.metadata,
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
    const routing = await loadRouting(this.host.workDir, this.routingPath);
    return resolveChannelRoute(channelKey, routing, parentChannelKey);
  }

  /**
   * Switch a channel to a specific agent (or back to main).
   * Updates routing.json, invalidates the cached interaction, and returns the new route.
   *
   * Pass `null` to switch back to the main habitat persona.
   */
  async switchAgent(
    channelKey: string,
    agentId: string | null,
    runtime?: ChannelRuntimeMode,
  ): Promise<RouteResolution> {
    await setChannelRoute(
      this.host.workDir,
      channelKey,
      agentId,
      this.routingPath,
      runtime ? { runtime } : undefined,
    );
    // Invalidate cached interaction so next message picks up the new route
    this.cache.delete(channelKey);
    // Return the new resolution
    return this.resolveRoute(channelKey);
  }

  /** List available agents from the habitat config. */
  listAgents(): Array<{ id: string; name: string }> {
    return this.host.getAgents().map(a => ({ id: a.id, name: a.name }));
  }

  // ── Non-default runtime dispatch (#118) ────────────────────────────

  /**
   * Handle a message via a registered RuntimeRunner (claude-sdk, pi, …).
   *
   * The runner does the work; the bridge owns the envelope: it creates
   * the habitat session, writes the minimal user/assistant transcript
   * pair, and records the runner's nativeSessionRef in the session
   * metadata so the full native trace is linked from the Source Session.
   */
  private async handleRuntime(
    msg: ChannelMessage,
    agentId: string,
    runtime: ChannelRuntimeMode,
    events: BridgeEventHandlers,
  ): Promise<void> {
    const agent = this.host.getAgent(agentId);
    if (!agent) {
      const err = `Agent "${agentId}" not found for ${runtime} runtime`;
      if (events.onError) events.onError(err);
      else console.error(`[ChannelBridge] ${err}`);
      return;
    }

    const runner = this.runtimeRunners.get(runtime);
    if (!runner) {
      const err = `No runner registered for runtime "${runtime}" (channel ${msg.channelKey})`;
      if (events.onError) events.onError(err);
      else console.error(`[ChannelBridge] ${err}`);
      return;
    }

    try {
      // Create session on disk for transcript
      const platform = msg.channelKey.slice(0, msg.channelKey.indexOf(':')) || 'web';
      const identifier = msg.channelKey.slice(msg.channelKey.indexOf(':') + 1);
      const session = await this.host.getOrCreateSession(platform as any, identifier);

      const ctx: RuntimeContext = {
        agent,
        sessionId: session.sessionId,
        sessionDir: session.sessionDir,
        channelKey: msg.channelKey,
      };

      const result = await runner.run(msg.text, ctx, events);
      const content = result.content;

      // Write the envelope summary (user + assistant). For non-default
      // runtimes this is a summary alongside a link, not the only record.
      await writeSessionTranscript(session.sessionDir, [
        { role: 'user', content: msg.text },
        { role: 'assistant', content: content || '(no text)' },
      ]);

      // Record the native session linkage in meta.json (#118).
      if (result.nativeSessionRef) {
        await this.host
          .updateSessionMetadata(session.sessionId, {
            nativeSessionRef: result.nativeSessionRef,
          })
          .catch(() => {
            /* non-fatal — linkage is best-effort */
          });
      }

      if (!result.success && events.onError) {
        const hint = result.errors?.length
          ? result.errors.join('; ')
          : `${runtime} returned no content`;
        events.onError(`${runtime} runtime: ${hint}. Check ANTHROPIC_API_KEY.`);
        return;
      }

      await events.onDone({
        content,
        sessionId: session.sessionId,
        channelKey: msg.channelKey,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (events.onError) {
        events.onError(`${runtime} runtime failed: ${message}`);
      } else {
        console.error(`[ChannelBridge] ${runtime} error for ${msg.channelKey}:`, err);
      }
    }
  }

  // ── Internals ──────────────────────────────────────────────────────

  /**
   * Get or create an InteractionEntry for a channel.
   * Invalidates the cache if the route signature changed.
   */
  private async getOrCreateEntry(msg: ChannelMessage): Promise<InteractionEntry> {
    const { channelKey, parentChannelKey } = msg;

    // Resolve current route
    const routing = await loadRouting(this.host.workDir, this.routingPath);
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
    const modelDetails = this.host.getDefaultModelDetails();
    if (!modelDetails) {
      throw new Error(
        'No default model configured. Set defaultProvider/defaultModel in config.json, or HABITAT_PROVIDER/HABITAT_MODEL env vars.',
      );
    }
    const interaction = new Interaction(
      modelDetails,
      stimulus,
    );

    // Set userId if provided
    if (msg.userId) {
      interaction.userId = msg.userId;
    }

    // Create session on disk
    const platform = channelKey.slice(0, channelKey.indexOf(':')) || 'web';
    const identifier = channelKey.slice(channelKey.indexOf(':') + 1);
    const session = await this.host.getOrCreateSession(
      platform as any,
      identifier,
    );

    // Stamp userId + provider/model onto the session metadata so listSessions
    // and /api/usage can attribute activity. Safe to call on every message;
    // updateMetadata merges.
    const model = interaction.modelDetails;
    const metaPatch: Record<string, unknown> = {};
    if (msg.userId) metaPatch.userId = msg.userId;
    if (model?.provider) metaPatch.provider = model.provider;
    if (model?.name) metaPatch.model = model.name;
    if (Object.keys(metaPatch).length > 0) {
      await this.host
        .updateSessionMetadata(session.sessionId, metaPatch)
        .catch(() => {
          /* non-fatal — session dir may not exist in some test scenarios */
        });
    }

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
      const agent = this.host.getAgent(resolution.agentId);
      if (agent && this.buildAgentStimulusFn) {
        baseStimulus = await this.buildAgentStimulusFn(agent, this.host);
      } else if (agent) {
        // No buildAgentStimulus injected — fall back to main stimulus
        console.warn(
          `[ChannelBridge] No buildAgentStimulus injected; using main stimulus for agent "${resolution.agentId}".`,
        );
        baseStimulus = await this.host.getStimulus();
      } else {
        console.warn(
          `[ChannelBridge] Route references unknown agent "${resolution.agentId}"; using main stimulus.`,
        );
        baseStimulus = await this.host.getStimulus();
      }
    } else {
      baseStimulus = await this.host.getStimulus();
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
