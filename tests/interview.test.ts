import { describe, expect, it } from "vitest";
import { fallbackFollowUp, nextStage, questionForStage, validateCitations } from "../lib/interview";
import { createInterviewAccessToken, getInterviewIdFromAccessToken, verifyInterviewAccessToken } from "../lib/interview-access";

describe("interview progression", () => {
  it("moves through bounded stages and ends after candidate questions", () => {
    expect(nextStage("opening", 0)).toBe("product");
    expect(nextStage("product", 2)).toBe("product");
    expect(nextStage("product", 3)).toBe("technical");
    expect(nextStage("technical", 3)).toBe("ownership");
    expect(nextStage("ownership", 3)).toBe("candidate_questions");
    expect(nextStage("candidate_questions", 1)).toBe("complete");
  });
  it("asks for a concrete example when the answer is too short", () => {
    expect(fallbackFollowUp("We did it", "product")).toContain("concrete example");
  });
  it("uses the technical core question, then an ownership probe instead of repeating product", () => {
    expect(questionForStage("technical", ["Product question", "Technical question"], [])).toBe("Technical question");
    expect(questionForStage("ownership", ["Product question", "Technical question"], ["built a scheduling tool that saved 10 hours"]))
      .toContain("You mentioned built a scheduling tool that saved 10 hours");
    expect(questionForStage("candidate_questions", [], [])).toContain("What questions");
  });
});
describe("report evidence safety", () => {
  it("removes citations that do not refer to confirmed turns", () => {
    const report = [{ skill: "Ownership", supportingTurnIds: ["turn-good", "invented"] }];
    expect(validateCitations(report, new Set(["turn-good"]))[0].supportingTurnIds).toEqual(["turn-good"]);
  });
  it("preserves a valid empty evidence set", () => {
    expect(validateCitations([{ skill: "Depth", supportingTurnIds: [] }], new Set())[0].supportingTurnIds).toEqual([]);
  });
});

describe("candidate interview access", () => {
  it("signs scoped links and rejects tampered, wrong-interview, and expired access", () => {
    process.env.INTERNAL_API_SECRET = "test-only-secret-with-at-least-32-characters";
    const now = 1_800_000_000_000;
    const token = createInterviewAccessToken("interview-1", now);
    expect(getInterviewIdFromAccessToken(token, now)).toBe("interview-1");
    expect(verifyInterviewAccessToken(token, "interview-1", now)).toBe(true);
    expect(verifyInterviewAccessToken(token, "interview-2", now)).toBe(false);
    expect(verifyInterviewAccessToken(`${token}x`, "interview-1", now)).toBe(false);
    expect(getInterviewIdFromAccessToken(token, now + 15 * 24 * 60 * 60 * 1000)).toBeNull();
  });
});
