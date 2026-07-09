import { tool } from "ai";
import { z } from "zod";
import type { Interaction } from "../../interaction/core/interaction.js";
import { renderEventLine, speakerPrefix } from "../render.js";
import type {
  DialogueEvent,
  Participant,
  ParticipantInfo,
  TurnContext,
  TurnResult,
} from "../types.js";

/** Legacy in-band done signal — still honored when a model emits it. */
export const DEFAULT_DONE_MARKER = "<done/>";

/** Structured done signal: the model calls this tool to leave the dialogue. */
export const BOW_OUT_TOOL = "bow_out";

/** Injected when the same speaker is picked twice in a row (empty delta). */
export const CONTINUE_NUDGE = "(you have the floor — continue)";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractToolCalls(
  metadata: unknown,
): Array<{ toolName: string; input?: unknown }> {
  const meta = metadata as {
    toolCalls?: Array<{ toolName?: string; input?: unknown; args?: unknown }>;
  };
  if (!Array.isArray(meta?.toolCalls)) return [];
  return meta.toolCalls.map((c) => ({
    toolName: c?.toolName ?? "unknown",
    input: c?.input ?? c?.args,
  }));
}

/**
 * A Dialogue participant backed by an Interaction — any model, any Stimulus,
 * any tools. Handles the role asymmetry entirely inside this class: others'
 * turns are batched into one labeled `user` message; its own reply lands as
 * `assistant` in the Interaction automatically.
 *
 * Done signaling is structured: a `bow_out` tool is added to the stimulus
 * for the dialogue's duration (and removed after), so leaving is a tool call
 * rather than an in-band string. A trailing `<done/>` marker is still
 * honored for models that imitate transcripts or can't call tools.
 *
 * `historyWindow` (opt-in) bounds the participant's private view for
 * long-running dialogues: after each turn everything the runner appended is
 * replaced with a one-line self-narration (`[You said: "…"]`) — plain text,
 * so trimming can never strand a dangling tool_use block — and the view is
 * trimmed to the last N non-system messages. Continuity then comes from the
 * persona plus the re-perceived recent window, not an ever-growing
 * transcript.
 */
export class InteractionParticipant implements Participant {
  readonly id: string;
  readonly displayName: string;
  readonly kind = "model" as const;
  readonly model: string;
  private readonly interaction: Interaction;
  private readonly doneMarker: string;
  private readonly historyWindow?: number;
  /** Instructions as they were before the dialogue preamble was added. */
  private preDialogue?: { instructions: string[] | undefined };

  constructor(opts: {
    id: string;
    displayName: string;
    interaction: Interaction;
    /** Legacy in-band marker to honor besides `bow_out`. Default `<done/>`. */
    doneMarker?: string;
    /**
     * Bound the private view to the last N non-system messages, storing own
     * turns as self-narration. Unset = unbounded (full chat history).
     */
    historyWindow?: number;
  }) {
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.interaction = opts.interaction;
    this.doneMarker = opts.doneMarker ?? DEFAULT_DONE_MARKER;
    this.historyWindow = opts.historyWindow;
    const { provider, name } = opts.interaction.modelDetails;
    this.model = `${provider}/${name}`;
  }

  getInteraction(): Interaction {
    return this.interaction;
  }

  onDialogueStart(info: { participants: ParticipantInfo[] }): void {
    const others = info.participants
      .filter((p) => p.id !== this.id)
      .map((p) => p.displayName);
    const stimulus = this.interaction.getStimulus();
    // Snapshot so onDialogueEnd can restore — critical when the Interaction
    // is an agent's persistent one (shared-memory mode): the preamble must
    // not leak into post-dialogue turns or stack across dialogues.
    this.preDialogue = {
      instructions: stimulus.instructions ? [...stimulus.instructions] : undefined,
    };
    stimulus.addInstruction(
      `You are ${this.displayName} in a conversation with ${others.join(", ")}. ` +
        `Messages from others appear as "[Name]: text"; ambient happenings ` +
        `appear as "(text)". Reply as yourself — never prefix your reply ` +
        `with your own name or any "[Name]:" label.`,
    );
    stimulus.addInstruction(
      `Keep engaging while the conversation is productive. Only when it has ` +
        `truly run its course and you have nothing further to add, call the ` +
        `${BOW_OUT_TOOL} tool to leave the conversation.`,
    );
    stimulus.addTool(
      BOW_OUT_TOOL,
      tool({
        description:
          "Leave the conversation. Call this only when it has truly run its " +
          "course and you have nothing further to add. You may still say a " +
          "brief goodbye in the same turn.",
        inputSchema: z.object({
          reason: z
            .string()
            .optional()
            .describe("Optionally, why you are bowing out"),
        }),
        execute: async () => "You have bowed out of the conversation.",
      }),
    );
    // Re-apply so the system message and tool set pick up the changes.
    this.interaction.setStimulus(stimulus);
  }

