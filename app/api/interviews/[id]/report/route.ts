import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateCitations } from "@/lib/interview";
import { getAriUser } from "@/lib/auth";
import { verifyInterviewAccessToken } from "@/lib/interview-access";
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
    const generated = await makeReport(interview.role.rubric as string[], confirmedTurns.map((t) => ({ id: t.id, speaker: t.speaker, text: t.text, stage: t.stage }))).catch(() => ({ summary: "The interview is complete. Review the confirmed transcript and use the rubric to record findings. Assessment generation is currently unavailable for this session.", findings: (interview.role.rubric as string[]).map(skill => ({ skill, rating: null, supportingTurnIds: [], strengths: [], gaps: [], insufficientEvidence: true })), improvementPlan: ["Add specific examples with your individual contribution.", "Explain the evidence and trade-offs behind your decisions."] }));
    const valid = validateCitations(generated.findings, new Set(confirmedTurns.map((t) => t.id)));
    const report = await prisma.report.upsert({ where: { interviewId: id }, update: { summary: generated.summary, findings: valid, improvementPlan: generated.improvementPlan }, create: { interviewId: id, summary: generated.summary, findings: valid, improvementPlan: generated.improvementPlan } });
    await prisma.interview.update({ where: { id }, data: { status: "COMPLETED", stage: "complete" } });
    return NextResponse.json({ id: report.id, summary: report.summary, findings: valid, improvementPlan: report.improvementPlan });
  } catch { return NextResponse.json({ error: "Could not create the report. Confirm the interview and database are available." }, { status: 503 }); }
}
async function makeReport(rubric: string[], turns: {id:string;speaker:string;text:string;stage:string}[]) {
  const key=process.env.SARVAM_API_KEY;if(!key)throw new Error("SARVAM_API_KEY missing");
  const response=await fetch(`${process.env.SARVAM_LLM_BASE_URL||"https://api.sarvam.ai/v1"}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json","api-subscription-key":key},body:JSON.stringify({model:process.env.SARVAM_REPORT_MODEL||"sarvam-105b",temperature:0.1,max_tokens:1800,response_format:{type:"json_object"},messages:[{role:"system",content:"Evaluate only the confirmed transcript. Return JSON with summary, findings (skill, rating 1-5 or null, supportingTurnIds, strengths, gaps, insufficientEvidence), and improvementPlan. Cite only provided turn IDs. If evidence is absent, use null rating and insufficientEvidence true."},{role:"user",content:JSON.stringify({rubric,turns})}]})});if(!response.ok)throw new Error(`Sarvam ${response.status}`);const data=await response.json();const raw=data.choices?.[0]?.message?.content;const parsed=JSON.parse(raw);return {summary:String(parsed.summary||""),findings:(parsed.findings||[]) as Finding[],improvementPlan:Array.isArray(parsed.improvementPlan)?parsed.improvementPlan.map(String):[]};
}
