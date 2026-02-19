import { CoreMessage } from "ai";
import {
  ModelDetails,
  ModelOptions,
  ModelRunner,
  ModelResponse,
} from "../../cognition/types.js";
import { BaseModelRunner } from "../../cognition/runner.js";
import { createMemoryRunner } from "../../memory/memory_runner.js";
import { InMemoryMemoryStore } from "../../memory/memory_store.js";
// import { getAllTools } from "../../stimulus/tools/index.js";
import path from "path";
import fs, { FileHandle } from "fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { PathLike } from "fs";
import { z } from "zod";
import { Stimulus } from "../../stimulus/stimulus.js";
import { getCompactionSegment } from "../../context/segment.js";
import { getCompactionStrategy } from "../../context/registry.js";

import { v4 as uuidv4 } from "uuid";
import {
  NormalizedSession,
  NormalizedMessage,
  SessionSource,
  SessionMetrics,
} from "../types/normalized-types.js";

export class Interaction {
  public id: string;
  public metadata: {
    created: Date;
    updated: Date;
    source?: SessionSource;
    sourceId?: string;
    sourceData?: Record<string, unknown>;
  };

  public messages: CoreMessage[] = [];
  protected runner: ModelRunner;
  public userId: string = "default";
  public modelDetails: ModelDetails;
  public stimulus: Stimulus; // NEW: Required stimulus
  public options?: ModelOptions;
  public outputFormat?: z.ZodSchema;
  public tools?: Record<string, any>;
  public maxSteps?: number;
  /** Message index after which the "current thread" starts (1 = first message after system). Used by compactContext. */
  private checkpointMessageIndex?: number;

  constructor(
    modelDetails: ModelDetails,
    stimulus: Stimulus, // NEW: Required parameter
    options?: {
      id?: string;
      created?: Date;
      updated?: Date;
      source?: SessionSource;
      sourceId?: string;
    },
  ) {
    this.modelDetails = modelDetails;
    this.stimulus = stimulus;

    this.id = options?.id || uuidv4();
    this.metadata = {
      created: options?.created || new Date(),
      updated: options?.updated || new Date(),
      source: options?.source || "native",
      sourceId: options?.sourceId || this.id,
    };

    // Apply stimulus context immediately
    this.applyStimulusContext();

    // Create the appropriate runner
    this.runner = this.createRunner(this.stimulus.getRunnerType());
  }

  private applyStimulusContext(): void {
    // Set system prompt from stimulus
    this.messages.push({
      role: "system",
      content: this.stimulus.getPrompt(),
    });

    // Apply model options from stimulus
    if (this.stimulus.hasModelOptions()) {
      this.options = this.stimulus.getModelOptions();
    }

    // Apply tools from stimulus
    if (this.stimulus.hasTools()) {
      this.tools = this.stimulus.getTools();
    }

    // Apply tool-specific settings
    if (this.stimulus.options?.maxToolSteps) {
      this.setMaxSteps(this.stimulus.options.maxToolSteps);
    }
  }

  // NEW: Method to update stimulus (for dynamic changes)
  setStimulus(stimulus: Stimulus): void {
    this.stimulus = stimulus;

    // Update system prompt
    if (this.messages[0]?.role === "system") {
      this.messages[0].content = stimulus.getPrompt();
    }

    // Update tools from new stimulus
    if (stimulus.hasTools()) {
      this.tools = stimulus.getTools();
    }

    // Update model options from new stimulus
    if (stimulus.hasModelOptions()) {
      this.options = stimulus.getModelOptions();
    }

    this.metadata.updated = new Date();
  }

  // NEW: Get current stimulus
  getStimulus(): Stimulus {
    return this.stimulus;
  }

  setSystemPrompt(prompt: string): void {
    console.warn(
      "setSystemPrompt is deprecated. Use setStimulus with a new Stimulus object instead.",
    );

    if (this.messages[0].role === "system") {
      this.messages[0].content = prompt;
    } else {
      console.warn(
        "System prompt not found, adding to the beginning of the messages",
      );
      this.messages.unshift({
        role: "system",
        content: prompt,
      });
    }
    this.metadata.updated = new Date();
  }

  protected createRunner(runnerType: "base" | "memory"): ModelRunner {
    switch (runnerType) {
      case "memory":
        return createMemoryRunner({
          baseRunner: new BaseModelRunner(),
          llmModel: this.modelDetails.name,
          memoryStore: new InMemoryMemoryStore(),
        });
      default:
        return new BaseModelRunner();
    }
  }

  /** Optional callback invoked whenever messages change (e.g. so CLI can append transcript). */
  onTranscriptUpdate?: (messages: CoreMessage[]) => void;

