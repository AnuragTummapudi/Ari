# Ari — Low-Level Design

Related: [PRD](./PRD.md) · [High-Level Design](./HLD.md)

## 1. Source layout

```
app/
  page.tsx                     → renders <AriWorkspace/>
  auth/sign-in/page.tsx        → Neon Auth sign-in
  api/                         → REST route handlers (section 3)
components/
  ari-workspace.tsx            → app shell, view switching, all dashboards and forms
  ari-voice-router.tsx         → LiveKit room, mic/cam, captions, agent state
  ari-avatar.tsx               → TalkingHead 3D avatar + HeadAudio lip-sync
  auth-account.tsx / auth-client.ts
lib/
  prisma.ts                    → PrismaClient singleton
  auth.ts                      → Neon Auth + getAriUser()
  interview.ts                 → stage machine, fallback questions, citation validation
  interview-access.ts          → HMAC candidate access tokens
  resume-storage.ts            → S3 put/delete for resume files
  speaking.ts                  → SpeakingGate (RMS voice-activity hysteresis)
agent/
  worker.py                    → LiveKit agent entrypoint, AriInterviewer
  sarvam_realtime_stt.py       → streaming STT plugin over WebSocket
prisma/schema.prisma + migrations/
tests/                         → vitest unit tests
```

## 2. Database schema

### 2.1 Tables

| Table | Key columns | Notes |
| --- | --- | --- |
| `Role` | `id` PK (cuid), `title`, `department`, `level`, `description`, `requirements` JSONB, `rubric` JSONB, `blueprint` JSONB, `ownerId` | `ownerId` is null for shared practice roles. Index `(ownerId)` |
| `Candidate` | `id` PK, `name`, `email` UNIQUE, `resumeText`, `resumeClaims` JSONB, `resumeStorageKey` | |
| `Interview` | `id` PK, `roleId` FK→Role, `candidateId` FK→Candidate, `status` enum, `stage`, `coverage`, `blueprint`, `consent`, `integrityEvents` JSONB, `roomName` UNIQUE, `isPractice` | Indexes `(roleId, status)` and `(candidateId)` |
| `Turn` | `id` PK, `interviewId` FK→Interview **CASCADE**, `speaker` enum(ARI, CANDIDATE), `text`, `stage`, `skillTags`, `startedAt`, `endedAt`, `final` | Index `(interviewId, startedAt)` |
| `Report` | `id` PK, `interviewId` FK UNIQUE **CASCADE** (1:1), `findings`, `summary`, `improvementPlan`, `reviewerOverrides` | |
| `UserProfile` | `userId` PK, `targetRole`, `preferredResumeId` | |
| `ResumeChunk` | `id` PK, `interviewId` FK→Interview **CASCADE**, `position`, `content`, `embedding vector(384)` | Index `(interviewId)`; HNSW index on `embedding` with `vector_cosine_ops` |
| `RateLimit` | `key` PK (`bucket:ip`), `count`, `resetAt` | One row per client and bucket |
| `UserResume` | `id` PK, `userId`, `fileName`, `storageKey` UNIQUE, `text`, `claims` | Index `(userId, createdAt)` |

`Interview.passcodeHash` (nullable) holds `scrypt$<salt>$<hash>` for protected invitations.

`InterviewStatus`: `INVITED → READY → IN_PROGRESS → COMPLETED | INCOMPLETE`.

### 2.2 Design decisions

- **Normalized core, JSONB at the edges.** Entities with identity and relations (Role, Candidate, Interview, Turn, Report) are separate tables joined by foreign keys. Rubric, blueprint, findings and integrity events change shape per role or model version, so they are stored as JSONB and not as extra tables.
- **Cascade deletes** keep Turn and Report from being orphaned when an interview is removed.
- **Unique `roomName`** gives the agent a lookup key: room → interview.

### 2.3 Representative queries (Prisma → SQL)

