/** Decisions are typed judgments, not chat completions or coerced booleans. */
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function context(value: unknown): boolean {
  return (
    typeof value === "string" || (value !== null && typeof value === "object")
  );
}

export function validateDecisionsRequest(body: Record<string, unknown>): void {
  if (
    !context(body.state) ||
    !object(body.questions) ||
    !Object.keys(body.questions).length ||
    body.stream !== undefined
  ) {
    throw new Error("invalid_decisions_request");
  }
  for (const question of Object.values(body.questions)) {
    if (!object(question) || !context(question.instructions)) {
      throw new Error("invalid_decisions_question");
    }
    const criteria = question.criteria;
    const valid =
      question.type === "noul"
        ? criteria === undefined ||
          (object(criteria) &&
            context(criteria.true) &&
            context(criteria.false))
        : question.type === "choice"
          ? object(criteria) &&
            Object.keys(criteria).length > 0 &&
            Object.values(criteria).every(
              (value) => value === null || context(value),
            )
          : question.type === "score" &&
            Array.isArray(criteria) &&
            criteria.length > 0 &&
            criteria.every(context);
    if (!valid) throw new Error("invalid_decisions_question");
  }
}

/** Validate the response without rewriting probabilities, legends, or usage. */
export function decisionsUsage(
  result: Record<string, unknown>,
  questions: Record<string, unknown>,
): { input_tokens: number; output_tokens: number } {
  const usage = result.usage;
  if (
    !object(result.answers) ||
    !object(usage) ||
    !Number.isSafeInteger(usage.input_tokens) ||
    (usage.input_tokens as number) < 0 ||
    !Number.isSafeInteger(usage.output_tokens) ||
    (usage.output_tokens as number) < 0 ||
    (usage.cost !== undefined &&
      (typeof usage.cost !== "number" ||
        !Number.isFinite(usage.cost) ||
        usage.cost < 0))
  ) {
    throw new Error("invalid_decisions_response");
  }
  for (const [key, question] of Object.entries(questions)) {
    const answer = result.answers[key];
    if (!object(question) || !object(answer) || answer.type !== question.type) {
      throw new Error("invalid_decisions_response");
    }
    const value = answer[String(answer.type)];
    const valid =
      answer.type === "choice"
        ? typeof value === "string" &&
          object(question.criteria) &&
          Object.hasOwn(question.criteria, value)
        : typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          (answer.type === "noul"
            ? value <= 1
            : answer.type === "score" &&
              Array.isArray(question.criteria) &&
              value <= question.criteria.length - 1);
    if (!valid) throw new Error("invalid_decisions_response");
  }
  return {
    input_tokens: usage.input_tokens as number,
    output_tokens: usage.output_tokens as number,
  };
}