  setOnTranscriptUpdate(callback: (messages: CoreMessage[]) => void): void {
    this.onTranscriptUpdate = callback;
  }

  addMessage(message: CoreMessage): void {
    this.messages.push(message);
    this.metadata.updated = new Date();
  }

  /** Call after adding message(s) so transcript can be written incrementally. */
  notifyTranscriptUpdate(): void {
    if (this.onTranscriptUpdate) {
      this.onTranscriptUpdate(this.getMessages());
    }
  }

  async addAttachmentFromPath(
    attachment: string,
    mime_type?: string,
  ): Promise<void> {
    let data = attachment;

    const filename = path.basename(attachment);
    console.log("Creating attachment for", filename);
    const fileBuffer = await fs.readFile(attachment);
    if (!mime_type) {
      const fileType = await fileTypeFromBuffer(fileBuffer);
      mime_type = fileType?.mime;
    }

    // convert to base64
    data = fileBuffer.toString("base64");

    if (mime_type && mime_type.startsWith("image/")) {
      this.addMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: `I've shared an image named ${filename} for you to analyze.`,
          },
          { type: "image", image: data as string },
        ],
      });
    } else {
      this.addMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: `I've shared a file named ${filename} for you to analyze.`,
          },
          {
            type: "file",
            data: data as string,
            mediaType: mime_type || "application/octet-stream",
          },
        ],
      });
    }
  }

  setOutputFormat(outputFormat: z.ZodSchema): void {
    this.outputFormat = outputFormat;
  }

  /**
   * Set tools for this interaction
   */
  setTools(tools: Record<string, any>): void {
    this.tools = tools;
  }

  /**
   * Add a single tool to this interaction
   */
  addTool(name: string, tool: any): void {
    if (!this.tools) this.tools = {};
    this.tools[name] = tool;
  }

  /**
   * Set maximum number of steps for multi-step tool calling
   */
  setMaxSteps(maxSteps: number): void {
    this.maxSteps = maxSteps;
  }

  /**
   * Get tools in Vercel AI SDK format
   */
  getVercelTools() {
    return this.tools || undefined;
  }

  /**
   * Check if this interaction has tools
   */
  hasTools(): boolean {
    return this.tools !== undefined && Object.keys(this.tools).length > 0;
  }

  getMessages(): CoreMessage[] {
    return this.messages;
  }

  clearContext(): void {
    this.messages = [];
    this.checkpointMessageIndex = undefined;
    this.metadata.updated = new Date();
  }

  /**
   * Set checkpoint to current message count (everything after this index is the current thread).
   */
  setCheckpoint(): void {
    this.checkpointMessageIndex = this.messages.length;
  }

  /**
   * Get current checkpoint index, or undefined if not set.
   */
  getCheckpoint(): number | undefined {
    return this.checkpointMessageIndex;
  }

  /**
   * Compact context by replacing the segment (from checkpoint or start through end of last flow)
   * with the output of the given strategy. Updates checkpoint to after the replacement.
   * @returns Segment bounds and replacement count, or null if no segment or unknown strategy.
   */
  async compactContext(
    strategyId: string,
    options?: {
      fromCheckpoint?: boolean;
      strategyOptions?: Record<string, unknown>;
    },
  ): Promise<{
    segmentStart: number;
    segmentEnd: number;
    replacementCount: number;
  } | null> {
    const fromCheckpoint = options?.fromCheckpoint ?? true;
    const segment = getCompactionSegment(this.messages, {
      fromCheckpoint,
      checkpointIndex: this.getCheckpoint(),
    });
    if (!segment) return null;

    const strategy = await getCompactionStrategy(strategyId);
    if (!strategy) return null;

    const result = await strategy.compact({
      messages: this.messages,
      segmentStart: segment.start,
      segmentEnd: segment.end,
      model: this.modelDetails,
      runner: this.getRunner(),
      options: options?.strategyOptions,
    });

    const before = this.messages.slice(0, segment.start);
    const after = this.messages.slice(segment.end + 1);
    this.messages = before.concat(result.replacementMessages).concat(after);
    this.checkpointMessageIndex =
      segment.start + result.replacementMessages.length;
    this.metadata.updated = new Date();

    return {
      segmentStart: segment.start,
      segmentEnd: segment.end,
      replacementCount: result.replacementMessages.length,
    };
  }

  // Delegate to the internal runner
  async generateText(): Promise<ModelResponse> {
    this.metadata.updated = new Date();
    return await this.runner.generateText(this);
  }

  async streamText(signal?: AbortSignal): Promise<ModelResponse> {
    this.metadata.updated = new Date();
    return await this.runner.streamText(this, signal);
  }

  async generateObject(schema: z.ZodSchema): Promise<ModelResponse> {
    this.metadata.updated = new Date();
    return await this.runner.generateObject(this, schema);
  }

  async streamObject(schema: z.ZodSchema): Promise<ModelResponse> {
    this.metadata.updated = new Date();
    return await this.runner.streamObject(this, schema);
  }

  // Access to underlying components when needed
  getRunner(): ModelRunner {
    return this.runner;
  }

  /**
   * Convert to normalized session format for storage/display
   */
  toNormalizedSession(): NormalizedSession {
    const normalizedMessages: NormalizedMessage[] = [];

    // Helper to calculate tokens if we had them (currently assuming we don't track per-message in Interaction yet)
    // In future, Interaction should store metadata per message.

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      const id = `${this.id}-${i}`;
      const timestamp = new Date().toISOString(); // TODO: Store timestamps in Interaction messages

      if (msg.role === "system") {
        // System messages are generally not included in the normalized 'transcript' for display,
        // but often useful to allow hydration. NormalizedSession usually focuses on the conversation.
        // We can include it or store it in sourceData.
        // Let's include it for completeness if the format allows, or skip if strict.
        // NormalizedMessage allows 'system' role.
        normalizedMessages.push({
          id,
          role: "system",
          content:
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content),
          timestamp,
        });
        continue;
      }

      if (msg.role === "user") {
        const contentStr =
          typeof msg.content === "string"
            ? msg.content
            : msg.content
                .map((c) => {
                  const part = c as any;
                  if (part.type === "text") return part.text;
                  if (part.type === "image") return "[Image]";
                  if (part.type === "file") return "[File]";
                  if (part.type === "tool-result") {
                    // AI SDK uses `output` (with { type, value } shape), legacy uses `result`
                    const resultOrOutput = part.result ?? part.output;
                    if (
                      resultOrOutput &&
                      typeof resultOrOutput === "object" &&
                      "type" in resultOrOutput &&
                      "value" in resultOrOutput
                    ) {
                      const o = resultOrOutput as {
                        type: string;
                        value: unknown;
                      };
                      return typeof o.value === "string"
                        ? o.value
                        : JSON.stringify(o.value ?? "");
                    }
                    return typeof resultOrOutput === "string"
                      ? resultOrOutput
                      : JSON.stringify(resultOrOutput ?? "");
                  }
                  return "";
                })
                .join("\n");

        normalizedMessages.push({
          id,
          role: "user",
          content: contentStr,
          timestamp,
        });
        continue;
      }

      if (msg.role === "assistant") {
        let contentStr = "";
        const toolCalls: any[] = [];

        if (typeof msg.content === "string") {
          contentStr = msg.content;
        } else if (Array.isArray(msg.content)) {
          // Extract text and tool calls from content blocks
          for (const part of msg.content as any[]) {
            if (part.type === "text") {
              contentStr += part.text;
            } else if (part.type === "tool-call") {
              toolCalls.push(part);
            }
          }
        }

        // Also check toolInvocations (Vercel SDK often puts them here)
        if ((msg as any).toolInvocations) {
          toolCalls.push(...(msg as any).toolInvocations);
        }

        // 1. Add Assistant Message (Text)
        // Even if empty text, if there are tool calls, we might want an entry?
        // Usually we only add if there IS text.
        normalizedMessages.push({
          id,
          role: "assistant",
          content: contentStr,
          timestamp,
          // tokens: ...
        });

        // 2. Add Tool Call Messages (Role: Tool from normalized perspective, but usually they are 'assistant' tool_use blocks)
        // NormalizedMessage separates them for easier linear reading.
        // In NormalizedMessage definition: role='tool' usually means tool RESULT?
        // Let's check NormalizedMessage definition.
        // role: 'tool' -> "Tool call details (when role === 'tool')" ... wait, role='tool' usually means "Output from tool".
        // BUT NormalizedMessage has `tool?: { ... }` which implies it describes the tool usage?
        // Checking NormalizedMessage doc: "Tool call details (when role === 'tool')"
        // AND "content" is plain text.
        // Let's look at session-parser: it creates role='tool' for tool CAILS (tool_use).
        // And for tool RESULTS, it seems to put them in User messages? No.

        // session-parser.ts:
        // Assistant Message -> Normalized (assistant)
        // If toolCalls -> Normalized (role='tool', content=`Tool: ${name}`, tool={name, input})  <-- THIS IS A TOOL CALL

        // So role='tool' in NormalizedMessage represents the ACT of calling the tool.
        // The RESULT is usually in a subsequent 'user' message in Claude semantics.

        for (let j = 0; j < toolCalls.length; j++) {
          const tc = toolCalls[j];
          const toolId = tc.toolCallId || tc.id || `call-${j}`;
          const toolName = tc.toolName || tc.name || "unknown";
          const toolInput = tc.args || tc.input || {};

          normalizedMessages.push({
            id: toolId,
            role: "tool", // Represents the CALL
            content: `Tool: ${toolName}`, // Descriptive text
            timestamp,
            tool: {
              name: toolName,
              input: toolInput,
            },
          });
        }
        continue;
      }

      if (msg.role === "tool") {
        // This represents the RESULT of a tool call
        // In normalized types, where do results go?
        // session-parser.ts puts IsToolResultOnlyMessage -> skips?
        // Wait, IsToolResultOnlyMessage in session-parser skips user messages that are ONLY tool results.
        // This implies NormalizedFormat might NOT explicitly show tool results as top-level bubbles?
        // OR it implies they are expected to be merged?

        // Let's look at session-parser.ts lines 444:
        // if (isToolResultOnlyMessage(userMsg)) continue;

        // It seems the current Normalization HIDES tool results from the linear definition?
        // That seems wrong if we want a full transcript.
        // But maybe NormalizedSession is for "Human readable beats"?
        // The doc says "Common format for sessions from different AI coding tools".

        // Let's try to preserve them if possible.
        // If normalization skips them, we lose data.
        // Let's map them to 'user' role with [Tool Result] content for now to be safe and visible.

        let contentStr = "";
        if (typeof msg.content === "string") {
          contentStr = msg.content;
        } else {
          contentStr = msg.content
            .map((c) => {
              const part = c as any;
              if (part.type === "tool-result") {
                // AI SDK uses `output` (with { type, value } shape), legacy uses `result`
                const resultOrOutput = part.result ?? part.output;
                let valueStr: string;
                if (
                  resultOrOutput &&
                  typeof resultOrOutput === "object" &&
                  "type" in resultOrOutput &&
                  "value" in resultOrOutput
                ) {
                  const o = resultOrOutput as { type: string; value: unknown };
                  valueStr =
                    typeof o.value === "string"
                      ? o.value
                      : JSON.stringify(o.value ?? "");
                } else {
                  valueStr =
                    typeof resultOrOutput === "string"
                      ? resultOrOutput
                      : JSON.stringify(resultOrOutput ?? "");
                }
                return `[Tool Result: ${part.toolName || "unknown"}]\n${valueStr}`;
              }
              return JSON.stringify(c);
            })
            .join("\n");
        }

        normalizedMessages.push({
          id,
          role: "user", // Tool results often treated as user inputs in LLM view
          content: contentStr,
          timestamp,
          sourceData: { type: "tool_result_message" },
        });
      }
    }

    // Calculate basic metrics
    const userMessages = normalizedMessages.filter(
      (m) => m.role === "user",
    ).length;
    const assistantMessages = normalizedMessages.filter(
      (m) => m.role === "assistant",
    ).length;
    const toolCallMessages = normalizedMessages.filter(
      (m) => m.role === "tool",
    ).length;

    // Find first user prompt
    const firstUserMsg = normalizedMessages.find((m) => m.role === "user");
    const firstPrompt = firstUserMsg
      ? firstUserMsg.content.slice(0, 100)
      : "(New Session)";

    return {
      id: this.id,
      source: this.metadata.source || "native",
      sourceId: this.metadata.sourceId || this.id,
      created: this.metadata.created.toISOString(),
      modified: this.metadata.updated.toISOString(),
      messages: normalizedMessages,
      messageCount: normalizedMessages.length,
      firstPrompt,
      metrics: {
        userMessages,
        assistantMessages,
        toolCalls: toolCallMessages,
      },
    };
  }

  /**
   * Recreate an Interaction from a normalized session
   */
  static fromNormalizedSession(
    session: NormalizedSession,
    modelDetails: ModelDetails,
    stimulus?: Stimulus,
  ): Interaction {
    // If no stimulus provided, create a default one based on role or system prompt if found
    if (!stimulus) {
      const systemMsg = session.messages.find((m) => m.role === "system");
      stimulus = new Stimulus({
        role: "assistant", // Default
        systemContext: systemMsg ? systemMsg.content : undefined,
      });
    }

    const interaction = new Interaction(modelDetails, stimulus, {
      id: session.id,
      created: new Date(session.created),
      updated: new Date(session.modified),
      source: session.source,
      sourceId: session.sourceId,
    });

    // Restore messages
    // Note: We skip the first message if it's a system prompt and we just applied it via stimulus
    // to avoid duplication, or we clear default messages and load all.
    // For now, let's clear initialization messages and load exact history.
    interaction.messages = session.messages.map((m) => ({
      role: m.role as any,
      content: m.content,
    }));

    return interaction;
  }
}
