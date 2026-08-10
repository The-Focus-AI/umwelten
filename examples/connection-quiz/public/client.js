/**
 * Thin browser client for the Umwelten-backed connection quiz.
 * No model calls, no prompting, no memory extraction — just UI + fetch/SSE.
 */
const $ = (sel) => document.querySelector(sel);
const STORE_KEY = "umwelten-connection-quiz-session";

const ui = {
  session: null,
  busy: false,
  streamingBubble: null,
};

function setStatus(text, isError = false, busy = null) {
  const value = text ?? "";
  $("#statusText").textContent = value;
  const el = $("#status");
  el.classList.toggle("error", !!isError);
  el.classList.toggle("busy", busy === null ? !isError && /…$/.test(value) : !!busy);
}

function setSetupStatus(text, isError = false, busy = null) {
  const el = $("#setupStatus");
  const value = text ?? "";
  el.hidden = !value;
  $("#setupStatusText").textContent = value;
  el.classList.toggle("error", !!isError);
  el.classList.toggle("busy", busy === null ? !isError && /…$/.test(value) : !!busy);
}

function setLearning(on) {
  $("#learnState").hidden = !on;
}

function setPhaseLabel(session) {
  const labels = {
    interview: "Interview",
    companion: "Companion",
    setup: "Setup",
  };
  $("#phaseLabel").textContent = labels[session?.phase ?? "setup"];
  $("#panelTitle").textContent =
    session?.phase === "companion" ? "Keep talking" : "Interview";
}

function syncComposer(session) {
  if (!session || session.phase === "companion") {
    $("#send").textContent = "Send";
    $("#skip").classList.add("hidden");
    $("#answer").placeholder = "Say anything — they remember you…";
    $("#progress").textContent = "Free conversation";
    return;
  }
  if (session.step === "human-followup") {
    $("#send").textContent = "Respond";
    $("#skip").textContent = "Next question";
    $("#skip").classList.remove("hidden");
    $("#answer").placeholder = "Respond to them — deepen, correct, or share more…";
  } else {
    $("#send").textContent = "Share answer";
    $("#skip").textContent = "Skip";
    $("#skip").classList.remove("hidden");
    $("#answer").placeholder = "Answer in your own words — what comes up for you…";
  }
  $("#progress").textContent = `Q ${session.questionIndex + 1} / ${session.totalQuestions} · ${
    session.step === "human-followup" ? "your response" : "your answer"
  }`;
}

function setComposerEnabled(on) {
  $("#answer").disabled = !on;
  $("#send").disabled = !on;
  $("#skip").disabled = !on;
}

function renderFacts(key, elId, countId, items, flash = false) {
  const ul = $(elId);
  $(countId).textContent = String(items.length);
  if (!items.length) {
    const empty = {
      you: "Nothing yet — your answers will land here.",
      them: "Partner facts accumulate as they answer.",
      connection: "Shared themes and resonance appear here.",
    };
    ul.innerHTML = `<li class="empty">${empty[key]}</li>`;
    return;
  }
  ul.innerHTML = items
    .map((text) => `<li class="${flash ? "new" : ""}">${escapeHtml(text)}</li>`)
    .join("");
}

