"""Persistent LiveKit worker for Ari.

Confirmed conversation items are persisted only after turn completion. Metrics
are emitted as structured JSON logs; no interim caption can become report evidence.
"""
import json
import os
import asyncio
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, JobExecutorType, JobProcess, WorkerOptions
from livekit.plugins import openai, sarvam

project_root = Path(__file__).resolve().parents[1]
load_dotenv(project_root / ".env")
load_dotenv(project_root / ".env.local", override=True)


class AriInterviewer(Agent):
    def __init__(self, context: dict) -> None:
        blueprint = context.get("blueprint") or {}
        role = context.get("role") or "the target role"
        shared_questions = blueprint.get("coreQuestions") or []
        project_probes = blueprint.get("personalizedProjectProbes") or []
        requirements = context.get("requirements") or []
        rubric = context.get("rubric") or []
        claims = context.get("resumeClaims") or {}
        super().__init__(
            instructions=(
                "You are Ari, a thoughtful and concise professional interviewer. "
                "Ask exactly one clear question at a time. Follow the interview stages "
                "in this order: opening, product judgment, technical depth, ownership "
                "and collaboration, candidate questions. Ask the shared core questions "
                "and no more than two follow-ups per core question. React to each "
                "answer, clarify ambiguity, and probe the candidate's personal ownership "
                "of resume claims. Do not score or make hiring recommendations. Keep a "
                "warm, calm tone and give the candidate time to think. Never infer "
                "dishonesty from gaze or camera events.\n\n"
                f"Role: {role}\nRequirements: {json.dumps(requirements, ensure_ascii=False)}\n"
                f"Shared questions: {json.dumps(shared_questions, ensure_ascii=False)}\n"
                f"Personalized project probes: {json.dumps(project_probes, ensure_ascii=False)}\n"
                f"Rubric dimensions for post-session analysis: {json.dumps(rubric, ensure_ascii=False)}\n"
                f"Candidate resume claims and skills: {json.dumps(claims, ensure_ascii=False)}"
            )
        )


def metric_value(metrics, name):
    value = getattr(metrics, name, None)
    return value if isinstance(value, (str, int, float, bool)) else None


