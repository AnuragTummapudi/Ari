export type InterviewStage = "opening" | "product" | "technical" | "ownership" | "candidate_questions" | "complete";
export const STAGES: InterviewStage[] = ["opening", "product", "technical", "ownership", "candidate_questions", "complete"];
export function nextStage(stage: InterviewStage, answerCount: number): InterviewStage {
  if (stage === "opening") return "product";
  if (stage === "product" && answerCount >= 3) return "technical";
  if (stage === "technical" && answerCount >= 3) return "ownership";
  if (stage === "ownership" && answerCount >= 3) return "candidate_questions";
  if (stage === "candidate_questions" && answerCount >= 1) return "complete";
  return stage;
}
export function fallbackFollowUp(text: string, stage: InterviewStage) {
  if (text.trim().length < 35) return "Could you share one concrete example, including what you personally owned?";
  if (/we|team|partner/i.test(text)) return "What part of that work did you personally own, and how did you know it was successful?";
  if (stage === "technical") return "What trade-off did you consider, and what evidence led you to that choice?";
  return "What changed because of that decision, and how did you measure the outcome?";
}
export function questionForStage(
  stage: InterviewStage,
  coreQuestions: string[],
  projectClaims: string[],
): string {
  if (stage === "product") return coreQuestions[0] || "Tell me about a product decision you influenced with evidence.";
  if (stage === "technical") return coreQuestions[1] || "Walk me through a system you designed and the trade-offs you made.";
  if (stage === "ownership") {
    const claim = projectClaims[0]?.trim();
    return claim
      ? `You mentioned ${claim.replace(/[.!?]+$/, "")}. What part did you personally own, and what changed because of it?`
      : "Tell me about a project where you had clear ownership. What decisions were yours, and what changed because of them?";
  }
  if (stage === "candidate_questions") return "What questions can I answer about the role or team?";
  if (stage === "complete") return "Thank you for the thoughtful conversation. That’s everything I wanted to cover.";
  return "To start, tell me a little about the work you’re most proud of.";
}
export function validateCitations<T extends { supportingTurnIds: string[] }>(findings: T[], confirmedTurnIds: Set<string>): T[] {
  return findings.map(f => ({ ...f, supportingTurnIds: f.supportingTurnIds.filter(id => confirmedTurnIds.has(id)) }));
}
