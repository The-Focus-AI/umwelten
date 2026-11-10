/** A readable, live writer/reviewer exchange. All proposal and review text is model-written. */
import "@umwelten/core/env/load.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CollaborationRun } from "@umwelten/habitat/collaboration/runtime.js";
import { CollaborationStore } from "@umwelten/core/collaboration/store.js";

process.env.MYCEL_URL ??= "https://mycel.thefocus.ai";
process.env.MYCEL_END_USER ??= "collaboration-e2e";
assert.ok(process.env.MYCEL_API_KEY, "MYCEL_API_KEY is required");
const modelName = "deepseek/deepseek-v4.1-flash";
const catalogue = await fetch(`${process.env.MYCEL_URL}/v1/models`).then((r) =>
  r.json(),
);
const offer = catalogue.data.find((m: { id: string }) => m.id === modelName);
assert.ok(offer?.capabilities?.includes("tool-calling"), "Model unavailable");

const brief = `# Should Maple Café test later opening hours?

This café and all facts below are fictional. Write a short decision proposal for its owner.

- The owner is considering opening two hours later on Thursday and Friday for two weeks (four evenings).
- Normal closing time is 6 pm. A shorter extension is allowed, or you may recommend no pilot.
- Any extension requires two employees on duty, each costing $20 per extra hour, including all employment costs.
- The total incremental spending cap is $240. A one-time $40 promotion cost is mandatory if any pilot runs, and counts toward the cap.
- The contribution per additional purchase is $4 after ingredients and payment fees, but before the extra staffing and promotion costs. Average sale price is $8.
- A voluntary survey of 40 existing customers found 26 saying they might visit after 6 pm. No evening footfall or actual conversion data exists.
- The last normal opening hour currently averages six purchases. That does not establish demand after closing time.
- Employees have provisionally agreed to a maximum two extra hours on these four evenings; confirm shifts before announcing the pilot.
- The owner wants a reversible experiment, a named responsibility (role, not an invented person's name), a spending estimate, and a measurable rule for continuing or stopping.
- No other funding, unpaid labor, or additional demand evidence is available. Do not invent it.

Recommend a practical decision. Clearly distinguish facts, assumptions, and what the experiment would test.`;
const reviewerTask = `You are the REVIEWER, independent of the writer. Do not spawn. Read brief.md and proposal.md version 1 using agent_read. Critique the actual draft against the brief: check arithmetic, evidence, operational feasibility and whether the owner can make a decision. Do not invent flaws; acknowledge what works. Publish review.md (expectedVersion=0), at most 150 words, with the most important corrections or questions. Send channel:main a direct, natural-language message to the writer summarizing your objections (at most 80 words). Then wait on artifacts/main only if proposal.md version 2 is not yet available. When the writer revises, read proposal.md version 2 and publish verdict.md (expectedVersion=0), at most 120 words: did it address your critique, what improved, and any unresolved reservations? Do not rubber-stamp it or rewrite it yourself. Send channel:main your final assessment, then agent_finish. Tool calls, not descriptions of tool calls.`;
const id = randomUUID();
const directory = resolve(".umwelten/e2e", id);
await mkdir(directory, { recursive: true });
const run = new CollaborationRun(directory, {
  id,
  limits: {
    maxAgents: 2,
    maxDepth: 1,
    concurrency: 2,
    maxCalls: 36,
    maxDurationMs: 600_000,
    maxTotalTokens: 250_000,
    maxOutputTokens: 3072,
    maxCostUsd: 0.25,
  },
});
const originalFetch = globalThis.fetch;
const captures: Promise<void>[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  const response = await originalFetch(input, init);
  if (
    url.origin === new URL(process.env.MYCEL_URL!).origin &&
    url.pathname.endsWith("/chat/completions")
  ) {
    const timestamp = new Date().toISOString();
    captures.push(
      response
        .clone()
        .text()
        .then((body) =>
          appendFile(
            join(directory, "provider-http.jsonl"),
            JSON.stringify({
              timestamp,
              status: response.status,
              request:
                typeof init?.body === "string" ? JSON.parse(init.body) : null,
              body,
            }) + "\n",
            { mode: 0o600 },
          ),
        ),
    );
  }
  return response;
};
const writer = run.addAgent({
  model: {
    provider: "mycel",
    name: modelName,
    costs: {
      promptTokens: offer.pricing.prompt,
      completionTokens: offer.pricing.completion,
    },
  },
  instructions:
    "Follow your assigned role. Communicate in plain English for a human who knows nothing about agent tools. Use actual tools, not invented tool results. You may disagree with a collaborator if you explain why. Do not claim that a real business action was taken: this is a fictional proposal.",
  task: `You are the WRITER. Read brief.md and write your best first proposal (at most 220 words) to proposal.md expectedVersion=0. Do not deliberately introduce mistakes to make the review look useful. Then spawn exactly one fresh-context reviewer with this task: ${JSON.stringify(reviewerTask)}. Send channel:main a short note asking the reviewer to challenge the proposal. Wait on artifacts/main if review.md is unavailable, then actually read it. Consider the objections and publish proposal.md version 2 with expectedVersion=1 (at most 260 words). Send channel:main a short reply explaining what you changed and any feedback you disagree with. Wait if verdict.md is unavailable; actually read the reviewer's verdict before agent_finish. Do not create further revisions or spawn anyone else. Do not finish before the reviewer's final assessment.`,
});
const started = Date.now();
let failure: string | undefined;
let status: ReturnType<CollaborationRun["status"]> | undefined;
const checks: string[] = [];
console.log(JSON.stringify({ id, directory, model: modelName }));
try {
  run.publish(null, "brief.md", brief, 0);
  run.start();
  await run.waitForIdle();
  status = run.status();
  const events = run.store.events();
  const reviewer = status.agents.find((a) => a.parentId === writer);
  assert.equal(status.agents.length, 2);
  assert.ok(reviewer);
  assert.ok(status.agents.every((a) => a.status === "finished"));
  checks.push("Both live agents finished");
  const publications = [
    ["proposal.md", 1, writer],
    ["review.md", 1, reviewer.id],
    ["proposal.md", 2, writer],
    ["verdict.md", 1, reviewer.id],
  ] as const;
  let previous = 0;
  for (const [path, version, author] of publications) {
    const event = events.find(
      (e) =>
        e.kind === "artifact.published" &&
        (e.data as { path: string; version: number }).path === path &&
        (e.data as { version: number }).version === version,
    );
    assert.ok(event, `${path} v${version} missing`);
    assert.equal(event.agentId, author);
    assert.ok(
      event.id > previous,
      "Draft, critique, revision, verdict must be in order",
    );
    assert.ok(run.store.artifact(path, version)?.content.trim());
    previous = event.id;
  }
  checks.push(
    "Writer draft → reviewer critique → writer revision → reviewer verdict, with correct authors",
  );
  assert.notEqual(
    run.store.artifact("proposal.md", 1)?.content,
    run.store.artifact("proposal.md", 2)?.content,
  );
  assert.equal(events.filter((e) => e.kind === "decision.failed").length, 0);
  checks.push("Revision differs; no failed model decisions");
} catch (error) {
  failure = String(error);
  process.exitCode = 1;
} finally {
  status ??= run.status();
  await run.close();
  await Promise.all(captures);
  globalThis.fetch = originalFetch;
  const store = new CollaborationStore(directory);
  const events = store.events();
  const sections = [
    "# Two AIs work on one café proposal",
    "Live Mycel outputs, reproduced verbatim below. The roles and brief were supplied by the host; the drafts, critiques and messages were written by the models. This is one example, not evidence of superiority over a single writer.",
  ];
  const labels: Record<string, string> = {
    "brief.md:1": "The assignment — supplied by the host",
    "proposal.md:1": "Writer — first draft",
    "review.md:1": "Reviewer — critique",
    "proposal.md:2": "Writer — revised draft",
    "verdict.md:1": "Reviewer — final assessment",
  };
  for (const event of events) {
    if (event.kind === "artifact.published") {
      const { path, version } = event.data as { path: string; version: number };
      sections.push(
        `## ${labels[`${path}:${version}`] ?? `${path} v${version}`}`,
        store.artifact(path, version)!.content,
      );
    }
    if (
      event.kind === "message" &&
      (event.data as { to: string }).to === "channel:main"
    )
      sections.push(
        `### ${event.agentId === writer ? "Writer → Reviewer" : "Reviewer → Writer"}`,
        (event.data as { content: string }).content,
      );
  }
  const report = {
    id,
    model: modelName,
    workflowPassed: !failure,
    failure,
    checks,
    qualityAutomaticallyScored: false,
    elapsedSeconds: (Date.now() - started) / 1000,
    calls: status.calls,
    tokens: status.tokens,
    estimatedCostUsd: status.costUsd,
    providerHttpCaptures: captures.length,
  };
  await writeFile(
    join(directory, "transcript.md"),
    sections.join("\n\n") + "\n",
  );
  await writeFile(
    join(directory, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(join(directory, "trace.jsonl"), store.exportTrace(), {
    mode: 0o600,
  });
  store.close();
  console.log(JSON.stringify(report, null, 2));
}
