import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAriUser } from "@/lib/auth";
import { createInterviewAccessToken } from "@/lib/interview-access";

export const runtime = "nodejs";
export async function GET() {
  const user = await getAriUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try { const rows=await prisma.interview.findMany({where:{role:{ownerId:user.id}},orderBy:{createdAt:"desc"},include:{candidate:true,role:true,report:true}}); return NextResponse.json(rows.map((i:any)=>({id:i.id,name:i.candidate.name,email:i.candidate.email,role:i.role.title,date:i.createdAt.toISOString(),score:i.report?"Ready for review":i.status==="COMPLETED"?"Report pending":i.status.toLowerCase(),initials:i.candidate.name.split(/\s+/).map((x:string)=>x[0]).join("").slice(0,2).toUpperCase(),isPractice:i.isPractice,status:i.status}))); }
  catch { return NextResponse.json({ candidates: [], unavailable: true }); }
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const isPractice = body.practice === true;
    const user = await getAriUser();
    if (!isPractice && !user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    if (!body.email?.trim() && !isPractice) return NextResponse.json({ error: "Candidate email is required" }, { status: 400 });
    // Practice should not collect contact details. Give each private practice profile an opaque address
    // when the candidate chooses not to provide one, so it cannot overwrite another candidate profile.
    const candidateEmail = body.email?.trim() || `practice-${crypto.randomUUID()}@users.ari.local`;
    if (!body.roleTitle?.trim()) return NextResponse.json({ error: "Target role is required" }, { status: 400 });
    let role = await prisma.role.findFirst({ where: { title: body.roleTitle.trim(), ...(isPractice ? {} : { ownerId: user!.id }) } });
    if (!role && !isPractice) return NextResponse.json({ error: "Role not found in your workspace" }, { status: 404 });
    if (!role && isPractice) role = await prisma.role.create({ data: { title: body.roleTitle || "Interview practice", department: "Candidate practice", level: "Target role", description: "Role details supplied for a candidate practice interview.", requirements: ["Product thinking", "Technical execution", "Communication"], rubric: ["Product thinking", "Technical depth", "Ownership", "Communication"], blueprint: { coreQuestions: ["Tell me about a product decision you influenced with evidence."], timeBudgetMinutes: 30, followUpLimit: 2 } } });
    if (!role) return NextResponse.json({ error: "Target role could not be prepared" }, { status: 503 });
    const requestedProfileResume = typeof body.profileResumeId === "string" && body.profileResumeId.length > 0;
    const savedResume = requestedProfileResume && isPractice && user ? await prisma.userResume.findFirst({ where: { id: body.profileResumeId, userId: user.id } }) : null;
    if (requestedProfileResume && !savedResume) return NextResponse.json({ error: "Selected resume is not available in your profile." }, { status: 404 });
    const resumeText = savedResume?.text || (typeof body.resumeText === "string" ? body.resumeText : "");
    const resumeStorageKey = savedResume?.storageKey || (typeof body.resumeStorageKey === "string" ? body.resumeStorageKey : null);
    const savedClaims = savedResume?.claims as { excerpt: string; extractedSkills: string[]; projectClaims: string[] } | undefined;
    const claims = savedClaims || (resumeText ? { excerpt: resumeText.slice(0, 1600), extractedSkills: extractSkills(resumeText), projectClaims: resumeText.split(/(?<=[.!?])\s+/).filter((s: string) => /\d|led|built|owned|launched|reduced|increased|improved|designed/i.test(s)).slice(0, 12) } : undefined);
    const candidate = await prisma.candidate.upsert({ where: { email: candidateEmail }, update: { name: body.name || "Candidate", ...(resumeText ? { resumeText, resumeClaims: claims } : {}), ...(resumeStorageKey ? { resumeStorageKey } : {}) }, create: { name: body.name || "Candidate", email: candidateEmail, resumeText: resumeText || null, resumeClaims: claims, resumeStorageKey } });
    const blueprint = { ...(role.blueprint as object), resumeClaims: claims || candidate.resumeClaims, personalizedProjectProbes: claims?.projectClaims || [], requiredSkillCoverage: role.requirements, maxFollowUpsPerQuestion: 2, sourceExcerpt: claims?.excerpt || null };
    const interview = await prisma.interview.create({ data: { roleId: role.id, candidateId: candidate.id, isPractice, roomName: `ari-${crypto.randomUUID()}`, status: "READY", consent: body.consent || undefined, blueprint } });
    return NextResponse.json({ id: interview.id, room: interview.roomName, status: interview.status, accessToken: createInterviewAccessToken(interview.id) }, { status: 201 });
  } catch { return NextResponse.json({ error: "Database unavailable. Set DATABASE_URL and run the migrations." }, { status: 503 }); }
}
function extractSkills(text: string) { const terms = ["Python", "TypeScript", "React", "SQL", "system design", "experimentation", "leadership", "machine learning", "product analytics"]; return terms.filter(x => text.toLowerCase().includes(x.toLowerCase())); }