function renderMemory(memory, flash = false) {
  renderFacts("you", "#youFacts", "#youCount", memory.you ?? [], flash);
  renderFacts("them", "#themFacts", "#themCount", memory.them ?? [], flash);
  renderFacts("connection", "#usFacts", "#usCount", memory.connection ?? [], flash);

  // The rail stacks below the fold on narrow windows, so the header carries
  // the same signal: you should never have to scroll to see it learning.
  const total =
    (memory.you?.length ?? 0) +
    (memory.them?.length ?? 0) +
    (memory.connection?.length ?? 0);
  const summary = $("#learnedSummary");
  summary.textContent = `learned ${total}`;
  if (flash && total > 0) {
    summary.classList.remove("flash");
    void summary.offsetWidth;
    summary.classList.add("flash");
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function addBubble({ kind, who, body, streaming = false }) {
  const thread = $("#thread");
  const div = document.createElement("div");
  div.className = `bubble ${kind}${streaming ? " streaming" : ""}`;
  const whoHtml = who ? `<div class="who">${escapeHtml(who)}</div>` : "";
  div.innerHTML = `${whoHtml}<div class="body">${body ? escapeHtml(body) : ""}</div>`;
  let thinking = null;
  let timer = null;
  if (streaming && !body) {
    thinking = document.createElement("div");
    thinking.className = "thinking";
    thinking.innerHTML =
      '<span class="dots"><i></i><i></i><i></i></span><span class="elapsed">thinking</span>';
    div.appendChild(thinking);
    const started = Date.now();
    const elapsed = thinking.querySelector(".elapsed");
    timer = setInterval(() => {
      elapsed.textContent = `thinking ${Math.round((Date.now() - started) / 1000)}s`;
    }, 1000);
  }
  const clearThinking = () => {
    if (timer) clearInterval(timer);
    thinking?.remove();
    thinking = null;
    timer = null;
  };
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
  return {
    setBody(text) {
      if (text) clearThinking();
      div.querySelector(".body").textContent = text;
      thread.scrollTop = thread.scrollHeight;
    },
    done() {
      clearThinking();
      div.classList.remove("streaming");
    },
  };
}

function renderThread(events) {
  $("#thread").innerHTML = "";
  for (const ev of events) {
    const kind =
      ev.role === "you"
        ? "you"
        : ev.role === "partner"
          ? "partner"
          : ev.role === "question"
            ? "question"
            : "system";
    addBubble({ kind, who: ev.label, body: ev.text });
  }
}

function applySession(session, { flashMemory = false } = {}) {
  ui.session = session;
  localStorage.setItem(STORE_KEY, session.id);
  $("#setup").classList.add("hidden");
  $("#app").classList.remove("hidden");
  setPhaseLabel(session);
  syncComposer(session);
  renderThread(session.events);
  renderMemory(session.memory, flashMemory);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      detail = (await res.json()).error ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res;
}

async function readSse(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(6)));
    }
  }
}

async function startNew() {
  setSetupStatus("Starting session…");
  $("#start").disabled = true;
  try {
    const health = await (await api("/api/health")).json();
    const provider = $("#provider").value;
    const name = $("#modelId").value.trim() || health.defaultModel.name;
    const res = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ model: { provider, name } }),
    });
    const { session } = await res.json();
    setSetupStatus("");
    applySession(session);
    setStatus("You go first — answer from your side.");
    setComposerEnabled(true);
    $("#answer").focus();
  } catch (err) {
    setSetupStatus(err.message, true);
  } finally {
    $("#start").disabled = false;
  }
}

async function continueSaved() {
  const id = localStorage.getItem(STORE_KEY);
  if (!id) return;
  setSetupStatus("Loading saved session…");
  try {
    const res = await api(`/api/sessions/${id}`);
    const { session } = await res.json();
    setSetupStatus("");
    applySession(session);
    setStatus(
      session.step === "human-followup"
        ? "Your turn — respond to what they shared."
        : session.phase === "companion"
          ? ""
          : "You go first — answer from your side.",
    );
    setComposerEnabled(true);
    $("#answer").focus();
  } catch (err) {
    localStorage.removeItem(STORE_KEY);
    setSetupStatus(`Couldn’t resume: ${err.message}`, true);
    updateSavedHint();
  }
}

