import type {
  DialogueEvent,
  Participant,
  TurnContext,
  TurnResult,
} from "../types.js";

/**
 * A human seat in a Dialogue. The frontend supplies `getInput` — a CLI wires
 * it to readline, a web UI to a pending promise. Returning `null` means the
 * human is done; the empty turn is skipped by other participants' delta
 * feeds and by persistence.
 */
export class HumanParticipant implements Participant {
  readonly id: string;
  readonly displayName: string;
  readonly kind = "human" as const;
  private readonly getInput: (
    newEvents: DialogueEvent[],
  ) => Promise<string | null>;

  constructor(opts: {
    id: string;
    displayName: string;
    getInput: (newEvents: DialogueEvent[]) => Promise<string | null>;
  }) {
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.getInput = opts.getInput;
  }

  async takeTurn(
    newEvents: DialogueEvent[],
    _ctx: TurnContext,
  ): Promise<TurnResult> {
    const input = await this.getInput(newEvents);
    if (input === null) {
      return { content: "", done: true };
    }
    return { content: input };
  }
}
