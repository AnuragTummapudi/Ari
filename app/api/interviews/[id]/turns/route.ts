import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fallbackFollowUp, nextStage, questionForStage, type InterviewStage } from "@/lib/interview";
import { verifyInterviewAccessToken } from "@/lib/interview-access";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { text } = await req.json();
    if (!text?.trim()) return NextResponse.json({ error: "A confirmed answer is required" }, { status: 400 });
    const interview = await prisma.interview.findUnique({ where: { id }, include: { turns: { orderBy: { startedAt: "asc" } }, role: true, candidate: true } });
    if (!interview) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    if (!verifyInterviewAccessToken(req.headers.get("x-interview-access"), id)) return NextResponse.json({ error: "Interview access expired. Reopen your invitation link." }, { status: 401 });
    const current = stageFor(interview.stage);
    const priorAnswers = interview.turns.filter((t: { speaker: string; stage: string }) => t.speaker === "CANDIDATE" && t.stage === current).length;
    const answer = await prisma.turn.create({ data: { interviewId: id, speaker: "CANDIDATE", text: text.trim(), stage: current, skillTags: tagsFor(current) } });
    const followingStage = nextStage(current, priorAnswers + 1);
    const blueprint = interview.blueprint as { coreQuestions?: string[]; personalizedProjectProbes?: string[] | string; resumeClaims?: unknown } | null;
    const coreQuestions = blueprint?.coreQuestions || [];
    const probes = blueprint?.personalizedProjectProbes;
    const projectClaims = Array.isArray(probes) ? probes : typeof probes === "string" ? [probes] : [];
    const nextStageQuestion = followingStage === current ? null : questionForStage(followingStage, coreQuestions, projectClaims);
    const prompt = `You are Ari, a thoughtful and concise professional interviewer. Role: ${interview.role.title}. Role requirements: ${JSON.stringify(interview.role.requirements)}. Interview blueprint: ${JSON.stringify(interview.blueprint)}. Current stage: ${current}. Candidate stage answers including this one: ${priorAnswers + 1}. Ask exactly one question and never score the candidate during the interview. ${nextStageQuestion ? `Move to ${followingStage} and ask this stage question, keeping its intent: ${nextStageQuestion}` : `Ask one concise follow-up in the ${current} stage. Clarify ambiguity or probe the candidate's personal ownership. This is answer ${priorAnswers + 1} of at most 3 for this stage (one core question and no more than two follow-ups).`} Candidate answer: ${text.trim()}`;
    const question = await askSarvam(prompt).catch(() => nextStageQuestion || fallbackFollowUp(text, current));
    const ari = await prisma.turn.create({ data: { interviewId: id, speaker: "ARI", text: question, stage: followingStage, skillTags: tagsFor(followingStage) } });
    const coverage = Array.isArray(interview.coverage) ? interview.coverage as string[] : [];
    await prisma.interview.update({ where: { id }, data: { stage: followingStage, coverage: Array.from(new Set([...coverage, current])) } });
    return NextResponse.json({
      answer: { id: answer.id, speaker: answer.speaker, text: answer.text, stage: answer.stage, skillTags: answer.skillTags, startedAt: answer.startedAt },
      turn: { id: ari.id, speaker: ari.speaker, text: ari.text, stage: ari.stage, skillTags: ari.skillTags, startedAt: ari.startedAt },
      stageIndex: ["opening", "product", "technical", "ownership", "candidate_questions", "complete"].indexOf(followingStage),
    });
  } catch { return NextResponse.json({ error: "Could not save this confirmed transcript turn." }, { status: 503 }); }
}
function stageFor(stage: string): InterviewStage { return ["opening", "product", "technical", "ownership", "candidate_questions", "complete"].includes(stage) ? stage as InterviewStage : "opening"; }
function tagsFor(stage: InterviewStage) { const tags: Record<string,string[]> = { product: ["Product thinking"], technical: ["Technical depth"], ownership: ["Ownership", "Communication"], candidate_questions: ["Communication"] }; return tags[stage] || ["Communication"]; }
async function askSarvam(prompt: string) { const key = process.env.SARVAM_API_KEY; if (!key) throw new Error("SARVAM_API_KEY missing"); const base = process.env.SARVAM_LLM_BASE_URL || "https://api.sarvam.ai/v1"; const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "api-subscription-key": key }, body: JSON.stringify({ model: process.env.SARVAM_INTERVIEW_MODEL || "sarvam-105b-conversations", messages: [{ role: "user", content: prompt }], max_tokens: 100, temperature: 0.4 }) }); if (!res.ok) throw new Error(`Sarvam ${res.status}`); const d = await res.json(); return String(d.choices?.[0]?.message?.content || "Could you say a little more about what you personally owned?").replace(/^"|"$/g, ""); }
