import type { Application, RequestRecord } from "../types.js";

export type ReportPeriod = "7d" | "30d" | "90d" | "all";

export function isReportPeriod(value: string): value is ReportPeriod {
  return (
    value === "7d" || value === "30d" || value === "90d" || value === "all"
  );
}

function metrics(requests: RequestRecord[]) {
  return {
    charge: requests.reduce((sum, request) => sum + request.charge, 0),
    requests: requests.length,
    promptTokens: requests.reduce(
      (sum, request) => sum + request.promptTokens,
      0,
    ),
    completionTokens: requests.reduce(
      (sum, request) => sum + request.completionTokens,
      0,
    ),
    nonCompleted: requests.filter((request) => request.outcome !== "completed")
      .length,
    averageDurationMs:
      requests.length === 0
        ? 0
        : requests.reduce(
            (sum, request) =>
              sum + request.finishedAt.getTime() - request.startedAt.getTime(),
            0,
          ) / requests.length,
  };
}

export function customerReport(options: {
  period: ReportPeriod;
  applications: Application[];
  requests: RequestRecord[];
  now: Date;
}) {
  const { period, applications, now } = options;
  const days = { "7d": 7, "30d": 30, "90d": 90 };
  const from =
    period === "all"
      ? null
      : new Date(now.getTime() - days[period] * 86_400_000);
  const ownedIds = new Set(applications.map((application) => application.id));
  const requests = options.requests
    .filter(
      (request) =>
        ownedIds.has(request.applicationId) &&
        request.startedAt <= now &&
        (from === null || request.startedAt >= from),
    )
    .sort(
      (left, right) =>
        right.startedAt.getTime() - left.startedAt.getTime() ||
        left.id.localeCompare(right.id),
    );
  return {
    period,
    from: from?.toISOString() ?? null,
    to: now.toISOString(),
    applications: applications.map(({ id, enabled }) => ({ id, enabled })),
    summary: metrics(requests),
    byApplication: applications.map(({ id }) => ({
      applicationId: id,
      ...metrics(requests.filter((request) => request.applicationId === id)),
    })),
    byModel: [...new Set(requests.map((request) => request.model))]
      .sort()
      .map((model) => ({
        model,
        ...metrics(requests.filter((request) => request.model === model)),
      })),
    requests: requests.slice(0, 100).map((request) => ({
      id: request.id,
      applicationId: request.applicationId,
      subject: request.subject,
      model: request.model,
      operation: request.operation ?? "chat",
      promptTokens: request.promptTokens,
      completionTokens: request.completionTokens,
      charge: request.charge,
      outcome: request.outcome,
      startedAt: request.startedAt.toISOString(),
      finishedAt: request.finishedAt.toISOString(),
      inputUnits: request.inputUnits ?? null,
      outputUnits: request.outputUnits ?? null,
      inputUnit: request.inputUnit ?? null,
      outputUnit: request.outputUnit ?? null,
    })),
    totalRequests: requests.length,
  };
}
