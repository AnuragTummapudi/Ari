import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyInterviewAccessToken } from "@/lib/interview-access";

export const runtime = "nodejs";
const allowed = ["tab_hidden", "camera_unavailable", "face_absent", "multiple_faces"];
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id }=await params;
  if(!verifyInterviewAccessToken(req.headers.get("x-interview-access"),id))return NextResponse.json({error:"Interview access expired"},{status:401});
  try { const body=await req.json();if(!allowed.includes(body.event))return NextResponse.json({error:"Unsupported event"},{status:400});const interview=await prisma.interview.findUnique({where:{id}});if(!interview)return NextResponse.json({error:"Interview not found"},{status:404});const previous=Array.isArray(interview.integrityEvents)?interview.integrityEvents:[];const entry={event:body.event,at:body.at||new Date().toISOString(),durationMs:Math.max(0,Number(body.durationMs)||0)};await prisma.interview.update({where:{id},data:{integrityEvents:[...previous,entry]}});return NextResponse.json({ok:true},{status:201});}catch{return NextResponse.json({error:"Could not save event"},{status:503});}
}
