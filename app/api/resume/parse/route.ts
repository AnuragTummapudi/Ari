import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { deleteResumeObject, storeResume } from "@/lib/resume-storage";
import { getAriUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a resume file first." }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Resume files must be under 10 MB." }, { status: 413 });
    const saveToProfile = form.get("saveToProfile") === "true";
    const user = saveToProfile ? await getAriUser() : null;
    if (saveToProfile && !user) return NextResponse.json({ error: "Sign in to save resumes to your profile." }, { status: 401 });
    if (user && await prisma.userResume.count({ where: { userId: user.id } }) >= 3) {
      return NextResponse.json({ error: "Your profile can hold three resumes. Remove one before uploading another." }, { status: 409 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    let text = "";
    let source: "text" | "ocr" = "text";
    if (name.endsWith(".pdf")) {
      const parser = new PDFParse({ data: buffer });
      try { const result = await parser.getText(); text = result.text; } finally { await parser.destroy(); }
      if (text.replace(/\s/g, "").length < 80) {
        text = await ocrResume(file.name, file.type || "application/pdf", buffer);
        source = "ocr";
      }
    } else if (name.endsWith(".docx")) {
      text = (await mammoth.extractRawText({ buffer })).value;
    } else if (name.endsWith(".txt")) {
      text = buffer.toString("utf8");
    } else if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
      text = await ocrResume(file.name, file.type, buffer);
      source = "ocr";
    } else return NextResponse.json({ error: "Supported file types are PDF, DOCX, TXT, PNG, and JPG. Legacy DOC files are not supported." }, { status: 415 });
    text = text.replace(/\s+/g, " ").trim().slice(0, 24000);
    if (!text) return NextResponse.json({ error: "No readable text was found. Try a clearer PDF or image, or paste the resume text." }, { status: 422 });
    const storageKey = await storeResume(file.name, file.type, buffer);
    const skills = ["Python", "TypeScript", "JavaScript", "React", "SQL", "system design", "experimentation", "leadership", "machine learning", "product analytics", "Kubernetes", "AWS", "communication"];
    const extractedSkills = skills.filter(skill => text.toLowerCase().includes(skill.toLowerCase()));
    const claims = text.split(/(?<=[.!?])\s+/).filter(s => /\d|led|built|owned|launched|reduced|increased|improved|designed/i.test(s)).slice(0, 12);
    const structuredClaims = { extractedSkills, projectClaims: claims, excerpt: text.slice(0, 700) };
    let profileResume: { id: string; fileName: string; storageKey: string; text: string; claims: typeof structuredClaims; createdAt: string } | null = null;
    if (user) {
      try {
        const resumeId = crypto.randomUUID();
        const [saved] = await prisma.$transaction([
          prisma.userResume.create({ data: { id: resumeId, userId: user.id, fileName: file.name.slice(0, 180), storageKey, text, claims: structuredClaims } }),
          prisma.userProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, preferredResumeId: resumeId }, update: { preferredResumeId: resumeId } }),
        ]);
        profileResume = { id: saved.id, fileName: saved.fileName, storageKey: saved.storageKey, text: saved.text, claims: structuredClaims, createdAt: saved.createdAt.toISOString() };
      } catch (error) {
        await deleteResumeObject(storageKey).catch(() => {});
        throw error;
      }
    }
    return NextResponse.json({ text, storageKey, extraction: source, claims: structuredClaims, profileResume });
  } catch (error) {
    console.error("Resume processing failed", error instanceof Error ? error.message : "Unknown error");
    const message = error instanceof Error && /OCR|taking longer|could not read|file|support/i.test(error.message)
      ? error.message
      : "Resume could not be parsed or stored. Please try again.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

async function ocrResume(filename: string, contentType: string, buffer: Buffer) {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("Resume OCR is currently unavailable. Please upload a digital PDF, DOCX, or paste the text.");
  if (filename.toLowerCase().endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer });
    try {
      const info = await parser.getInfo();
      if (info.total < 1 || info.total > 10) throw new Error("Resume OCR supports PDF files up to 10 pages.");
    } finally { await parser.destroy(); }
  }
  const base = "https://api.sarvam.ai/doc-ai/v1";
  const headers = { "api-subscription-key": key };
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: contentType }), filename);
  form.append("language", process.env.SARVAM_DOCUMENT_LANGUAGE || "en-IN");
  form.append("output_format", "json");
  form.append("content_type", "printed");
  const create = await fetch(`${base}/job/digitise`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(45000) });
  if (!create.ok) throw new Error(`Resume OCR could not start (${create.status}).`);
  const { job_id: jobId } = await create.json() as { job_id?: string };
  if (!jobId) throw new Error("Resume OCR did not return a job id.");
  const deadline = Date.now() + 45000;
  let status = "pending";
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1200));
    const response = await fetch(`${base}/job/${encodeURIComponent(jobId)}/status`, { headers, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) throw new Error(`Resume OCR status check failed (${response.status}).`);
    const result = await response.json() as { status?: string };
    status = (result.status || "").toLowerCase();
    if (["completed", "partially_completed"].includes(status)) break;
    if (["failed", "rejected"].includes(status)) throw new Error("Could not read this resume. Try a clearer file or paste its text.");
  }
  if (!["completed", "partially_completed"].includes(status)) throw new Error("Resume OCR is taking longer than expected. Please retry in a moment.");
  const response = await fetch(`${base}/job/${encodeURIComponent(jobId)}/results?format=json`, { headers, signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!response.ok) throw new Error(`Resume OCR results could not be fetched (${response.status}).`);
  return collectOcrText(await response.json());
}

function collectOcrText(value: unknown): string {
  const found: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (["text", "markdown", "content", "md"].includes(key.toLowerCase()) && typeof child === "string") found.push(child);
      else visit(child);
    }
  };
  visit(value);
  return [...new Set(found)].join("\n").trim();
}
