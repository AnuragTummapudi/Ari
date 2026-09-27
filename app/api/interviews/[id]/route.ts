import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getInterviewIdFromAccessToken } from "@/lib/interview-access";
import { getAriUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: token } = await params;
  try {
    const interviewId = await resolveInterviewToken(token, req);
    if (!interviewId) return NextResponse.json({ error: "Interview invitation is invalid or expired" }, { status: 401 });
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        role: true,
        candidate: true,
        turns: {
          where: { final: true },
          orderBy: { startedAt: "asc" },
          select: {
            id: true,
            speaker: true,
            text: true,
            stage: true,
            startedAt: true,
            skillTags: true,
          },
        },
      },
    });
    if (!interview) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    const STAGES = ["opening", "product", "technical", "ownership", "candidate_questions", "complete"];
    const stageIndex = Math.min(Math.max(STAGES.indexOf((interview.stage || "opening") as any), 0), 4);
    return NextResponse.json({
      id: interview.id,
      room: interview.roomName,
      roleTitle: interview.role.title,
      candidateName: interview.candidate.name,
      status: interview.status,
      practice: interview.isPractice,
      stage: interview.stage || "opening",
      stageIndex,
      turns: interview.turns.map((t: { id: string; speaker: string; text: string; stage: string; startedAt: Date; skillTags: unknown }) => ({
        id: t.id,
        speaker: t.speaker,
        text: t.text,
        stage: t.stage,
        startedAt: t.startedAt.toISOString(),
        skillTags: Array.isArray(t.skillTags) ? (t.skillTags as string[]) : [],
      })),
    });
  } catch { return NextResponse.json({ error: "Database unavailable" }, { status: 503 }); }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: token } = await params;
  try {
    const body = await req.json();
    const interviewId = await resolveInterviewToken(token, req);
    if (!interviewId) return NextResponse.json({ error: "Interview invitation is invalid or expired" }, { status: 401 });
    const interview = await prisma.interview.findUnique({ where: { id: interviewId }, include: { candidate: true } });
    if (!interview) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    let claims = interview.candidate.resumeClaims;
    if (typeof body.resumeText === "string" && body.resumeText.trim()) {
      const text = body.resumeText.trim().slice(0, 24000);
      const skills = ["Python", "TypeScript", "JavaScript", "React", "SQL", "system design", "experimentation", "leadership", "machine learning", "product analytics"].filter(skill => text.toLowerCase().includes(skill.toLowerCase()));
      const projectClaims = text.split(/(?<=[.!?])\s+/).filter((s: string) => /\d|led|built|owned|launched|reduced|increased|improved|designed/i.test(s)).slice(0, 12);
      claims = { excerpt: text.slice(0, 1600), extractedSkills: skills, projectClaims };
      await prisma.candidate.update({ where: { id: interview.candidateId }, data: { resumeText: text, resumeClaims: claims, ...(typeof body.resumeStorageKey === "string" ? { resumeStorageKey: body.resumeStorageKey } : {}) } });
    }
    const oldBlueprint = interview.blueprint && typeof interview.blueprint === "object" ? interview.blueprint as Record<string, unknown> : {};
    const claimObject = claims as { projectClaims?: string[]; excerpt?: string } | null;
    const updateData: Record<string, unknown> = {};
    if (body.consent) updateData.consent = JSON.parse(JSON.stringify(body.consent));
    if (claims) updateData.blueprint = JSON.parse(JSON.stringify({
      ...oldBlueprint,
      resumeClaims: claims,
      personalizedProjectProbes: claimObject?.projectClaims || oldBlueprint.personalizedProjectProbes,
      sourceExcerpt: claimObject?.excerpt,
    }));
    const updated = await prisma.interview.update({ where: { id: interviewId }, data: updateData as never });
    return NextResponse.json({ id: updated.id, ready: true });
  } catch { return NextResponse.json({ error: "Could not save consent and resume context" }, { status: 503 }); }
}

async function resolveInterviewToken(token: string, req?: Request) {
  const fromToken = getInterviewIdFromAccessToken(token);
  if (fromToken) return fromToken;
  const headerToken = req?.headers.get("x-interview-access");
  if (headerToken && getInterviewIdFromAccessToken(headerToken) === token) {
    return token;
  }
  const user = await getAriUser();
  if (user) {
    const interview = await prisma.interview.findUnique({
      where: { id: token },
      include: { role: true },
    });
    if (interview && interview.role.ownerId === user.id) {
      return token;
    }
  }
  return null;
}
