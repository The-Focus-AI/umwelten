import { z } from "zod";
import type {
  JudgmentQuestions,
  JudgmentRequest,
  JudgmentResult,
} from "./types.js";

export const PROBABILITY_TOLERANCE = 0.0001;
const probability = z.number().min(0).max(1);
const nonempty = z.string().trim().min(1);
const questionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("binary"),
    instructions: nonempty,
    criteria: z.strictObject({ true: nonempty, false: nonempty }).optional(),
  }),
  z.strictObject({
    kind: z.literal("choice"),
    instructions: nonempty,
    options: z
      .record(nonempty, nonempty)
      .refine(
        (value) => Object.keys(value).length >= 2,
        "Need at least two options",
      ),
  }),
  z.strictObject({
    kind: z.literal("ordinal"),
    instructions: nonempty,
    levels: z
      .array(nonempty)
      .min(2)
      .refine(
        (value) => new Set(value).size === value.length,
        "Duplicate levels",
      ),
  }),
]);

export function validateRequest(request: JudgmentRequest): void {
  z.strictObject({
    state: z.union([
      z.string(),
      z.record(z.string(), z.json()),
      z.array(z.json()),
    ]),
    questions: z
      .record(nonempty, questionSchema)
      .refine((value) => Object.keys(value).length > 0, "No questions"),
  }).parse(request);
}

type WireAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number> }
  | { type: "score"; probabilities: Record<string, number> };

/** The wire format used by both native Jev and our generated-output baseline. */
export function answerSchema(questions: JudgmentQuestions) {
  const shape: Record<string, z.ZodType<WireAnswer>> = Object.fromEntries(
    Object.entries(questions).map(([id, question]) => {
      if (question.kind === "binary") {
        return [id, z.object({ type: z.literal("noul"), noul: probability })];
      }
      const keys =
        question.kind === "choice"
          ? Object.keys(question.options)
          : question.levels.map((_, i) => String(i));
      const distribution = z
        .strictObject(Object.fromEntries(keys.map((key) => [key, probability])))
        .refine(
          (value) =>
            Math.abs(Object.values(value).reduce((sum, p) => sum + p, 0) - 1) <=
            PROBABILITY_TOLERANCE,
          "Probabilities must sum to one (tolerance 0.0001); values are never renormalized",
        );
      if (question.kind === "choice") {
        return [
          id,
          z
            .object({
              type: z.literal("choice"),
              choice: z.enum(keys),
              probabilities: distribution,
            })
            .refine(
              (value) =>
                value.probabilities[value.choice] >=
                Math.max(...Object.values(value.probabilities)),
              "Chosen option is not a maximum-probability option",
            ),
        ];
      }
      return [
        id,
        z.object({ type: z.literal("score"), probabilities: distribution }),
      ];
    }),
  );
  return z.strictObject(shape);
}

export function parseAnswers<Q extends JudgmentQuestions>(
  questions: Q,
  raw: unknown,
): JudgmentResult<Q>["answers"] {
  const parsed = answerSchema(questions).parse(raw);
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => {
      const answer = parsed[id];
      if (answer.type === "noul")
        return [id, { kind: "binary", probabilityTrue: answer.noul }];
      if (answer.type === "choice")
        return [
          id,
          {
            kind: "choice",
            selected: answer.choice,
            probabilities: answer.probabilities,
          },
        ];
      if (question.kind !== "ordinal")
        throw new Error(`Unexpected score for ${id}`);
      const probabilities = question.levels.map(
        (_, i) => answer.probabilities[String(i)],
      );
      return [
        id,
        {
          kind: "ordinal",
          probabilities,
          expectedIndex: probabilities.reduce((sum, p, i) => sum + p * i, 0),
        },
      ];
    }),
  ) as JudgmentResult<Q>["answers"];
}

export function wireQuestions(questions: JudgmentQuestions) {
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [
      id,
      {
        type:
          question.kind === "binary"
            ? "noul"
            : question.kind === "ordinal"
              ? "score"
              : "choice",
        instructions: question.instructions,
        ...(question.kind === "binary"
          ? question.criteria
            ? { criteria: question.criteria }
            : {}
          : {
              criteria:
                question.kind === "choice" ? question.options : question.levels,
            }),
      },
    ]),
  );
}
