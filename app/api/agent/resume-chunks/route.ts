import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isInternalRequest, toVectorLiteral } from "@/lib/rag";

export const runtime = "nodejs";

// Agent → API: replace the interview's indexed resume chunks with freshly embedded ones.
export async function POST(req: Request) {
  if (!isInternalRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { room?: unknown; chunks?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (typeof body.room !== "string" || !Array.isArray(body.chunks) || body.chunks.length === 0 || body.chunks.length > 200) {
    return NextResponse.json({ error: "room and 1-200 chunks are required" }, { status: 400 });
  }
  const chunks: { content: string; vector: string }[] = [];
  for (const chunk of body.chunks as { content?: unknown; embedding?: unknown }[]) {
    const vector = toVectorLiteral(chunk?.embedding);
    if (typeof chunk?.content !== "string" || !chunk.content.trim() || chunk.content.length > 2000 || !vector) {
      return NextResponse.json({ error: "Each chunk needs content (max 2000 chars) and a 384-number embedding" }, { status: 422 });
    }
    chunks.push({ content: chunk.content.trim(), vector });
  }
  try {
    const interview = await prisma.interview.findUnique({ where: { roomName: body.room }, select: { id: true } });
    if (!interview) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    await prisma.$transaction([
      prisma.resumeChunk.deleteMany({ where: { interviewId: interview.id } }),
      ...chunks.map((chunk, position) => prisma.$executeRaw`
        INSERT INTO "ResumeChunk" ("id", "interviewId", "position", "content", "embedding")
        VALUES (${crypto.randomUUID()}, ${interview.id}, ${position}, ${chunk.content}, ${chunk.vector}::vector)`),
    ]);
    return NextResponse.json({ indexed: chunks.length }, { status: 201 });
  } catch (error) {
    console.error("Resume chunk indexing failed", error);
    return NextResponse.json({ error: "Could not index resume chunks" }, { status: 503 });
  }
}
