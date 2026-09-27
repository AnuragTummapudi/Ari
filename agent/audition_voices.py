"""Generate equal-text Sarvam Bulbul v3 samples for a real listening test."""
import base64
import os
from pathlib import Path

import httpx

API_KEY = os.getenv("SARVAM_API_KEY")
if not API_KEY:
    raise SystemExit("Set SARVAM_API_KEY before auditioning voices.")

SPEAKERS = ("priya", "simran", "ishita", "kavya")
TEXT = "Thank you for joining me. Tell me about a product decision you influenced with evidence, and what changed because of it. Take a moment to think before you answer."
OUTPUT = Path(__file__).parent / "voice-samples"
OUTPUT.mkdir(parents=True, exist_ok=True)

for speaker in SPEAKERS:
    response = httpx.post(
        "https://api.sarvam.ai/text-to-speech",
        headers={"api-subscription-key": API_KEY},
        json={
            "model": "bulbul:v3",
            "speaker": speaker,
            "language_code": os.getenv("SARVAM_LANGUAGE_CODE", "en-IN"),
            "text": TEXT,
            "pace": 1.0,
            "output_audio_codec": "wav",
        },
        timeout=90,
    )
    response.raise_for_status()
    audio = response.json()["audios"][0]
    (OUTPUT / f"{speaker}.wav").write_bytes(base64.b64decode(audio))
    print(f"Wrote {OUTPUT / f'{speaker}.wav'}")

print("Listen to all four samples and change SARVAM_TTS_SPEAKER only after comparison.")