```ts
// Roles with interview counts (LEFT JOIN + COUNT … GROUP BY)
prisma.role.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" },
  include: { _count: { select: { interviews: true } } } });

// Interviews visible to a hiring user (JOIN Role, filter on Role.ownerId)
prisma.interview.findMany({ where: { role: { ownerId } }, orderBy: { createdAt: "desc" },
  include: { role: true, candidate: true } });

// Report input (JOIN Role, Candidate, Turn filtered and ordered)
prisma.interview.findUnique({ where: { id }, include: { role: true, candidate: true,
  turns: { where: { final: true }, orderBy: { startedAt: "asc" } }, report: true } });
```

Writes that must succeed or fail together use `prisma.$transaction([...])`. Examples: saving a candidate answer plus Ari's reply plus the stage update, saving a resume and its profile pointer, and deleting a resume and re-pointing the preferred resume.

## 3. REST API

All handlers use the `nodejs` runtime and return JSON `{ error: string }` on failure.

| Method | Path | Auth | Purpose | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/roles` | session | List owner's roles with counts | 200 | 401 |
| POST | `/api/roles` | session | Create a role | 201 | 400, 401 |
| GET | `/api/interviews` | session | List interviews for owned roles | 200 | 401 |
| POST | `/api/interviews` | session or practice | Create interview + access token | 201 | 400, 401, 404, 503 |
| GET | `/api/interviews/:id` | access token / owner | Interview with turns | 200 | 401, 404 |
| PATCH | `/api/interviews/:id` | access token / owner | Status, consent, reviewer overrides | 200 | 400, 401, 404, 410 |
| POST | `/api/interviews/:id/turns` | access token | Text fallback turn + next question | 201 | 400, 401, 404 |
| POST | `/api/interviews/:id/integrity` | access token | Append integrity event | 200 | 400, 401, 404 |
| GET | `/api/interviews/:id/report` | access token / owner | Generate or fetch report | 200 | 401, 404, 422, 503 |
| POST | `/api/livekit/token` | access token | LiveKit participant JWT | 200 | 400, 401, 404 |
| POST | `/api/livekit/dispatch` | access token | Dispatch agent to room | 200 | 401, 404, 503 |
| POST | `/api/livekit/end` | access token | Delete room, finalize status | 200 | 401, 404 |
| GET | `/api/agent/context?room=` | internal secret | Context for agent prompt | 200 | 400, 401, 404 |
| POST | `/api/agent/transcript` | internal secret | Persist final turn | 201 | 400, 401, 404 |
| POST | `/api/agent/resume-chunks` | internal secret | Replace the interview's embedded resume chunks | 201 | 400, 401, 404, 422, 503 |
| POST | `/api/agent/resume-search` | internal secret | Top-k resume chunks by cosine similarity | 200 | 400, 401, 503 |
| POST | `/api/integrity` | internal secret | Agent-reported integrity event | 200 | 401, 404 |
| POST | `/api/resume/parse` | optional session | Upload + extract resume (multipart) | 200 | 400, 401, 409, 413, 415, 422, 503 |
| GET / PATCH | `/api/profile` | session | Profile + resumes | 200 | 401 |
| DELETE | `/api/profile/resumes/:id` | session | Remove resume + storage object | 200 | 401, 404 |
| * | `/api/auth/[...path]` | — | Neon Auth handler | — | — |

## 4. Module design

### 4.1 Interview stage machine — `lib/interview.ts`

```
opening ──(any)──▶ product ──(≥3 answers)──▶ technical ──(≥3)──▶ ownership ──(≥3)──▶ candidate_questions ──(≥1)──▶ complete
```

- `nextStage(stage, answerCount)` is a pure function, unit tested.
- `questionForStage(stage, coreQuestions, projectClaims)` picks the blueprint question. The ownership stage quotes the first resume claim back to the candidate.
- `fallbackFollowUp(text, stage)` is a deterministic probe used when the LLM is unavailable: it asks for a concrete example if the answer is short, and asks about personal ownership if the answer says "we" or "team".
- `validateCitations(findings, candidateTurnIds)` removes any `supportingTurnId` not in the set and marks the finding `insufficientEvidence` if no citation is left.

### 4.2 Candidate access token — `lib/interview-access.ts`

```
token   = base64url(JSON{sub: interviewId, exp}) + "." + base64url(HMAC_SHA256(secret, payload))
verify  : length ≤ 2048 → exactly 2 parts → recompute HMAC → timingSafeEqual → exp > now → sub === interviewId
```

TTL is 14 days. The secret is `INTERVIEW_TOKEN_SECRET`, falling back to `INTERNAL_API_SECRET`, and must be at least 32 characters.

### 4.3 Report generation — `GET /api/interviews/:id/report`

1. Load the interview with role, candidate and final turns. Return 404 if missing, or 422 if there are no candidate turns.
2. Call the Sarvam chat completion: `temperature 0.1`, `response_format: {type: "json_object"}`, a 45 s timeout, and a system prompt that requires one finding per rubric skill and allows citing only supplied turn IDs.
3. Parse and coerce: rating must be an integer from 1 to 5, otherwise null; arrays are filtered to strings; any missing rubric skill gets an "insufficient evidence" finding.
4. `validateCitations` against the candidate turn IDs.
5. Upsert the Report, set the interview to `COMPLETED`, return the report with turns and integrity events.
6. On any failure return 503 with a retry message. The transcript is already saved.

### 4.4 Resume parsing — `POST /api/resume/parse`

`multipart/form-data` → size check (10 MB, 413) → resume cap (3, 409) → extract by extension: PDF (`pdf-parse`, with LLM OCR fallback if fewer than 80 characters), DOCX (`mammoth`), TXT, or images (OCR); anything else returns 415 → normalize whitespace and cap at 24k characters → empty text returns 422 → store in S3 → keyword skill extraction + claim sentences (verbs such as led, built or reduced, or numbers) → for signed-in users, `$transaction` creates the UserResume and updates the UserProfile, deleting the S3 object if that fails.

### 4.4a Rate limiting — `lib/rate-limit.ts`

```sql
INSERT INTO "RateLimit" (key, count, resetAt) VALUES ($key, 1, now() + $window)
ON CONFLICT (key) DO UPDATE SET
  count   = CASE WHEN resetAt <= now() THEN 1 ELSE count + 1 END,
  resetAt = CASE WHEN resetAt <= now() THEN now() + $window ELSE resetAt END
