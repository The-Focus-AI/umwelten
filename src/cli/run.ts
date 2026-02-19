import { Command } from "commander";
import { getModel } from "../providers/index.js";
import { ModelDetails } from "../cognition/types.js";
import { BaseModelRunner } from "../cognition/runner.js";
import { Interaction } from "../interaction/core/interaction.js";
import { Stimulus } from "../stimulus/stimulus.js";
import { addCommonOptions, parseCommonOptions } from "./commonOptions.js";
import path from "path";
import fs from "fs";
import { fileTypeFromBuffer } from "file-type";
// Optionally import a schema for --object mode
declare const ImageFeatureSchema: any;

export const runCommand = addCommonOptions(
  new Command("run")
    .description("Run a prompt through a model")
    .argument("<prompt>", "The prompt to send to the model"),
).action(async (prompt: string, options: any) => {
  const { provider, model, attach, debug, systemPrompt, object, stats } =
    parseCommonOptions(options);
  try {
    const modelDetails: ModelDetails = {
      name: model,
      provider: provider,
    };
    if (process.env.DEBUG === "1")
      console.log("[DEBUG] Model details:", modelDetails);
    const modelInstance = await getModel(modelDetails);
    if (!modelInstance) {
      console.error("Failed to fetch model details.");
      process.exit(1);
    }

    // Create stimulus for the run command
    const stimulus = new Stimulus({
      role: "helpful AI assistant",
      objective: "provide accurate and helpful responses",
      instructions: [
        "Be concise and direct",
        "Provide clear, actionable information",
        "Format output appropriately for the context",
      ],
      runnerType: "base",
    });

    // Create interaction with stimulus
    const conversation = new Interaction(modelDetails, stimulus);

    // Handle file attachments and prompt
    if (attach && prompt) {
      // Combine prompt and attachment into a single user message
      if (process.env.DEBUG === "1")
        console.log(
          `[DEBUG] Attaching file and combining with prompt: ${attach}`,
        );
      try {
        const filename = path.basename(attach);
        const fileBuffer = fs.readFileSync(attach);
        const fileType = await fileTypeFromBuffer(fileBuffer);
        const mime_type = fileType?.mime || "application/octet-stream";
        const data = fileBuffer.toString("base64");
        if (mime_type.startsWith("image/")) {
          conversation.addMessage({
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image", image: data },
            ],
          });
        } else {
          conversation.addMessage({
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "file", data: data, mediaType: mime_type },
            ],
          });
        }
        if (process.env.DEBUG === "1")
          console.log(
            `[DEBUG] File attached and combined with prompt successfully: ${attach}`,
          );
      } catch (err) {
        console.error(`[ERROR] Failed to attach file: ${attach}`);
        if (debug) {
          console.error(err);
        }
        process.exit(1);
      }
    } else if (attach) {
      // Only attachment, no prompt
      if (process.env.DEBUG === "1")
        console.log(`[DEBUG] Attaching file: ${attach}`);
      try {
        await conversation.addAttachmentFromPath(attach);
        if (process.env.DEBUG === "1")
          console.log(`[DEBUG] File attached successfully: ${attach}`);
      } catch (err) {
        console.error(`[ERROR] Failed to attach file: ${attach}`);
        if (debug) {
          console.error(err);
        }
        process.exit(1);
      }
    } else if (prompt) {
      conversation.addMessage({ role: "user", content: prompt });
    }

    if (process.env.DEBUG === "1")
      console.log(
        "[DEBUG] Conversation messages:",
        JSON.stringify(conversation.getMessages(), null, 2),
      );
    const runner = new BaseModelRunner();
    process.stdout.write("Model: ");
    try {
      let response;
      if (object) {
        if (typeof ImageFeatureSchema !== "undefined") {
          response = await runner.streamObject(
            conversation,
            ImageFeatureSchema,
          );
          if (response?.content) {
            process.stdout.write(
              JSON.stringify(response.content, null, 2) + "\n",
            );
          } else {
            process.stdout.write("[No response]\n");
          }
        } else {
          console.warn(
            "[WARN] --object is set but no schema is available. Falling back to streamText.",
          );
          response = await runner.streamText(conversation);
          if (response?.content) {
            process.stdout.write(response.content + "\n");
          } else {
            process.stdout.write("[No response]\n");
          }
        }
      } else {
        response = await runner.streamText(conversation);
        if (response?.content) {
          process.stdout.write(response.content + "\n");
        } else {
          process.stdout.write("[No response]\n");
        }
      }

      // Display stats if requested
      if (stats && response?.metadata) {
        console.log("\n📊 Response Statistics:");
        console.log("======================");
        console.log(
          `Model: ${response.metadata.model} (${response.metadata.provider})`,
        );
        console.log(
          `Duration: ${response.metadata.endTime.getTime() - response.metadata.startTime.getTime()}ms`,
        );
        console.log(
          `Tokens: ${response.metadata.tokenUsage.total} (${response.metadata.tokenUsage.promptTokens} prompt + ${response.metadata.tokenUsage.completionTokens} completion)`,
        );
        if (response.metadata.cost) {
          console.log(`Cost: $${response.metadata.cost.totalCost.toFixed(6)}`);
        } else {
          console.log(`Cost: $0.000000`);
        }
        console.log("======================");
      }
    } catch (err) {
      console.error("[ERROR] Model execution failed.");
      if (debug) {
        console.error(err);
      }
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
});
