import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isInternalRequest, toVectorLiteral } from "@/lib/rag";

export const runtime = "nodejs";

// Agent → API: nearest resume chunks for a query embedding (cosine distance, HNSW index).
export async function POST(req: Request) {
  if (!isInternalRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { room?: unknown; embedding?: unknown; k?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const vector = toVectorLiteral(body.embedding);
  if (typeof body.room !== "string" || !vector) return NextResponse.json({ error: "room and a 384-number embedding are required" }, { status: 400 });
  const k = Math.min(Math.max(Number(body.k) || 4, 1), 8);
  try {
    const results = await prisma.$queryRaw<{ content: string; position: number; score: number }[]>`
      SELECT c."content", c."position", 1 - (c."embedding" <=> ${vector}::vector) AS "score"
      FROM "ResumeChunk" c
      JOIN "Interview" i ON i."id" = c."interviewId"
      WHERE i."roomName" = ${body.room}
      ORDER BY c."embedding" <=> ${vector}::vector
      LIMIT ${k}`;
    return NextResponse.json({ results: results.map((r) => ({ content: r.content, position: r.position, score: Number(r.score) })) });
  } catch (error) {
    console.error("Resume search failed", error);
    return NextResponse.json({ error: "Resume search is unavailable" }, { status: 503 });
  }
}