RETURNING count, resetAt;
```

| Bucket | Endpoint | Limit |
| --- | --- | --- |
| `livekit-token` | POST /api/livekit/token (passcode check) | 10 / 10 min |
| `report` | POST /api/interviews/:id/report (LLM) | 6 / 10 min |
| `resume-parse` | POST /api/resume/parse (OCR) | 10 / 10 min |
| `turns` | POST /api/interviews/:id/turns (LLM) | 40 / min |
| `interview-create` | POST /api/interviews | 20 / hour |

### 4.4b Invite passcode — `lib/passcode.ts`

`hashPasscode`: 16-byte random salt → `scrypt(passcode, salt, 64)` → `scrypt$salt$hash`. `verifyPasscode` recomputes with the stored salt and compares with `timingSafeEqual`. Set on `POST /api/interviews` (`passcode`, 4–64 chars), checked on `POST /api/livekit/token`; `GET /api/interviews/:token` exposes only `passcodeRequired`.

### 4.4c Resume RAG — `agent/resume_rag.py`, `lib/rag.ts`

- `chunk_text`: sentence split, ≤600 chars per chunk, one sentence of overlap, max 200 chunks.
- `embed`: fastembed `sentence-transformers/all-MiniLM-L6-v2` (384-d), loaded once per process in `prewarm`.
- `toVectorLiteral` rejects anything that is not exactly 384 finite numbers before it reaches SQL; values are bound as parameters and cast with `::vector`.
- The full resume is removed from the agent's prompt context; it is reachable only through retrieval.

### 4.5 Voice agent — `agent/worker.py`

```python
prewarm(proc)          # load VAD once per process
entrypoint(ctx):
    context = GET /api/agent/context?room=…        # httpx, 8 s timeout, internal secret
    session = AgentSession(stt=SarvamRealtimeSTT, llm=openai.LLM(base_url=Sarvam), tts=sarvam.TTS)
    session.on("conversation_item_added", persist_item)   # POST /api/agent/transcript (final only)
    session.on("metrics_collected", log_metrics)          # JSON: ttft, duration, audio_duration
    asyncio.create_task(index_resume())                    # chunk + embed + POST /api/agent/resume-chunks
    data channel → broadcast_agent_state / broadcast_user_speech
    await session.start(AriInterviewer(context), room=ctx.room)
