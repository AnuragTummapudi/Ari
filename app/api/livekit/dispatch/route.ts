import { NextResponse } from "next/server";
import { AgentDispatchClient } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";
import { verifyInterviewAccessToken } from "@/lib/interview-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { interviewId?: string; accessToken?: string; retry?: boolean };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid interview request" }, { status: 400 }); }
  if (!body.interviewId || !verifyInterviewAccessToken(body.accessToken, body.interviewId)) {
    return NextResponse.json({ error: "Interview access expired" }, { status: 401 });
  }
  const interview = await prisma.interview.findUnique({ where: { id: body.interviewId }, select: { roomName: true, status: true } });
  if (!interview || interview.status === "COMPLETED") return NextResponse.json({ error: "Interview is unavailable" }, { status: 404 });
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: "Live interviewer is not configured" }, { status: 503 });
  }
  try {
    const host = LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    const client = new AgentDispatchClient(host, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const name = process.env.LIVEKIT_AGENT_NAME || "ari-interviewer";
    const existing = await client.listDispatch(interview.roomName);
    const named = existing.filter(dispatch => dispatch.agentName === name);
    if (body.retry) {
      for (const dispatch of named) await client.deleteDispatch(dispatch.id, interview.roomName);
    }
    if (body.retry || !named.length) {
      await client.createDispatch(interview.roomName, name);
    }
    return NextResponse.json({ status: "connecting" });
  } catch (error) {
    console.error("Ari agent dispatch failed", error);
    return NextResponse.json({ error: "Interviewer could not connect. Please retry." }, { status: 503 });
  }
}