async function submitAnswer({ skipped = false } = {}) {
  if (ui.busy || !ui.session) return;
  const text = skipped ? "" : $("#answer").value.trim();
  if (!skipped && !text) {
    setStatus("Write something, or skip.", true);
    return;
  }

  ui.busy = true;
  setComposerEnabled(false);
  $("#answer").value = "";

  if (skipped) {
    try {
      const res = await api(`/api/sessions/${ui.session.id}/skip`, { method: "POST", body: "{}" });
      const { session } = await res.json();
      applySession(session);
      setStatus("You go first — answer from your side.");
      setComposerEnabled(true);
      $("#answer").focus();
    } catch (err) {
      setStatus(err.message, true);
      setComposerEnabled(true);
    } finally {
      ui.busy = false;
    }
    return;
  }

  addBubble({ kind: "you", who: "You", body: text });
  setStatus("Alex is reflecting…");

  try {
    const res = await fetch(`/api/sessions/${ui.session.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    let full = "";
    let learnError = null;
    let gotMemory = false;
    await readSse(res, (event) => {
      if (event.type === "partner-start") {
        ui.streamingBubble?.done();
        ui.streamingBubble = addBubble({ kind: "partner", who: "Alex", streaming: true });
        full = "";
        setStatus(event.mode === "companion" ? "Alex is here…" : "Alex is reflecting…");
      } else if (event.type === "delta") {
        full += event.delta;
        ui.streamingBubble?.setBody(full.trim());
      } else if (event.type === "partner") {
        ui.streamingBubble?.setBody(event.text);
        ui.streamingBubble?.done();
        ui.streamingBubble = null;
      } else if (event.type === "learning-start") {
        setLearning(true);
        setStatus("Updating what it’s learning…");
      } else if (event.type === "memory") {
        setLearning(false);
        gotMemory = true;
        renderMemory(event.memory, true);
      } else if (event.type === "memory-error") {
        setLearning(false);
        learnError = event.message;
      } else if (event.type === "session") {
        ui.session = event.session;
        localStorage.setItem(STORE_KEY, event.session.id);
        setPhaseLabel(event.session);
        syncComposer(event.session);
      } else if (event.type === "error") {
        throw new Error(event.message);
      } else if (event.type === "done") {
        renderThread(ui.session.events);
        // Re-rendering without flash would immediately wipe the highlight the
        // memory event just drew, so leave it alone when it's already current.
        if (!gotMemory) renderMemory(ui.session.memory);
        setLearning(false);
        if (learnError) setStatus(`Couldn’t update the model: ${learnError}`, true);
        else if (ui.session.phase === "companion") setStatus("");
        else if (ui.session.step === "human-followup") {
          setStatus("Your turn again — respond to what they shared.");
        } else {
          setStatus("You go first — answer from your side.");
        }
      }
    });
  } catch (err) {
    ui.streamingBubble?.done();
    ui.streamingBubble?.setBody(`(error: ${err.message})`);
    setStatus(err.message, true);
    setLearning(false);
  } finally {
    ui.busy = false;
    setComposerEnabled(true);
    $("#answer").focus();
  }
}

async function updateSavedHint() {
  const id = localStorage.getItem(STORE_KEY);
  const hint = $("#savedHint");
  const cont = $("#continue");
  if (!id) {
    hint.hidden = true;
    cont.hidden = true;
    return;
  }
  try {
    const res = await api(`/api/sessions/${id}`);
    const { session } = await res.json();
    hint.hidden = false;
    cont.hidden = false;
    cont.textContent = `Continue at question ${session.questionIndex + 1}`;
    const facts =
      session.memory.you.length +
      session.memory.them.length +
      session.memory.connection.length;
    hint.textContent = `Saved on server: Q${session.questionIndex + 1} · ${facts} facts · ${session.phase}.`;
  } catch {
    localStorage.removeItem(STORE_KEY);
    hint.hidden = true;
    cont.hidden = true;
  }
}

function clearSaved() {
  localStorage.removeItem(STORE_KEY);
  ui.session = null;
  $("#app").classList.add("hidden");
  $("#setup").classList.remove("hidden");
  $("#thread").innerHTML = "";
  setPhaseLabel(null);
  updateSavedHint();
  setSetupStatus("Ready for a new interview.");
}

$("#start").addEventListener("click", startNew);
$("#continue").addEventListener("click", continueSaved);
$("#clearSaved").addEventListener("click", clearSaved);
$("#resetAll").addEventListener("click", clearSaved);
$("#exportModel").addEventListener("click", () => {
  if (!ui.session) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(ui.session.memory, null, 2)], { type: "application/json" }),
  );
  a.download = `connection-model-${ui.session.id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#send").addEventListener("click", () => submitAnswer());
$("#skip").addEventListener("click", () => submitAnswer({ skipped: true }));
$("#answer").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    $("#send").click();
  }
});
$("#provider").addEventListener("change", () => {
  if ($("#provider").value === "ollama" && !$("#modelId").value.trim()) {
    $("#modelId").value = "gemma4:26b";
  }
});

(async function boot() {
  try {
    const health = await (await api("/api/health")).json();
    $("#modelId").value = health.defaultModel?.name ?? "gemma4:26b";
    if (health.defaultModel?.provider) $("#provider").value = health.defaultModel.provider;
    setSetupStatus(
      `Server ready · ${health.defaultModel.provider}/${health.defaultModel.name}`,
    );
  } catch (err) {
    setSetupStatus(`Server not reachable: ${err.message}`, true);
  }
  await updateSavedHint();
})();