```

`AriInterviewer.instructions` holds the persona, the stage order, a limit of one question at a time and at most two follow-ups per core question, a ban on scoring, and the role, rubric, blueprint and resume claims serialized as JSON.

**Function calling.** `AriInterviewer.search_resume(query)` is a `@function_tool`. Sarvam's chat API (`sarvam-105b-conversations`) receives it as an OpenAI-style `tools` entry; when the model returns a `tool_calls` item, LiveKit runs the method, which embeds the query, calls `/api/agent/resume-search`, and returns the passages as the tool result for the next model step.

`SarvamRealtimeSTT` is a streaming-only LiveKit STT plugin. It keeps a WebSocket to Sarvam's realtime endpoint, sends audio frames, and emits interim and final `SpeechEvent`s.

### 4.6 Frontend — `components/`

- `AriWorkspace` handles view state (`useState`), protected-view redirect to sign-in, data loading in `useEffect` with `fetch` + `async/await`, and loading and error state per view. Forms use controlled inputs.
- `AriVoiceRouter` wraps `LiveKitRoom`. It uses `useRef` for audio analysers, `SpeakingGate` (`lib/speaking.ts`) for the speaking-ring hysteresis, and data-channel listeners for captions and agent state.
- `AriAvatar` lazy-loads TalkingHead and the GLB model in `useEffect` and drives lip-sync from Ari's audio track.

## 5. Error handling conventions

| Status | Meaning in Ari |
| --- | --- |
| 400 | Missing or invalid field (e.g. `roleTitle` required) |
| 401 | No session, bad internal secret, or expired or invalid access token |
| 404 | Interview, role, room or resume not found or not owned |
| 409 | Resume limit reached |
| 410 | Interview already finished |
| 413 / 415 / 422 | Upload too large, unsupported type, or no readable text / no candidate answers |
| 503 | Upstream (DB, Sarvam, LiveKit) unavailable; the message says what was saved and how to retry |

## 6. Testing

- `tests/interview.test.ts`: stage progression, fallback probes, question selection, citation validation, token sign, verify, tamper and expiry.
- `tests/security.test.ts`: passcode hash format, salt uniqueness, verify right/wrong/malformed, vector validation (length, NaN, injection strings), client IP parsing.
- `agent/resume_rag.py` (`python resume_rag.py`): chunker self-check.
- `tests/speaking.test.ts`: speaking-gate thresholds, hold time, mute reset, independent tracks.
- Run with `npm test` (vitest).

## 7. Configuration

All configuration comes from environment variables, documented in `.env.example`: database URLs, `APP_URL`, `INTERNAL_API_SECRET`, `INTERVIEW_TOKEN_SECRET`, LiveKit credentials, Sarvam keys and models, Neon Auth cookie secret, S3 credentials, and the avatar GLB path. The server throws at startup if a required secret is missing or shorter than 32 characters.
