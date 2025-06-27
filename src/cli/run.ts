import { Command } from 'commander';  
import { getModel } from '../providers/index.js';
import { ModelDetails } from '../cognition/types.js';
import { BaseModelRunner } from '../cognition/runner.js';
import { addCommonOptions, parseCommonOptions } from './commonOptions.js';
import { setupConversation } from './conversationUtils.js';
// Optionally import a schema for --object mode
declare const ImageFeatureSchema: any;

export const runCommand = addCommonOptions(
  new Command('run')
    .description('Run a prompt through a model')
    .argument('<prompt>', 'The prompt to send to the model')
).action(async (prompt: string, options: any) => {
  const { provider, model, attach, debug, systemPrompt, object } = parseCommonOptions(options);
  try {
    const modelDetails: ModelDetails = {
      name: model,
      provider: provider
    };
    if (process.env.DEBUG === '1') console.log('[DEBUG] Model details:', modelDetails);
    const modelInstance = await getModel(modelDetails);
    if (!modelInstance) {
      console.error('Failed to fetch model details.');
      process.exit(1);
    }
    const conversation = await setupConversation({ modelDetails, prompt, attach, debug, systemPrompt });
    if (process.env.DEBUG === '1') console.log('[DEBUG] Conversation messages:', JSON.stringify(conversation.getMessages(), null, 2));
    const runner = new BaseModelRunner();
    process.stdout.write('Model: ');
    try {
      if (object) {
        if (typeof ImageFeatureSchema !== 'undefined') {
          const response = await runner.streamObject(conversation, ImageFeatureSchema);
          if (response?.content) {
            process.stdout.write(JSON.stringify(response.content, null, 2) + '\n');
          } else {
            process.stdout.write('[No response]\n');
          }
        } else {
          console.warn('[WARN] --object is set but no schema is available. Falling back to streamText.');
          const response = await runner.streamText(conversation);
          if (response?.content) {
            process.stdout.write(response.content + '\n');
          } else {
            process.stdout.write('[No response]\n');
          }
        }
      } else {
        const response = await runner.streamText(conversation);
        if (response?.content) {
          process.stdout.write(response.content + '\n');
        } else {
          process.stdout.write('[No response]\n');
        }
      }
    } catch (err) {
      console.error('[ERROR] Model execution failed.');
      if (debug) {
        console.error(err);
      }
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}); 