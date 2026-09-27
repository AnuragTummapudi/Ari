import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(req: Request) {
  if (!process.env.INTERNAL_API_SECRET || req.headers.get("x-internal-secret") !== process.env.INTERNAL_API_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const room=new URL(req.url).searchParams.get("room");if(!room)return NextResponse.json({error:"Room is required"},{status:400});const interview=await prisma.interview.findUnique({where:{roomName:room},include:{role:true,candidate:true}});if(!interview)return NextResponse.json({error:"Interview not found"},{status:404});return NextResponse.json({interviewId:interview.id,role:interview.role.title,requirements:interview.role.requirements,rubric:interview.role.rubric,blueprint:interview.blueprint,resumeClaims:interview.candidate.resumeClaims});}catch{return NextResponse.json({error:"Context lookup failed"},{status:503});}
}
