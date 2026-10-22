import { customerKey, regionKey } from "./account-services.js";
import { button, card, empty, money, trackSubscription } from "./account-ui.js";

const number = (value) => new Intl.NumberFormat().format(value ?? 0);
const timestamp = (value) => new Date(value).toLocaleString();

function table(title, headings, rows) {
  const section = document.createElement("section");
  section.className = "report-breakdown";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const scroll = document.createElement("div");
  scroll.className = "report-table-scroll";
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", title);
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  for (const label of headings) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    head.append(cell);
  }
  const body = table.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().textContent = value;
  }
  scroll.append(table);
  section.append(heading, scroll);
  return section;
}

export default {
  name: "account-reports",
  inject: [regionKey, customerKey],
  apply(ctx, view) {
    const customer = view.get(customerKey);
    const element = card("account-reports", "Account", "Usage & reports");
    element.querySelector("header").remove();
    const body = element.querySelector(".account-card-body");
    const style = document.createElement("style");
    style.textContent = `
      body.account-surface main#region:has([data-component='account-reports']) { padding-top: 32px; }
      .report-heading { margin: 4px 0 12px; font: 400 clamp(32px,4vw,42px)/1.1 var(--serif); }
      .report-controls { max-width: none; grid-template-columns: 1fr 1fr auto; align-items: end; margin: 28px 0; }
      .report-metrics { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); border: 1px solid var(--line); margin: 24px 0; }
      .report-metrics > div { padding: 22px; min-width: 0; }
      .report-metrics > div + div { border-left: 1px solid var(--line); }
      .report-metrics span { display: block; font: 10px/1.5 var(--mono); text-transform: uppercase; color: var(--muted); }
      .report-metrics strong { display: block; margin-top: 12px; font: 23px/1.2 var(--mono); color: var(--accent); overflow-wrap: anywhere; }
      .report-breakdowns { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
      .report-breakdown { min-width: 0; }
      .report-breakdown h2, .report-requests h2 { font: 400 25px/1.2 var(--serif); margin: 24px 0 16px; }
      .report-table-scroll { overflow-x: auto; }
      .report-breakdown table { border-collapse: collapse; width: 100%; font: 11px/1.5 var(--mono); }
      .report-breakdown th { color: var(--muted); font-size: 9px; text-transform: uppercase; font-weight: normal; }
      .report-breakdown td, .report-breakdown th { padding: 14px 12px 14px 0; text-align: left; border-bottom: 1px solid var(--line); }
      .report-request { border-bottom: 1px solid var(--line); }
      .report-request summary { display: grid; grid-template-columns: minmax(140px,1fr) minmax(120px,1fr) 1fr 120px 100px 20px; gap: 12px; align-items: center; cursor: pointer; padding: 18px 0; font: 11px/1.5 var(--mono); }
      .report-request summary::after { content: '+'; color: var(--accent); }
      .report-request[open] summary::after { content: '−'; }
      .report-request summary:hover { background: rgba(199,244,170,.04); }
      .report-request summary > span { overflow-wrap: anywhere; }
      .report-request time, .report-request small { color: var(--muted); }
      .report-request small { display: block; margin-top: 4px; }
      .report-outcome { color: var(--accent); }
      .report-outcome[data-incomplete='true'] { color: var(--error); }
      .report-detail { margin: 0 0 18px; padding: 18px; background: rgba(199,244,170,.035); display: grid; grid-template-columns: 140px 1fr; gap: 12px; font: 11px/1.6 var(--mono); }
      .report-detail dt { color: var(--muted); }
      .report-detail dd { margin: 0; overflow-wrap: anywhere; }
      [data-component='account-reports'] [hidden] { display: none !important; }
      .report-status { color: var(--muted); line-height: 1.6; }
      @media (max-width: 760px) {
        .report-controls, .report-breakdowns { grid-template-columns: 1fr; }
        .report-metrics { grid-template-columns: 1fr 1fr; }
        .report-metrics > div { padding: 16px; }
        .report-metrics strong { font-size: 18px; }
        .report-metrics > div:nth-child(3) { border-left: 0; }
        .report-request summary { grid-template-columns: 1fr 1fr; }
        .report-detail { grid-template-columns: 1fr; gap: 4px; }
        .report-detail dd { margin-bottom: 12px; }
      }
    `;
    element.append(style);
    body.innerHTML =
      '<h1 class="report-heading">Usage reports</h1><p class="account-note">Spend and request activity across your account. Amounts are in USD.</p>';
    const controls = document.createElement("form");
    controls.className = "account-form report-controls";
    controls.innerHTML =
      '<label>Period<select name="period"><option value="7d">Last 7 days</option><option value="30d" selected>Last 30 days</option><option value="90d">Last 90 days</option><option value="all">All time</option></select></label><label>Application / key<select name="applicationId"><option value="">All applications</option></select></label>';
    const refresh = button("Refresh");
    refresh.type = "submit";
    controls.append(refresh);
    const status = document.createElement("p");
    status.className = "report-status";
    status.setAttribute("role", "status");
    const results = document.createElement("div");
    const query = new URLSearchParams(location.search);
    const period = controls.elements.namedItem("period");
    const application = controls.elements.namedItem("applicationId");
    if (["7d", "30d", "90d", "all"].includes(query.get("period")))
      period.value = query.get("period");
    let selection = query.get("applicationId") ?? "";
    let generation = 0;
    body.append(controls, status, results);
    view.get(regionKey).append(element);

    const renderReport = (report) => {
      const metrics = document.createElement("div");
      metrics.className = "report-metrics";
      for (const [label, value] of [
        ["Spend", money(report.summary.charge)],
        ["Requests", number(report.summary.requests)],
        [
          "Tokens",
          number(report.summary.promptTokens + report.summary.completionTokens),
        ],
        ["Non-completed", number(report.summary.nonCompleted)],
      ]) {
        const metric = document.createElement("div");
        const title = document.createElement("span");
        title.textContent = label;
        const amount = document.createElement("strong");
        amount.textContent = value;
        metric.append(title, amount);
        metrics.append(metric);
      }
      const note = empty(
        "Usage follows the Application, including rotated keys and playground requests. Individual key versions are not tracked. Token totals exclude non-token media units.",
      );
      const breakdowns = document.createElement("div");
      breakdowns.className = "report-breakdowns";
      const values = (row) => [
        money(row.charge),
        number(row.requests),
        number(row.nonCompleted),
      ];
      breakdowns.append(
        table(
          "Spend by Application / key",
          ["Application", "Spend", "Requests", "Non-completed"],
          report.byApplication.map((row) => [
            row.applicationId,
            ...values(row),
          ]),
        ),
        table(
          "Model usage",
          ["Model", "Spend", "Requests", "Non-completed"],
          report.byModel.map((row) => [row.model, ...values(row)]),
        ),
      );
      const requests = document.createElement("section");
      requests.className = "report-requests";
      requests.innerHTML = "<h2>Request history</h2>";
      requests.append(
        empty(
          `Showing ${report.requests.length} of ${number(report.totalRequests)} requests, newest first. Totals include every request in this period. Select a request for details.`,
        ),
      );
      for (const request of report.requests) {
        const detail = document.createElement("details");
        detail.className = "report-request";
        const summary = document.createElement("summary");
        const time = document.createElement("time");
        time.dateTime = request.startedAt;
        time.textContent = timestamp(request.startedAt);
        summary.append(time);
        for (const value of [
          request.model,
          request.applicationId,
          request.outcome,
          money(request.charge),
        ]) {
          const cell = document.createElement("span");
          cell.textContent = value;
          if (value === request.outcome) {
            cell.className = "report-outcome";
            cell.dataset.incomplete = String(request.outcome !== "completed");
          }
          summary.append(cell);
        }
        const fields = document.createElement("dl");
        fields.className = "report-detail";
        for (const [label, value] of [
          ["Request ID", request.id],
          ["End user", request.subject],
          ["Operation", request.operation ?? "chat"],
          ["Started", timestamp(request.startedAt)],
          ["Finished", timestamp(request.finishedAt)],
          [
            "Duration",
            `${number(new Date(request.finishedAt) - new Date(request.startedAt))} ms`,
          ],
          ["Input tokens", number(request.promptTokens)],
          ["Output tokens", number(request.completionTokens)],
          ...(request.inputUnit
            ? [
                [
                  "Input units",
                  `${number(request.inputUnits)} ${request.inputUnit}`,
                ],
              ]
            : []),
          ...(request.outputUnit
            ? [
                [
                  "Output units",
                  `${number(request.outputUnits)} ${request.outputUnit}`,
                ],
              ]
            : []),
        ]) {
          const term = document.createElement("dt");
          term.textContent = label;
          const definition = document.createElement("dd");
          definition.textContent = value;
          fields.append(term, definition);
        }
        detail.append(summary, fields);
        requests.append(detail);
      }
      if (!report.totalRequests)
        requests.append(
          empty(
            "No requests in this period. Try another period or Application.",
          ),
        );
      results.replaceChildren(metrics, note, breakdowns, requests);
    };

    const load = async () => {
      const current = ++generation;
      results.replaceChildren();
      status.textContent = "Loading usage…";
      refresh.disabled = true;
      const params = new URLSearchParams({ period: period.value });
      if (application.value) params.set("applicationId", application.value);
      history.replaceState(null, "", `?${params}`);
      try {
        const report = await customer.request(`/reports?${params}`);
        if (current !== generation) return;
        renderReport(report);
        status.textContent = `${report.from ? timestamp(report.from) : "All recorded history"} to ${timestamp(report.to)}. Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
      } catch (error) {
        if (current === generation)
          status.textContent = `Could not load reports. ${error.message} Use Refresh to retry.`;
      } finally {
        if (current === generation) refresh.disabled = false;
      }
    };
    controls.addEventListener("submit", (event) => {
      event.preventDefault();
      void load();
    });
    controls.addEventListener("change", () => {
      selection = application.value;
      void load();
    });
    trackSubscription(ctx, customer, (state) => {
      generation++;
      controls.hidden = state.phase !== "ready" || !state.dashboard?.onboarded;
      if (controls.hidden) {
        results.replaceChildren();
        status.textContent =
          state.phase === "loading"
            ? "Loading your account…"
            : state.phase === "error"
              ? `Could not load your account. ${state.error.message}`
              : "Sign in and set up your account to see usage reports.";
        const link = document.createElement("a");
        link.href = "/account/";
        link.className = "account-button";
        link.textContent = "Go to account";
        results.append(link);
        return;
      }
      application.replaceChildren(new Option("All applications", ""));
      for (const app of state.dashboard.applications)
        application.add(
          new Option(`${app.id}${app.enabled ? "" : " (disabled)"}`, app.id),
        );
      application.value = selection;
      void load();
    });
    return () => {
      generation++;
      element.remove();
    };
  },
};
