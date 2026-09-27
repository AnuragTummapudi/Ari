import { NextResponse } from "next/server";
import { AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";
import { verifyInterviewAccessToken } from "@/lib/interview-access";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { interviewId?: string; accessToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid interview request" }, { status: 400 });
  }

  if (!body.interviewId || !verifyInterviewAccessToken(body.accessToken, body.interviewId)) {
    return NextResponse.json({ error: "Interview access expired" }, { status: 401 });
  }

  const interview = await prisma.interview.findUnique({
    where: { id: body.interviewId },
    select: { roomName: true },
  });
  if (!interview?.roomName) return NextResponse.json({ error: "Interview room not found" }, { status: 404 });

  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: "Live interview service is not configured" }, { status: 503 });
  }

  try {
    const host = LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    const dispatchClient = new AgentDispatchClient(host, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const roomClient = new RoomServiceClient(host, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const dispatches = await dispatchClient.listDispatch(interview.roomName);
    await Promise.all(dispatches.map(dispatch => dispatchClient.deleteDispatch(dispatch.id, interview.roomName!)));
    await roomClient.deleteRoom(interview.roomName);
    return NextResponse.json({ ended: true });
  } catch (error) {
    console.error("LiveKit room shutdown failed", error);
    return NextResponse.json({ error: "The interview room could not be closed cleanly" }, { status: 503 });
  }
}
