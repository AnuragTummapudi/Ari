import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function POST(req: Request) {
  if (!process.env.INTERNAL_API_SECRET || req.headers.get("x-internal-secret") !== process.env.INTERNAL_API_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const { interviewId, event, at, durationMs } = await req.json(); if (!interviewId || !["tab_hidden","camera_unavailable","face_absent","multiple_faces"].includes(event)) return NextResponse.json({ error: "Invalid event" }, { status: 400 }); const row=await prisma.interview.findUnique({where:{id:interviewId}});if(!row)return NextResponse.json({error:"Interview not found"},{status:404});const list=Array.isArray(row.integrityEvents)?row.integrityEvents:[];await prisma.interview.update({where:{id:interviewId},data:{integrityEvents:[...list,{event,at:at||new Date().toISOString(),durationMs:durationMs||0}]}});return NextResponse.json({ok:true});}catch{return NextResponse.json({error:"Could not save integrity event"},{status:503});}
}
