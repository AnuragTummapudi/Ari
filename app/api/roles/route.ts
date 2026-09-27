import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAriUser } from "@/lib/auth";
export async function GET() {
  const user = await getAriUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try { const roles=await prisma.role.findMany({where:{ownerId:user.id},orderBy:{createdAt:"desc"},include:{_count:{select:{interviews:true}}}}); return NextResponse.json(roles.map((r:any)=>({id:r.id,title:r.title,team:`${r.department} · ${r.level}`,n:r._count.interviews,complete:0,status:"Active"}))); }
  catch { return NextResponse.json({ roles: [], unavailable: true }); }
}
export async function POST(req: Request) {
  const user = await getAriUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.title?.trim()) return NextResponse.json({ error: "Role title is required" }, { status: 400 });
    if (!body.description?.trim() || !Array.isArray(body.rubric) || body.rubric.length === 0 || !Array.isArray(body.blueprint?.coreQuestions) || body.blueprint.coreQuestions.length === 0) {
      return NextResponse.json({ error: "Role description, rubric, and shared questions are required" }, { status: 400 });
    }
    const role = await prisma.role.create({ data: { ownerId: user.id, title: body.title, department: body.department || "", level: body.level || "", description: body.description, requirements: body.requirements || [], rubric: body.rubric, blueprint: body.blueprint } });
    return NextResponse.json(role, { status: 201 });
  } catch { return NextResponse.json({ error: "Database unavailable. Set DATABASE_URL and run the migrations." }, { status: 503 }); }
}
