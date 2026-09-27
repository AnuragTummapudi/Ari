import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nextStage, type InterviewStage } from "@/lib/interview";

export const runtime = "nodejs";
export async function POST(req: Request) {
  if (!process.env.INTERNAL_API_SECRET || req.headers.get("x-internal-secret") !== process.env.INTERNAL_API_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { room, speaker, text, startedAt } = await req.json();
    if (!room || !text?.trim() || !["ARI", "CANDIDATE"].includes(speaker)) return NextResponse.json({ error: "Invalid confirmed transcript turn" }, { status: 400 });
    const interview = await prisma.interview.findUnique({ where: { roomName: room }, include: { turns: { select: { speaker: true, stage: true } } } });
    if (!interview) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    const current = interview.stage as InterviewStage;
    const turnStage = current || "opening";
    const priorAnswers = interview.turns?.filter((t: { speaker: string; stage: string }) => t.speaker === "CANDIDATE" && t.stage === turnStage).length || 0;
    const next = speaker === "CANDIDATE" ? nextStage(turnStage, priorAnswers + 1) : turnStage;
    const turn = await prisma.turn.create({ data: { interviewId: interview.id, speaker, text: text.trim(), stage: turnStage, skillTags: [], startedAt: startedAt ? new Date(startedAt) : new Date(), final: true } });
    const coverage = Array.isArray(interview.coverage) ? interview.coverage as string[] : [];
    await prisma.interview.update({ where: { id: interview.id }, data: { status: "IN_PROGRESS", stage: next, ...(speaker === "CANDIDATE" ? { coverage: Array.from(new Set([...coverage, turnStage])) } : {}) } });
    const STAGES = ["opening", "product", "technical", "ownership", "candidate_questions", "complete"];
    const stageIndex = Math.min(Math.max(STAGES.indexOf(next), 0), 4);
    return NextResponse.json({
      id: turn.id,
      speaker: turn.speaker,
      text: turn.text,
      stage: next,
      stageIndex,
      startedAt: turn.startedAt.toISOString(),
    }, { status: 201 });
  } catch { return NextResponse.json({ error: "Transcript persistence failed" }, { status: 503 }); }
}
