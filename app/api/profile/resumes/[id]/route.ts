import { NextResponse } from "next/server";
import { getAriUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteResumeObject } from "@/lib/resume-storage";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAriUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  try {
    const resume = await prisma.userResume.findFirst({ where: { id, userId: user.id } });
    if (!resume) return NextResponse.json({ error: "Resume not found." }, { status: 404 });
    const nextResume = await prisma.userResume.findFirst({ where: { userId: user.id, id: { not: id } }, orderBy: { createdAt: "desc" }, select: { id: true } });
    await deleteResumeObject(resume.storageKey);
    await prisma.$transaction([
      prisma.userResume.delete({ where: { id } }),
      prisma.userProfile.updateMany({ where: { userId: user.id, preferredResumeId: id }, data: { preferredResumeId: nextResume?.id || null } }),
      prisma.candidate.updateMany({ where: { resumeStorageKey: resume.storageKey }, data: { resumeStorageKey: null } }),
    ]);
    return NextResponse.json({ preferredResumeId: nextResume?.id || null });
  } catch {
    return NextResponse.json({ error: "Resume could not be removed. Please try again." }, { status: 503 });
  }
}