  onDialogueEnd(): void {
    if (!this.preDialogue) return;
    const stimulus = this.interaction.getStimulus();
    stimulus.options.instructions = this.preDialogue.instructions;
    delete stimulus.getTools()[BOW_OUT_TOOL];
    this.preDialogue = undefined;
    this.interaction.setStimulus(stimulus);
  }

  async takeTurn(
    newEvents: DialogueEvent[],
    ctx: TurnContext,
  ): Promise<TurnResult> {
    const visible = newEvents.filter((e) => e.content.trim());
    // Batch all deltas into ONE user message so strict user/assistant
    // alternation is preserved (same convention as ChannelBridge labeling).
    const content = visible.length
      ? visible.map((e) => renderEventLine(e)).join("\n\n")
      : CONTINUE_NUDGE;
    // Everything the runner appends from here on belongs to this turn.
    const turnStart = this.interaction.getMessages().length;
    this.interaction.addMessage({ role: "user", content });

    let response = await this.interaction.streamText(ctx.signal, ctx.observer);
    let text = typeof response.content === "string" ? response.content : "";
    let toolCalls = extractToolCalls(response.metadata);
    let done = toolCalls.some((c) => c.toolName === BOW_OUT_TOOL);

    // Tool-call-with-no-text follow-up (same pattern as ChannelBridge):
    // a turn that only called tools gets one more chance to say something —
    // unless the tool call was bow_out, where a silent exit is deliberate.
    if (!text.trim() && toolCalls.length > 0 && !done) {
      try {
        const followUp = await this.interaction.streamText(
          ctx.signal,
          ctx.observer,
        );
        const followText =
          typeof followUp.content === "string" ? followUp.content : "";
        if (followText.trim()) {
          text = followText;
          const followCalls = extractToolCalls(followUp.metadata);
          toolCalls = [...toolCalls, ...followCalls];
          done = done || followCalls.some((c) => c.toolName === BOW_OUT_TOOL);
        }
      } catch {
        // fall through with empty content
      }
    }

    let cleaned = text.trim();
    // Models imitate the labeling convention — strip an echoed self-prefix.
    const selfPrefix = new RegExp(
      `^${escapeRegExp(speakerPrefix(this.displayName))}\\s*`,
      "i",
    );
    cleaned = cleaned.replace(selfPrefix, "");

    // Only a TRAILING marker signals done — an inline mention (e.g. two
    // agents discussing the protocol itself) must not end participation or
    // get spliced out of the text.
    if (cleaned.endsWith(this.doneMarker)) {
      done = true;
      cleaned = cleaned.slice(0, -this.doneMarker.length).trimEnd();
    }

    if (this.historyWindow !== undefined) {
      this.narrateAndTrim(turnStart, cleaned, toolCalls);
    }

    return {
      content: cleaned,
      done,
      // bow_out is dialogue protocol, not conversational content.
      toolCalls: (() => {
        const visible = toolCalls.filter((c) => c.toolName !== BOW_OUT_TOOL);
        return visible.length > 0 ? visible : undefined;
      })(),
    };
  }

  /**
   * Perception-window bookkeeping (under-glass style): replace everything
   * this turn appended (perception + assistant output + any tool traffic)
   * with the perception plus a plain-text self-narration, then trim to the
   * last `historyWindow` non-system messages (dropping a leading assistant
   * message so the window always starts on a user turn).
   */
  private narrateAndTrim(
    turnStart: number,
    cleaned: string,
    toolCalls: Array<{ toolName: string }>,
  ): void {
    const messages = this.interaction.getMessages();
    const perception = messages[turnStart];
    const used = toolCalls
      .filter((c) => c.toolName !== BOW_OUT_TOOL)
      .map((c) => c.toolName);
    const narration =
      `[You ${used.length ? `used ${used.join(", ")} and ` : ""}` +
      (cleaned ? `said: "${cleaned}"]` : `said nothing]`);
    messages.splice(turnStart);
    if (perception) messages.push(perception);
    messages.push({ role: "assistant", content: narration });

    const system = messages.filter((m) => m.role === "system");
    let rest = messages.filter((m) => m.role !== "system");
    if (rest.length > this.historyWindow!) {
      rest = rest.slice(rest.length - this.historyWindow!);
      while (rest.length && rest[0].role === "assistant") rest.shift();
      messages.splice(0, messages.length, ...system, ...rest);
    }
  }
}
