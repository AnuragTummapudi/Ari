import { describe, expect, it } from "vitest";
import { SpeakingGate } from "../lib/speaking";

describe("speaking border activity", () => {
  it("lights for audible speech and holds briefly between syllables", () => {
    const gate = new SpeakingGate(0.01, 240);
    expect(gate.update(0.004, 0)).toBe(false);
    expect(gate.update(0.025, 100)).toBe(true);
    expect(gate.update(0.002, 250)).toBe(true);
    expect(gate.update(0.002, 341)).toBe(false);
  });

  it("clears immediately when a microphone is muted or a track ends", () => {
    const gate = new SpeakingGate(0.01);
    expect(gate.update(0.03, 100)).toBe(true);
    expect(gate.update(0.03, 120, false)).toBe(false);
    expect(gate.update(0, 130)).toBe(false);
  });

  it("allows Ari and the candidate to be tracked independently", () => {
    const ari = new SpeakingGate(0.0025);
    const candidate = new SpeakingGate(0.018);
    expect(ari.update(0.012, 100)).toBe(true);
    expect(candidate.update(0.012, 100)).toBe(false);
    expect(candidate.update(0.024, 150)).toBe(true);
    ari.reset();
    expect(ari.update(0, 160)).toBe(false);
    expect(candidate.update(0.003, 160)).toBe(true);
  });
});
