import { NextResponse } from "next/server";
import { getAriUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const user = await getAriUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const [profile, resumes] = await Promise.all([
      prisma.userProfile.findUnique({ where: { userId: user.id } }),
      prisma.userResume.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    ]);
    return NextResponse.json({
      account: { name: user.name || "", email: user.email || "" },
      targetRole: profile?.targetRole || "",
      preferredResumeId: profile?.preferredResumeId || resumes[0]?.id || null,
      resumes: resumes.map((resume: { id: string; fileName: string; storageKey: string; text: string; claims: unknown; createdAt: Date }) => ({ id: resume.id, fileName: resume.fileName, storageKey: resume.storageKey, text: resume.text, claims: resume.claims, createdAt: resume.createdAt.toISOString() })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Profile is unavailable. Check the database migration." }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const user = await getAriUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const body = await req.json() as { targetRole?: unknown; preferredResumeId?: unknown };
    const targetRole = typeof body.targetRole === "string" ? body.targetRole.trim() : undefined;
    const preferredResumeId = typeof body.preferredResumeId === "string" ? body.preferredResumeId : undefined;
    if (targetRole !== undefined && targetRole.length > 160) return NextResponse.json({ error: "Target role is too long." }, { status: 400 });
    if (preferredResumeId !== undefined && !(await prisma.userResume.findFirst({ where: { id: preferredResumeId, userId: user.id }, select: { id: true } }))) {
      return NextResponse.json({ error: "That resume is not in your profile." }, { status: 404 });
    }
    const profile = await prisma.userProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, targetRole: targetRole ?? null, preferredResumeId: preferredResumeId ?? null },
      update: { ...(targetRole !== undefined ? { targetRole } : {}), ...(preferredResumeId !== undefined ? { preferredResumeId } : {}) },
    });
    return NextResponse.json({ targetRole: profile.targetRole || "", preferredResumeId: profile.preferredResumeId });
  } catch {
    return NextResponse.json({ error: "Profile changes could not be saved." }, { status: 503 });
  }
}