async def entrypoint(ctx: JobContext) -> None:
    api_key = os.getenv("SARVAM_API_KEY")
    if not api_key:
        raise RuntimeError("SARVAM_API_KEY is required by the live worker")
    speaker = os.getenv("SARVAM_TTS_SPEAKER", "priya")
    language = os.getenv("SARVAM_LANGUAGE_CODE", "en-IN")
    app_url = os.getenv("APP_URL", "http://localhost:3000").rstrip("/")
    internal_secret = os.getenv("INTERNAL_API_SECRET", "")
    context = {}
    if internal_secret:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(
                    f"{app_url}/api/agent/context",
                    params={"room": ctx.room.name},
                    headers={"x-internal-secret": internal_secret},
                )
                response.raise_for_status()
                context = response.json()
        except Exception as error:
            print(json.dumps({"event": "interview_context_unavailable", "error": str(error)}))

    session = AgentSession(
        stt=sarvam.STT(
            language=language,
            model="saaras:v4",
            mode="transcribe",
            sample_rate=16000,
            high_vad_sensitivity=True,
        ),
        llm=openai.LLM(
            model=os.getenv("SARVAM_INTERVIEW_MODEL", "sarvam-105b-conversations"),
            base_url=os.getenv("SARVAM_LLM_BASE_URL", "https://api.sarvam.ai/v1"),
            api_key=api_key,
            extra_headers={"api-subscription-key": api_key},
        ),
        tts=sarvam.TTS(
            target_language_code=language,
            model="bulbul:v3",
            speaker=speaker,
            speech_sample_rate=22050,
            pace=1.0,
            temperature=0.6,
            min_buffer_size=50,
            max_chunk_length=150,
        ),
    )

    async def persist_item(event):
        item = getattr(event, "item", event)
        # ChatMessage exposes text_content for finalized text/audio transcripts.
        # Keep content parsing as a compatibility fallback across Agent releases.
        text_content = getattr(item, "text_content", "") or ""
        if not text_content:
            text_content = getattr(item, "content", "")
        if isinstance(text_content, list):
            parts = []
            for part in text_content:
                if isinstance(part, str):
                    parts.append(part)
                else:
                    value = getattr(part, "transcript", None) or getattr(part, "text", None)
                    if value:
                        parts.append(str(value))
            text_content = " ".join(parts)
        text_content = str(text_content).strip()
        role = str(getattr(item, "role", "")).lower()
        if not text_content or role not in ("user", "assistant"):
            return
        speaker_name = "CANDIDATE" if role == "user" else "ARI"
        if not internal_secret:
            print(json.dumps({"event": "transcript_not_persisted", "reason": "INTERNAL_API_SECRET missing"}))
            return
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.post(
                    f"{app_url}/api/agent/transcript",
                    headers={"x-internal-secret": internal_secret},
                    json={
                        "room": ctx.room.name,
                        "speaker": speaker_name,
                        "text": text_content,
                        "stage": "live_interview",
                        "startedAt": datetime.now(timezone.utc).isoformat(),
                    },
                )
                response.raise_for_status()
                turn_data = response.json()
                if ctx.room and ctx.room.local_participant:
                    try:
                        await ctx.room.local_participant.publish_data(
                            json.dumps({
                                "type": "turn_persisted",
                                "turn": {
                                    "id": turn_data.get("id"),
                                    "speaker": turn_data.get("speaker", speaker_name),
                                    "text": turn_data.get("text", text_content),
                                    "stage": turn_data.get("stage", "opening"),
                                    "stageIndex": turn_data.get("stageIndex", 0),
                                    "startedAt": turn_data.get("startedAt", datetime.now(timezone.utc).isoformat()),
                                },
                            }),
                            reliable=True,
                        )
                    except Exception as err:
                        print(json.dumps({"event": "turn_data_broadcast_error", "error": str(err)}))
        except Exception as error:
            print(json.dumps({"event": "transcript_persist_error", "error": str(error)}))

    async def broadcast_agent_state(state: str):
        if ctx.room and ctx.room.local_participant:
            try:
                await ctx.room.local_participant.publish_data(
                    json.dumps({"type": "agent_state", "state": state}),
                    reliable=True,
                )
            except Exception:
                pass

    def on_agent_state_changed(event):
        new_state = str(getattr(event, "new_state", "")).lower()
        mapping = {"speaking": "speaking", "listening": "listening", "thinking": "thinking"}
        state = mapping.get(new_state, "listening")
        import asyncio
        asyncio.create_task(broadcast_agent_state(state))

    def log_metrics(event):
        metrics = getattr(event, "metrics", event)
        record = {
            "event": "voice_metrics",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "type": type(metrics).__name__,
            "ttft": metric_value(metrics, "ttft"),
            "audio_duration": metric_value(metrics, "audio_duration"),
            "duration": metric_value(metrics, "duration"),
            "end_of_turn_delay": metric_value(metrics, "end_of_turn_delay"),
            "speaker": speaker,
        }
        print(json.dumps(record))

    def log_transcription(event):
        print(json.dumps({
            "event": "stt_transcription",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "is_final": bool(getattr(event, "is_final", False)),
            "characters": len(getattr(event, "transcript", "") or ""),
            "language": str(getattr(event, "language", "") or language),
        }))

    def log_transcription_timeout(event):
        print(json.dumps({
            "event": "stt_no_transcript",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "speech_duration": metric_value(event, "speech_duration"),
        }))

    def log_error(event):
        error = getattr(event, "error", event)
        source = getattr(event, "source", None)
        print(json.dumps({
            "event": "voice_pipeline_error",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": getattr(source, "provider", type(source).__name__ if source else None),
            "model": getattr(source, "model", None),
            "error": str(error),
        }))

    async def broadcast_user_speech(transcript: str, is_final: bool):
        if ctx.room and ctx.room.local_participant:
            try:
                await ctx.room.local_participant.publish_data(
                    json.dumps({
                        "type": "user_transcription",
                        "transcript": transcript,
                        "is_final": is_final,
                    }),
                    reliable=True,
                )
            except Exception:
                pass

    def on_user_transcription(event):
        log_transcription(event)
        transcript = str(getattr(event, "transcript", "") or "").strip()
        if transcript:
            is_final = bool(getattr(event, "is_final", False))
            asyncio.create_task(broadcast_user_speech(transcript, is_final))

    def on_conversation_item_added(event):
        asyncio.create_task(persist_item(event))

    session.on("conversation_item_added", on_conversation_item_added)
    session.on("agent_state_changed", on_agent_state_changed)
    session.on("metrics_collected", log_metrics)
    session.on("user_input_transcribed", on_user_transcription)
    session.on("user_transcription_timeout", log_transcription_timeout)
    session.on("error", log_error)
    await ctx.connect()
    await session.start(agent=AriInterviewer(context), room=ctx.room)
    await session.generate_reply(
        instructions=(
            "Welcome the candidate briefly, introduce yourself as Ari, and ask one opening question. "
            "Use this role and interview blueprint for shared questions and coverage. "
            f"Role context: {json.dumps(context, ensure_ascii=False)}"
        )
    )


def prewarm(proc: JobProcess) -> None:
    """Prewarm plugins or resources for worker."""
    pass


if __name__ == "__main__":
    agents.cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=os.getenv("LIVEKIT_AGENT_NAME", "ari-interviewer"),
            job_executor_type=JobExecutorType.THREAD,
        )
    )
