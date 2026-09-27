"""
SarvamRealtimeSTT — LiveKit-compatible STT plugin for Sarvam's Realtime Streaming API.

Endpoint : wss://api.sarvam.ai/speech-to-text-realtime/ws
Docs     : https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming

Key design decisions
---------------------
* endpointing=manual   — We control speech_start / speech_end events ourselves.
  The server buffers audio but never fires transcription events while we have NOT
  sent speech_start.  This is the primary mechanism for the speaker-lock.

Note: _recognize_impl (batch/non-streaming recognition) is intentionally not
implemented — this plugin is streaming-only.  Use sarvam.STT for batch use.


* pause_transcription() → sends {"event": "speech_end"}  — call when Ari starts
  speaking.  All audio is still forwarded so there is no gap; transcripts just
  won't arrive until we resume.

* resume_transcription() → sends {"event": "speech_start"} — call when Ari
  finishes speaking.

* stream_type="fast"   — lowest-latency partial transcripts (recommended for
  voice agents per Sarvam docs).

* model="saaras:v4"    — latest model; also supports keyterms.

Audio format notes
------------------
New realtime endpoint message format (different from legacy /speech-to-text/ws):
  Client → server:  {"event": "audio_input", "audio": "<base64-PCM>"}
  Client → server:  {"event": "speech_start"} / {"event": "speech_end"}
  Server → client:  {"event": "transcript.partial", "text": "..."}
  Server → client:  {"event": "transcript.final",   "text": "..."}
  Server → client:  {"event": "session.begin" | "session.end" | "error" | ...}
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import time
from urllib.parse import urlencode

import aiohttp
from livekit import agents, rtc
from livekit.agents import stt, utils
from livekit.agents.stt.stt import RecognizeStream

logger = logging.getLogger("sarvam_realtime_stt")

REALTIME_WS_URL = "wss://api.sarvam.ai/speech-to-text-realtime/ws"

# Audio: 16 kHz mono linear16 — 100 ms chunks = 3200 bytes
_SAMPLE_RATE   = 16_000
_CHUNK_SAMPLES = _SAMPLE_RATE // 10          # 1600 samples per 100 ms
_CHUNK_BYTES   = _CHUNK_SAMPLES * 2          # 3200 bytes (int16 = 2 bytes)


# ---------------------------------------------------------------------------
# Plugin class
# ---------------------------------------------------------------------------

class SarvamRealtimeSTT(stt.STT):
    """
    LiveKit STT plugin wrapping Sarvam's *new* Realtime WebSocket endpoint.

    Drop-in replacement for ``livekit.plugins.sarvam.STT`` with:
    - endpointing=manual support (speaker-lock gate)
    - pause_transcription() / resume_transcription() API
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        language_code: str = "en-IN",
        model: str = "saaras:v4",
        stream_type: str = "fast",       # fast | balanced | simulated
        endpointing: str = "manual",     # manual | vad
        sample_rate: int = _SAMPLE_RATE,
        # VAD tuning (only applies when endpointing=vad)
        silence_duration_ms: int = 700,
        threshold: float = 0.3,
        min_speech_duration_ms: int = 200,
    ) -> None:
        super().__init__(
            capabilities=stt.STTCapabilities(streaming=True, interim_results=True)
        )
        self._api_key              = api_key or os.environ.get("SARVAM_API_KEY", "")
        self._language_code        = language_code
        self._model                = model
        self._stream_type          = stream_type
        self._endpointing          = endpointing
        self._sample_rate          = sample_rate
        self._silence_duration_ms  = silence_duration_ms
        self._threshold            = threshold
        self._min_speech_duration_ms = min_speech_duration_ms

        # Session-level state shared across stream instances
        self._transcription_paused = False
        self._active_streams: list[_RealtimeRecognizeStream] = []

    # ------------------------------------------------------------------
    # Speaker-lock public API
    # ------------------------------------------------------------------

    async def pause_transcription(self) -> None:
        """
        Pause transcription — call when Ari starts speaking.
        Sends {"event": "speech_end"} to the Sarvam WS so no transcript
        events arrive while Ari's TTS is playing out.
        """
        if self._transcription_paused:
            return
        self._transcription_paused = True
        logger.debug("Sarvam STT: pausing transcription (Ari is now speaking)")
        for stream in list(self._active_streams):
            await stream._send_speech_end()

    async def resume_transcription(self) -> None:
        """
        Resume transcription — call when Ari finishes speaking.
        Sends {"event": "speech_start"} so the server starts emitting
        transcripts for the candidate's next utterance.
        """
        if not self._transcription_paused:
            return
        self._transcription_paused = False
        logger.debug("Sarvam STT: resuming transcription (Ari finished speaking)")
        for stream in list(self._active_streams):
            await stream._send_speech_start()

    # ------------------------------------------------------------------
    # LiveKit STT interface
    # ------------------------------------------------------------------

    def stream(
        self,
        *,
        language: str | None = None,
        conn_options: agents.APIConnectOptions = agents.DEFAULT_API_CONNECT_OPTIONS,
    ) -> "_RealtimeRecognizeStream":
        stream = _RealtimeRecognizeStream(
            stt_plugin=self,
            language=language or self._language_code,
            conn_options=conn_options,
        )
        self._active_streams.append(stream)
        return stream

    async def _recognize_impl(
        self,
        buffer,
        *,
        language=agents.NOT_GIVEN,
        conn_options: agents.APIConnectOptions = agents.DEFAULT_API_CONNECT_OPTIONS,
    ) -> stt.SpeechEvent:
        """Batch recognition is not supported — use streaming (stream())."""
        raise NotImplementedError(
            "SarvamRealtimeSTT is a streaming-only plugin. "
            "Use stt.stream() instead of stt.recognize()."
        )

    async def aclose(self) -> None:
        """Close all active streams."""
        for stream in list(self._active_streams):
            try:
                await stream.aclose()
            except Exception:
                pass

    def _remove_stream(self, stream: "_RealtimeRecognizeStream") -> None:
        try:
            self._active_streams.remove(stream)
        except ValueError:
            pass

    def _build_ws_url(self, language: str) -> str:
        params: dict = {
            "language_code": language,
            "model":         self._model,
            "stream_type":   self._stream_type,
            "endpointing":   self._endpointing,
            "encoding":      "linear16",
            "sample_rate":   self._sample_rate,
        }
        if self._endpointing == "vad":
            params["silence_duration_ms"]   = self._silence_duration_ms
            params["threshold"]             = self._threshold
            params["min_speech_duration_ms"]= self._min_speech_duration_ms
        return f"{REALTIME_WS_URL}?{urlencode(params)}"


