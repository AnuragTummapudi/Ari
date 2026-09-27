import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";
import { verifyInterviewAccessToken } from "@/lib/interview-access";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { interviewId?: string; accessToken?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "A valid interview invitation is required" }, { status: 400 }); }
  if (!body.interviewId || typeof body.interviewId !== "string") return NextResponse.json({ error: "A valid interview invitation is required" }, { status: 400 });
  let interview;
  try { interview = await prisma.interview.findUnique({ where: { id: body.interviewId }, select: { id: true, roomName: true, status: true, candidateId: true } }); }
  catch { return NextResponse.json({ error: "Interview service is unavailable" }, { status: 503 }); }
  if (!interview || !interview.roomName) return NextResponse.json({ error: "Interview invitation or room not found" }, { status: 404 });
  if (!verifyInterviewAccessToken(body.accessToken, body.interviewId)) return NextResponse.json({ error: "Interview access expired" }, { status: 401 });
  if (interview.status === "COMPLETED") return NextResponse.json({ error: "This interview is already complete" }, { status: 410 });
  const { LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret, LIVEKIT_URL: url } = process.env;
  if (!apiKey || !apiSecret || !url) return NextResponse.json({ error: "Live interview service is not configured" }, { status: 503 });
  const at = new AccessToken(apiKey, apiSecret, { identity: `candidate-${interview.candidateId}`, ttl: "1h" });
  at.addGrant({ roomJoin: true, room: interview.roomName, canPublish: true, canSubscribe: true });
  return NextResponse.json({ token: await at.toJwt(), url });
}
