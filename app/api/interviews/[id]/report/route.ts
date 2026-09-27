import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateCitations } from "@/lib/interview";
import { getAriUser } from "@/lib/auth";
import { verifyInterviewAccessToken } from "@/lib/interview-access";

export const runtime = "nodejs";
export const maxDuration = 60; // Sarvam LLM report generation can take up to ~50s

type Finding = { skill: string; rating: number | null; supportingTurnIds: string[]; strengths: string[]; gaps: string[]; insufficientEvidence: boolean };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { const interview=await prisma.interview.findUnique({where:{id},include:{candidate:true,role:true,report:true,turns:{where:{final:true},orderBy:{startedAt:"asc"}}}});if(!interview)return NextResponse.json({error:"Interview not found"},{status:404});if(interview.isPractice){if(!verifyInterviewAccessToken(_req.headers.get("x-interview-access"),id))return NextResponse.json({error:"Interview access expired"},{status:401});}else{const user=await getAriUser();if(!user)return NextResponse.json({error:"Sign in required"},{status:401});if(interview.role.ownerId!==user.id)return NextResponse.json({error:"Interview not found"},{status:404});}return NextResponse.json({id:interview.report?.id||null,interviewId:id,candidate:interview.candidate.name,role:interview.role.title,summary:interview.report?.summary||null,findings:interview.report?.findings||[],improvementPlan:interview.report?.improvementPlan||[],turns:interview.turns.map((t:any)=>({id:t.id,speaker:t.speaker,text:t.text,stage:t.stage,skillTags:t.skillTags,startedAt:t.startedAt})),integrityEvents:interview.integrityEvents,reviewerOverrides:interview.report?.reviewerOverrides||[]});}catch{return NextResponse.json({error:"Database unavailable"},{status:503});}
}
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id }=await params;
  const user=await getAriUser();if(!user)return NextResponse.json({error:"Sign in required"},{status:401});
  try { const body=await req.json();if(!Array.isArray(body.reviewerOverrides))return NextResponse.json({error:"reviewerOverrides must be a list"},{status:400});const interview=await prisma.interview.findUnique({where:{id},include:{role:true,report:true}});if(!interview?.report||interview.role.ownerId!==user.id)return NextResponse.json({error:"Generate a report before reviewing it"},{status:404});const cleaned=body.reviewerOverrides.slice(-50).map((entry:unknown)=>{const item=entry as Record<string,unknown>;const rating=item.rating===null?null:Number(item.rating);return {note:typeof item.note==="string"?item.note.slice(0,2000):undefined,status:item.status==="reviewed"?"reviewed":undefined,skill:typeof item.skill==="string"?item.skill.slice(0,100):undefined,rating:Number.isInteger(rating)&&rating!>=1&&rating!<=5?rating:item.rating===null?null:undefined,rationale:typeof item.rationale==="string"?item.rationale.slice(0,1000):undefined,at:new Date().toISOString()}});const report=await prisma.report.update({where:{interviewId:id},data:{reviewerOverrides:cleaned}});return NextResponse.json({reviewerOverrides:report.reviewerOverrides});}catch{return NextResponse.json({error:"Could not save recruiter review"},{status:503});}
}
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const interview = await prisma.interview.findUnique({ where: { id }, include: { role: true, candidate: true, turns: { where: { final: true }, orderBy: { startedAt: "asc" } }, report: true } });
    if (!interview) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    if (interview.isPractice && !verifyInterviewAccessToken(_req.headers.get("x-interview-access"), id)) return NextResponse.json({ error: "Interview access expired" }, { status: 401 });
    if (!interview.isPractice) {
      const user = await getAriUser();
      if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
      if (interview.role.ownerId !== user.id) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }
    const confirmedTurns = interview.turns as { id: string; speaker: string; text: string; stage: string }[];
    const rubric = Array.isArray(interview.role.rubric) ? interview.role.rubric.map(String) : [];
    const generated = await makeReport(rubric, confirmedTurns.map((t) => ({ id: t.id, speaker: t.speaker, text: t.text, stage: t.stage })));
    const candidateTurnIds = new Set(confirmedTurns.filter((turn) => turn.speaker === "CANDIDATE").map((turn) => turn.id));
    const valid = validateCitations(generated.findings, candidateTurnIds);
    const report = await prisma.report.upsert({ where: { interviewId: id }, update: { summary: generated.summary, findings: valid, improvementPlan: generated.improvementPlan }, create: { interviewId: id, summary: generated.summary, findings: valid, improvementPlan: generated.improvementPlan } });
    await prisma.interview.update({ where: { id }, data: { status: "COMPLETED", stage: "complete" } });
    return NextResponse.json({ id: report.id, interviewId: id, candidate: interview.candidate.name, role: interview.role.title, summary: report.summary, findings: valid, improvementPlan: report.improvementPlan, turns: confirmedTurns, integrityEvents: interview.integrityEvents, reviewerOverrides: report.reviewerOverrides });
  } catch (error) {
    console.error("Interview report generation failed", error);
    return NextResponse.json({ error: "AI report generation failed. Your confirmed transcript is saved; try ending the interview again to retry." }, { status: 503 });
  }
}
async function makeReport(rubric: string[], turns: {id:string;speaker:string;text:string;stage:string}[]) {
  const key=process.env.SARVAM_API_KEY;
  if(!key)throw new Error("SARVAM_API_KEY missing");
  const response=await fetch(`${process.env.SARVAM_LLM_BASE_URL||"https://api.sarvam.ai/v1"}/chat/completions`,{
    method:"POST",
    headers:{"Content-Type":"application/json","api-subscription-key":key},
    signal:AbortSignal.timeout(45_000),
    body:JSON.stringify({
      model:process.env.SARVAM_REPORT_MODEL||"sarvam-105b",
      temperature:0.1,
      max_tokens:3500,
      reasoning_effort:null,
      response_format:{type:"json_object"},
      messages:[
        {role:"system",content:"Write a clear, evidence-based interview report using only the confirmed transcript. Return JSON with summary, findings, and improvementPlan. Include exactly one finding for every rubric skill, preserving each skill name. Each finding has skill, rating (integer 1-5 or null), supportingTurnIds, strengths, gaps, and insufficientEvidence (boolean). Cite only supplied turn IDs. Candidate turns are the evidence for candidate skills; interviewer turns provide context only. If a skill has no evidence, use a null rating, empty supportingTurnIds, explain insufficient evidence, and set insufficientEvidence true. Never infer facts absent from the transcript. improvementPlan is an array of concrete next steps."},
        {role:"user",content:JSON.stringify({rubric,turns})},
      ],
    }),
  });
  if(!response.ok)throw new Error(`Sarvam ${response.status}`);
  const data=await response.json();
  const raw=data.choices?.[0]?.message?.content;
  if(typeof raw!=="string"||!raw.trim())throw new Error("Sarvam returned an empty report");
  const parsed=JSON.parse(raw);
  if(typeof parsed.summary!=="string"||!parsed.summary.trim()||!Array.isArray(parsed.findings)||!Array.isArray(parsed.improvementPlan))throw new Error("Sarvam returned an incomplete report");

  const modelFindings=new Map<string,Finding>();
  for(const item of parsed.findings){
    if(!item||typeof item.skill!=="string"||!item.skill.trim())continue;
    const rating=Number.isInteger(item.rating)&&item.rating>=1&&item.rating<=5?item.rating:null;
    modelFindings.set(item.skill.trim(),{
      skill:item.skill.trim(),
      rating,
      supportingTurnIds:Array.isArray(item.supportingTurnIds)?item.supportingTurnIds.filter((id:unknown):id is string=>typeof id==="string"):[],
      strengths:Array.isArray(item.strengths)?item.strengths.filter((text:unknown):text is string=>typeof text==="string"):[],
      gaps:Array.isArray(item.gaps)?item.gaps.filter((text:unknown):text is string=>typeof text==="string"):[],
      insufficientEvidence:item.insufficientEvidence===true||rating===null,
    });
  }
  const findings=rubric.map(skill=>modelFindings.get(skill)||({skill,rating:null,supportingTurnIds:[],strengths:[],gaps:["The AI did not return a finding for this rubric dimension; there is not enough evidence to score it."],insufficientEvidence:true}));
  return {summary:parsed.summary.trim(),findings,improvementPlan:parsed.improvementPlan.filter((step:unknown):step is string=>typeof step==="string"&&step.trim().length>0).map((step:string)=>step.trim())};
}
