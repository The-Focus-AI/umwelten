import { describe, it, expect } from "vitest";
import { getCompactionSegment } from "./segment.js";

describe("getCompactionSegment", () => {
  it("returns null for too few messages", () => {
    expect(getCompactionSegment([{ role: "system", content: "Hi" }])).toBeNull();
  });

  it("returns segment from 1 to last assistant when no checkpoint", () => {
    const messages = [
      { role: "system", content: "Sys" },
      { role: "user", content: "U1" },
      { role: "assistant", content: "A1" },
    ];
    const seg = getCompactionSegment(messages, { fromCheckpoint: false });
    expect(seg).toEqual({ start: 1, end: 2 });
  });

  it("returns segment from checkpoint to last assistant", () => {
    const messages = [
      { role: "system", content: "Sys" },
      { role: "user", content: "U1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "U2" },
      { role: "assistant", content: "A2" },
    ];
    const seg = getCompactionSegment(messages, { fromCheckpoint: true, checkpointIndex: 1 });
    expect(seg).toEqual({ start: 1, end: 4 });
  });

  it("returns null when no assistant in range", () => {
    const messages = [
      { role: "system", content: "Sys" },
      { role: "user", content: "U1" },
    ];
    expect(getCompactionSegment(messages)).toBeNull();
  });
});
