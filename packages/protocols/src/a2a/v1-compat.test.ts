import { describe, it, expect } from "vitest";
import { Role, TaskState } from "@a2a-js/sdk";
import {
  agentMessage,
  dataPart,
  filePart,
  messageText,
  partData,
  partFileUrl,
  partText,
  taskFromStoredJson,
  taskStateFromLegacy,
  taskStateToLegacy,
  taskToStoredJson,
  textPart,
  userMessage,
} from "./v1-compat.js";

describe("state mapping", () => {
  it.each([
    ["submitted", TaskState.TASK_STATE_SUBMITTED],
    ["working", TaskState.TASK_STATE_WORKING],
    ["input-required", TaskState.TASK_STATE_INPUT_REQUIRED],
    ["completed", TaskState.TASK_STATE_COMPLETED],
    ["canceled", TaskState.TASK_STATE_CANCELED],
    ["failed", TaskState.TASK_STATE_FAILED],
    ["rejected", TaskState.TASK_STATE_REJECTED],
    ["auth-required", TaskState.TASK_STATE_AUTH_REQUIRED],
  ] as const)("round-trips %s", (legacy, v1) => {
    expect(taskStateFromLegacy(legacy)).toBe(v1);
    expect(taskStateToLegacy(v1)).toBe(legacy);
  });

  it("maps garbage to unspecified/unknown", () => {
    expect(taskStateFromLegacy("wat")).toBe(TaskState.TASK_STATE_UNSPECIFIED);
    expect(taskStateToLegacy(undefined)).toBe("unknown");
  });
});

describe("parts and messages", () => {
  it("builds and reads text/data/file parts", () => {
    expect(partText(textPart("hi"))).toBe("hi");
    expect(partData(dataPart({ a: 1 }))).toEqual({ a: 1 });
    expect(partFileUrl(filePart("/files/x", "text/html"))).toBe("/files/x");
    expect(partText(dataPart({}))).toBeUndefined();
  });

  it("builds messages with roles and concatenates text", () => {
    const m = agentMessage({ text: "hello", contextId: "c1", taskId: "t1" });
    expect(m.role).toBe(Role.ROLE_AGENT);
    expect(m.contextId).toBe("c1");
    expect(messageText(m)).toBe("hello");
    expect(userMessage({ text: "x" }).role).toBe(Role.ROLE_USER);
  });
});

describe("stored task JSON compatibility", () => {
  const legacyOnDisk = {
    kind: "task",
    id: "task-1",
    contextId: "ctx-1",
    status: {
      state: "completed",
      message: {
        kind: "message",
        messageId: "m-1",
        role: "agent",
        parts: [{ kind: "text", text: "all done" }],
      },
      timestamp: "2026-07-11T00:00:00Z",
    },
    history: [
      {
        kind: "message",
        messageId: "m-0",
        role: "user",
        parts: [{ kind: "text", text: "do it" }],
      },
    ],
    artifacts: [
      {
        artifactId: "a-1",
        name: "report",
        parts: [
          { kind: "file", file: { uri: "/files/report.html", mimeType: "text/html" } },
        ],
      },
    ],
  };

  it("reads a legacy 0.3-era task file", () => {
    const task = taskFromStoredJson(legacyOnDisk);
    expect(task.id).toBe("task-1");
    expect(task.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(messageText(task.status?.message)).toBe("all done");
    expect(task.status?.message?.role).toBe(Role.ROLE_AGENT);
    expect(task.history[0]?.role).toBe(Role.ROLE_USER);
    expect(partFileUrl(task.artifacts[0]!.parts[0]!)).toBe("/files/report.html");
    expect(task.artifacts[0]?.parts[0]?.mediaType).toBe("text/html");
  });

  it("round-trips a v1 task through storage", () => {
    const original = taskFromStoredJson(legacyOnDisk);
    const stored = taskToStoredJson(original);
    // Stored form uses proto-JSON state names, so a future read is exact.
    expect((stored as { status: { state: string } }).status.state).toBe(
      "TASK_STATE_COMPLETED",
    );
    const reread = taskFromStoredJson(stored);
    expect(reread).toEqual(original);
  });

  it("passes proto-JSON files through unchanged", () => {
    const task = taskFromStoredJson({
      id: "t2",
      contextId: "c2",
      status: { state: "TASK_STATE_WORKING" },
    });
    expect(task.status?.state).toBe(TaskState.TASK_STATE_WORKING);
  });
});
