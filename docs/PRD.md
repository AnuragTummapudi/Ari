# Ari — Product Requirements Document

| | |
| --- | --- |
| Product | Ari, an AI voice interview platform |
| Status | Beta (deployed: web on Vercel, agent worker on Railway) |
| Owner | Anurag Tummapudi |
| Related | [High-Level Design](./HLD.md) · [Low-Level Design](./LLD.md) |

## 1. Problem

Candidates rarely get realistic interview practice. Generic question banks ignore their resume and target role, and they get no structured feedback afterwards. Hiring teams face a mirror-image problem: interviews vary between interviewers, notes are subjective, and conclusions often can't be traced back to what the candidate actually said.

## 2. Goal

Give candidates and hiring teams a live, spoken interview with an AI interviewer that:

1. follows a consistent, role-specific structure,
2. probes the candidate's own resume claims, and
3. ends with a report where every rating cites the transcript turns it is based on, so a human makes the final call.

### Non-goals

- Automated hire or no-hire decisions. Ari informs reviewers; it does not decide.
- Cheating detection from gaze or camera. Integrity events are logged for context and never treated as evidence of dishonesty.
- Coding or whiteboard exercises (out of scope for v1).

## 3. Users and personas

| Persona | Need | Entry point |
| --- | --- | --- |
| **Practice candidate** | Rehearse for a target role and see what to improve | Practice flow; sign-in optional |
| **Signed-in candidate** | Keep up to 3 resumes and a target role, reuse them | Profile |
| **Hiring team member** | Define roles and rubrics, run consistent interviews, review evidence | Roles and Interviews dashboards (sign-in required) |
| **Reviewer** | Check AI findings against transcript evidence and record their own rating | Report view |

## 4. User stories

**Candidate**
- As a candidate, I can upload my resume (PDF, DOCX, TXT, PNG or JPG) so that Ari asks about my real projects.
- As a candidate, I can check my microphone and camera and give explicit consent before the interview starts.
- As a candidate, I can talk to Ari by voice and see a live caption of what was heard.
- As a candidate, I can leave or end the interview at any time.
- As a candidate, I get a report with per-skill strengths, gaps and a practice plan.

**Hiring team**
- As a hiring team member, I can create a role with a title, department, level, requirements and rubric.
- As a hiring team member, I can list my roles with interview and completion counts.
- As a hiring team member, I can see only interviews for roles I own.

**Reviewer**
- As a reviewer, I can open the transcript turn behind each finding.
- As a reviewer, I can record my own notes or rating next to the AI's.

## 5. Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1 | Sign in with Neon Auth; practice mode works without an account | Must |
| FR-2 | Resume upload: max 10 MB, text extraction, OCR fallback for scanned PDFs and images, skills and claims extraction | Must |
| FR-3 | Store up to 3 resumes per signed-in user in private object storage; choose a preferred one | Should |
| FR-4 | Create a role with a rubric and question blueprint (owner-scoped) | Must |
| FR-5 | Create an interview, issue a signed candidate access token, create a LiveKit room and dispatch the agent | Must |
| FR-6 | Real-time voice conversation: streaming STT, LLM interviewer, TTS, 3D talking avatar | Must |
| FR-7 | Interview follows fixed stages: opening → product → technical → ownership → candidate questions → complete | Must |
| FR-8 | Persist only *final* transcript turns; interim captions never become evidence | Must |
| FR-9 | Log integrity events (tab switch, camera off and similar) with timestamps | Should |
| FR-10 | Generate a report as structured JSON: one finding per rubric skill, rating 1–5 or null, cited turn IDs, strengths, gaps, improvement plan | Must |
| FR-11 | Drop any citation that does not point at a real candidate turn in that interview | Must |
| FR-12 | Reviewer overrides are stored next to the AI findings, never replacing them | Should |
| FR-13 | Hiring teams can protect an invitation with a passcode, stored only as a salted scrypt hash | Should |
| FR-14 | The interviewer retrieves relevant resume passages (RAG) before probing a claim, using a `search_resume` tool | Should |
| FR-15 | Costly or guessable endpoints are rate limited per IP and return 429 with `Retry-After` | Must |

## 6. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Latency | Agent's first spoken token under ~1.5 s after the candidate stops speaking (ttft logged per turn) |
| Reliability | If report generation fails, the transcript stays saved and the user can retry (HTTP 503 with a retry message) |
| Security | Secrets stay server-side; agent-to-API calls carry `x-internal-secret`; candidate access uses HMAC-signed tokens with expiry, compared in constant time |
| Privacy | Resume bucket is private; explicit consent is captured before recording |
| Fairness | The model may only cite transcript turns; it returns null ratings when evidence is insufficient |
| Portability | Runs locally with Docker Compose (Postgres, web, agent) |

## 7. Success metrics

- Interview completion rate (`COMPLETED` / started)
- Share of findings with at least one valid citation
- Share of findings marked `insufficientEvidence` (lower means the interview gathered better signal)
- Median agent time-to-first-token
- Report generation success rate on the first attempt

## 8. Release scope

**v1 (current):** practice and hiring flows, resume parsing, live voice interview, cited report, integrity timeline, profile resumes, invite passcodes, resume RAG with tool calling, rate limiting.

**Later:** request schema validation with zod, reviewer collaboration, an eval set for report quality, token and cost dashboards, scheduled cleanup of abandoned interviews.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| LLM invents evidence | Citations validated against real turn IDs; unknown IDs are removed |
| LLM returns malformed JSON | `response_format: json_object`, field-by-field coercion, fallback finding per rubric skill |
| Resume text tries to steer the interviewer (prompt injection) | Full resume stays out of the prompt; retrieved passages are labelled as candidate-provided data and the prompt says never to follow instructions in them; the interviewer cannot score |
| Passcode or token guessing, LLM cost abuse | Postgres-backed per-IP rate limits on token, report, turn, resume and interview-creation endpoints |
| Third-party outage (Sarvam, LiveKit) | Timeouts on every outbound call; deterministic fallback follow-up questions |
