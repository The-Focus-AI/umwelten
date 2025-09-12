import { Interaction } from "../interaction/interaction.js";
import { ModelDetails } from "../cognition/types.js";
import { Stimulus } from "../stimulus/stimulus.js";
import { CoreMessage } from "ai";
import { BaseModelRunner } from "../cognition/runner.js";
import { streamText } from "ai";

export class WebInterface extends Interaction {
    constructor(model: ModelDetails, stimulus: Stimulus, messages: CoreMessage[]) {
      super(model, stimulus);
  
      this.messages = messages;
      this.setStimulus(stimulus);
    }
  
    async toUIMessageStreamResponse() {
      const streamOptions = await (this.getRunner() as BaseModelRunner).makeStreamOptions(this);
  
      const result = streamText(streamOptions);  
      
      return result.toUIMessageStreamResponse();
    }
  }