# ---------------------------------------------------------------------------
# Stream class
# ---------------------------------------------------------------------------

class _RealtimeRecognizeStream(RecognizeStream):
    """
    A single WebSocket session with Sarvam's realtime STT endpoint.
    Implements the LiveKit RecognizeStream (= SpeechStream) abstract interface.
    """

    def __init__(
        self,
        *,
        stt_plugin: SarvamRealtimeSTT,
        language: str,
        conn_options: agents.APIConnectOptions,
    ) -> None:
        super().__init__(stt=stt_plugin, conn_options=conn_options)
        self._plugin   = stt_plugin
        self._language = language
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._http_session: aiohttp.ClientSession | None = None
        self._send_lock = asyncio.Lock()
        self._speech_active = False  # True after speech_start, False after speech_end

    # ------------------------------------------------------------------
    # Internal WS helpers
    # ------------------------------------------------------------------

    async def _ws_send(self, payload: dict) -> None:
        if self._ws and not self._ws.closed:
            async with self._send_lock:
                try:
                    await self._ws.send_str(json.dumps(payload))
                except Exception as exc:
                    logger.warning("Sarvam STT WS send error: %s", exc)

    async def _send_speech_start(self) -> None:
        if not self._speech_active:
            logger.debug("Sarvam STT → speech_start")
            self._speech_active = True
            await self._ws_send({"event": "speech_start"})

    async def _send_speech_end(self) -> None:
        if self._speech_active:
            logger.debug("Sarvam STT → speech_end")
            self._speech_active = False
            await self._ws_send({"event": "speech_end"})

    # ------------------------------------------------------------------
    # LiveKit abstract method: _run
    # ------------------------------------------------------------------

    async def _run(self) -> None:
        """
        Connect to Sarvam WS, then run send + receive tasks in parallel.
        This is the single method LiveKit calls (via _main_task internally).
        """
        self._http_session = aiohttp.ClientSession()
        ws_url = self._plugin._build_ws_url(self._language)
        logger.info("Sarvam Realtime STT connecting → %s", ws_url.split("?")[0])

        try:
            self._ws = await asyncio.wait_for(
                self._http_session.ws_connect(
                    ws_url,
                    headers={"api-subscription-key": self._plugin._api_key},
                    heartbeat=30,
                ),
                timeout=self._conn_options.timeout,
            )
        except Exception as exc:
            raise agents.APIConnectionError(
                f"Sarvam Realtime STT: failed to connect — {exc}"
            ) from exc

        # Open the speech gate unless already paused (Ari may already be speaking)
        if not self._plugin._transcription_paused:
            await self._send_speech_start()

        send_task = asyncio.create_task(self._send_audio_loop(), name="sarvam_stt_send")
        recv_task = asyncio.create_task(self._recv_loop(),       name="sarvam_stt_recv")

        try:
            done, pending = await asyncio.wait(
                [send_task, recv_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass
            # Propagate first exception
            for t in done:
                exc = t.exception()
                if exc:
                    raise exc
        finally:
            self._plugin._remove_stream(self)
            # Graceful close
            if self._ws and not self._ws.closed:
                try:
                    await self._ws_send({"event": "end"})
                    await self._ws.close()
                except Exception:
                    pass
            if self._http_session and not self._http_session.closed:
                await self._http_session.close()

    # ------------------------------------------------------------------
    # Audio sender
    # ------------------------------------------------------------------

    async def _send_audio_loop(self) -> None:
        """
        Drain LiveKit audio frames from _input_ch and forward as base64
        audio_input events to Sarvam.  Handles FlushSentinel for stream end.
        """
        buf = bytearray()

        async for frame in self._input_ch:
            if isinstance(frame, RecognizeStream._FlushSentinel):
                # Force-finalize current utterance (manual endpointing)
                if self._speech_active:
                    await self._ws_send({"event": "flush"})
                break

            if not isinstance(frame, rtc.AudioFrame):
                continue

            buf.extend(bytes(frame.data))

            # Ship in 100 ms chunks
            while len(buf) >= _CHUNK_BYTES:
                chunk   = bytes(buf[:_CHUNK_BYTES])
                buf     = buf[_CHUNK_BYTES:]
                encoded = base64.b64encode(chunk).decode("ascii")
                await self._ws_send({"event": "audio_input", "audio": encoded})

    # ------------------------------------------------------------------
    # Event receiver
    # ------------------------------------------------------------------

    async def _recv_loop(self) -> None:
        """
        Receive Sarvam server events and emit LiveKit SpeechEvents.
        """
        assert self._ws is not None

        request_id       = utils.shortuuid()
        speech_started_t = time.monotonic()

        async for msg in self._ws:
            if msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                logger.info("Sarvam STT WS closed (type=%s)", msg.type)
                break
            if msg.type != aiohttp.WSMsgType.TEXT:
                continue

            try:
                data = json.loads(msg.data)
            except json.JSONDecodeError:
                continue

            event = data.get("event", "")

            if event == "session.begin":
                logger.info("Sarvam STT session started: session_id=%s", data.get("session_id"))

            elif event == "vad.speech_start":
                speech_started_t = time.monotonic()
                self._event_ch.send_nowait(
                    stt.SpeechEvent(type=stt.SpeechEventType.START_OF_SPEECH)
                )

            elif event == "vad.speech_end":
                self._event_ch.send_nowait(
                    stt.SpeechEvent(type=stt.SpeechEventType.END_OF_SPEECH)
                )

            elif event == "transcript.partial":
                text = (data.get("text") or "").strip()
                if not text:
                    continue
                detected_lang = data.get("language", self._language)
                self._event_ch.send_nowait(
                    stt.SpeechEvent(
                        type=stt.SpeechEventType.INTERIM_TRANSCRIPT,
                        request_id=request_id,
                        alternatives=[
                            stt.SpeechData(
                                language=detected_lang,
                                text=text,
                                confidence=0.7,
                            )
                        ],
                    )
                )

            elif event == "transcript.final":
                text = (data.get("text") or "").strip()
                if not text:
                    continue
                detected_lang = data.get("language", self._language)
                lang_conf     = float(data.get("language_confidence", 0.95))
                duration      = time.monotonic() - speech_started_t
                self._event_ch.send_nowait(
                    stt.SpeechEvent(
                        type=stt.SpeechEventType.FINAL_TRANSCRIPT,
                        request_id=request_id,
                        alternatives=[
                            stt.SpeechData(
                                language=detected_lang,
                                text=text,
                                confidence=lang_conf,
                                start_time=0.0,
                                end_time=max(0.0, duration),
                            )
                        ],
                    )
                )
                # New utterance starts fresh
                request_id       = utils.shortuuid()
                speech_started_t = time.monotonic()

            elif event == "error":
                is_fatal = bool(data.get("is_fatal", False))
                logger.error(
                    "Sarvam STT error (fatal=%s, code=%s): %s",
                    is_fatal,
                    data.get("code"),
                    data.get("message"),
                )
                if is_fatal:
                    raise RuntimeError(
                        f"Sarvam STT fatal error [{data.get('code')}]: {data.get('message')}"
                    )

            elif event == "session.end":
                billed = data.get("audio_duration_s", 0)
                logger.info("Sarvam STT session.end — billed audio: %.2fs", billed)
                break
