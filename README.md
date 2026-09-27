# Ari — Intelligent, Human-Centered AI Interview Platform

<p align="center">
  <strong>Live, evidence-linked conversational interviews powered by 3D animated avatars, real-time voice, and structured evaluation.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16.3-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/LiveKit-WebRTC-brightgreen?style=for-the-badge&logo=livekit" alt="LiveKit" />
  <img src="https://img.shields.io/badge/Sarvam-AI-orange?style=for-the-badge" alt="Sarvam AI" />
  <img src="https://img.shields.io/badge/Postgres-Neon-00E599?style=for-the-badge&logo=postgresql" alt="Neon Postgres" />
  <img src="https://img.shields.io/badge/Three.js-TalkingHead-red?style=for-the-badge&logo=three.js" alt="TalkingHead" />
</p>

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Getting Started Locally](#getting-started-locally)
- [Deployment Guide](#deployment-guide)
  - [1. Frontend & API (Vercel)](#1-frontend--api-vercel)
  - [2. LiveKit Agent Worker (Render / Docker)](#2-livekit-agent-worker-render--docker)
  - [3. Database & Auth (Neon)](#3-database--auth-neon)
- [Environment Variables](#environment-variables)
- [Privacy & Ethical Integrity](#privacy--ethical-integrity)
- [Assets & Attributions](#assets--attributions)
- [License](#license)

---

## Overview

**Ari** bridges the gap between mechanical asynchronous video screeners and biased unstructured interviews. Designed with a candidate-first philosophy, Ari provides a natural, conversational interview experience led by an expressive 3D interviewer while generating verifiable, evidence-based reports for hiring teams.

### Dual-Workflow Architecture:
1. **Candidate Practice & Preparation**: Candidates can practice with Ari in a safe, low-stress environment using their real resume. Spoken dialogue is processed with real-time feedback, optional camera mode, and zero permanent audio recording. A personalized growth plan highlights strengths and specific retry areas.
2. **Recruiter & Hiring Pipeline**: Teams configure structured job requirements, interview blueprints, and anchored rubrics. Every finding in the post-interview report directly links to confirmed transcript citations—eliminating hallucinated assessments and keeping hiring teams fully in control.

---

## Key Features

- **Photorealistic 3D Animated Interviewer**:
  - Rendered client-side using Three.js and TalkingHead with full facial blendshapes, eye contact, and head motion.
  - Neural lip-sync driven in real time by HeadAudio WebAudio worklets mapped to Sarvam Bulbul v3 speech.
  - Graceful fallback: If WebGL or avatar assets fail, the interface seamlessly falls back to audio-driven portrait mode without disrupting the session.

- **Low-Latency Conversational Pipeline**:
  - Full-duplex speech-to-speech interaction powered by LiveKit WebRTC and Sarvam AI models.
  - Saaras v4 Streaming Speech-to-Text (STT) with Indian English (`en-IN`) acoustic models.
  - Sarvam Conversational LLM contextually probes projects and experience without scripted rigidity.
  - Bulbul v3 Text-to-Speech (TTS) delivering natural voice output through native WebRTC playback.

- **Real-Time Live Candidate Speech Feedback**:
  - Candidate speech is transcribed in real-time and broadcast over LiveKit data channels, displaying immediate visual feedback both under the avatar and in the conversation timeline.

- **Verifiable Evidence-Based Reports**:
  - Reports cite confirmed candidate transcript turns.
  - Recruiter rating overrides and private reviewer notes are preserved alongside AI analysis.
  - Skills lacking sufficient conversational evidence are marked as *Insufficient Evidence* rather than guessed.

- **Fairness & Observable Integrity Signals**:
  - Observable events (tab visibility changes, camera availability) are tracked with timestamps and logged separately from skill evaluation.
  - Looking away or momentary distractions are never classified as cheating, and no automated rejection takes place.

- **Confirmation Safeguards**:
  - Thoughtfully designed confirmation dialogs prevent accidental session exits or unintended report finalization.

---

## System Architecture

```mermaid
flowchart TD
    subgraph Client["Next.js 16 Web Application (Browser)"]
        UI[Workspace & Practice UI]
        AV[TalkingHead 3D Avatar & WebGL Engine]
        HA[HeadAudio Viseme Worklet]
        RTC_C[LiveKit WebRTC Client]
    end

    subgraph LiveKit["LiveKit Cloud / WebRTC SFU"]
        Room[Media Room]
        AudioTrack[Agent & Candidate Audio Tracks]
        DataChannel[Data Channel: Speech & Turns]
    end

    subgraph Agent["LiveKit Agent Worker (Python 3.11+)"]
        Worker[LiveKit Worker Process]
        STT[Sarvam Saaras v4 STT]
        LLM[Sarvam 105B Conversational LLM]
        TTS[Sarvam Bulbul v3 TTS]
    end

    subgraph Backend["Cloud Infrastructure & Storage"]
        API[Next.js Server API Routes]
        Prisma[Prisma ORM]
        DB[(Neon Serverless Postgres)]
        Auth[Neon Managed Auth]
        S3[(Neon Object Storage / S3)]
    end

    UI -->|Join Interview| API
    API -->|Generate Tokens & Dispatch| Room
    RTC_C <-->|WebRTC Audio & Video| AudioTrack
    RTC_C <-->|Transcripts & State| DataChannel
    AudioTrack -->|Stream Audio| HA
    HA -->|Viseme Morph Weights| AV

    Worker <-->|Join Room & Media IO| Room
    Worker -->|Audio In| STT
    STT -->|Transcribed Text| LLM
    LLM -->|Reply Text| TTS
    TTS -->|Synthesized Audio| AudioTrack
    STT -->|Broadcast Speech| DataChannel
    Worker -->|Persist Confirmed Turns| API

    API --> Prisma --> DB
    UI --> Auth
    UI -->|Resume Uploads| S3
```

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend Framework** | [Next.js 16](https://nextjs.org/) (App Router, Turbopack / Webpack), React 19, TypeScript |
| **Real-Time Communication** | [LiveKit](https://livekit.io/) WebRTC Client SDK (`livekit-client`, `@livekit/components-react`) |
| **3D Avatar & Animation** | Three.js, [TalkingHead](https://github.com/met4citizen/TalkingHead), HeadAudio viseme worklet |
| **Styling & Design System** | Vanilla CSS, Space Grotesk & DM Sans typography, responsive layout |
| **Voice & AI Models** | [Sarvam AI](https://www.sarvam.ai/) (Saaras v4 STT, Sarvam-105B LLM, Bulbul v3 TTS) |
| **Agent Worker Runtime** | Python 3.11+, [LiveKit Agents SDK](https://github.com/livekit/agents), `asyncio` |
| **Database & ORM** | [Neon](https://neon.tech/) Serverless Postgres, [Prisma](https://www.prisma.io/) ORM |
| **Authentication & Storage** | Neon Auth (Managed Better Auth / Google OAuth), Neon Object Storage (S3-compatible) |
| **Document Processing** | `pdf-parse`, `mammoth` (DOCX), Sarvam Vision OCR |

---

## Repository Structure

```
Ari/
├── .env.example              # Environment variables template
├── agent/                    # Python LiveKit Agents worker
│   ├── worker.py             # Voice pipeline (STT -> LLM -> TTS -> Data Channel)
│   ├── audition_voices.py    # Local script to preview Sarvam TTS voices
│   ├── pyproject.toml        # Python dependencies and packaging
│   └── uv.lock               # Deterministic dependency lockfile
├── app/                      # Next.js App Router
│   ├── api/                  # Backend REST API routes
│   │   ├── agent/            # Internal endpoints for worker context & persistence
│   │   ├── interviews/       # Interview lifecycle, invites, integrity, and reports
│   │   ├── livekit/          # Room tokens and agent dispatch triggers
│   │   ├── profile/          # User profile and resume management
│   │   └── resume/parse/     # Multipart resume parser with fallback OCR
│   ├── auth/                 # Authentication pages (Sign In)
│   ├── layout.tsx            # Global layout with font providers
│   ├── page.tsx              # Dynamic router (landing, practice, interview, report)
│   └── globals.css           # Design tokens, responsive grid, and animation rules
├── components/               # React components
│   ├── ari-avatar.tsx        # TalkingHead 3D canvas loader and lifecycle manager
│   ├── ari-voice-router.tsx  # WebAudio routing, hardware speaker attach, Viseme sync
│   └── ari-workspace.tsx     # Primary candidate/recruiter workspace & modal dialogs
├── lib/                      # Core backend utilities
│   ├── auth.ts               # Neon Auth session resolution and cookie management
│   ├── db.ts                 # Prisma singleton instance
│   ├── livekit.ts            # LiveKit Server SDK helpers
│   ├── storage.ts            # S3 client for Neon Object Storage
│   └── sarvam.ts             # Sarvam API client for vision OCR and report generation
├── prisma/                   # Database models & migrations
│   ├── schema.prisma         # Schema definitions (Users, Roles, Interviews, Turns)
│   └── migrations/           # Versioned SQL migrations
└── public/                   # Static assets
    ├── audio/                # HeadAudio lip-sync worklets and viseme models
    └── avatars/              # 3D GLB avatars and licensing attribution
```

---

## Getting Started Locally

### Prerequisites
- **Node.js**: v20 or v22+
- **Python**: v3.11 or v3.13+ with `uv` package manager (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- **Database**: PostgreSQL 15+ (local instance or free [Neon](https://neon.tech) cloud database)
- **LiveKit Cloud**: Free project on [LiveKit Cloud](https://cloud.livekit.io/)
- **Sarvam AI**: API key from [Sarvam AI](https://www.sarvam.ai/)

---

### Step 1: Clone and Configure Environment

```bash
git clone https://github.com/AnuragTummapudi/Ari.git
cd Ari

# Copy example environment
cp .env.example .env
```

Populate your `.env` with your real keys:
```env
DATABASE_URL="postgresql://user:password@host.neon.tech/dbname?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://user:password@host.neon.tech/dbname?sslmode=require"
APP_URL="http://localhost:3000"
INTERNAL_API_SECRET="your-secure-internal-secret"

LIVEKIT_URL="wss://your-project.livekit.cloud"
LIVEKIT_API_KEY="your-livekit-api-key"
LIVEKIT_API_SECRET="your-livekit-api-secret"
LIVEKIT_AGENT_NAME="ari-interviewer"

SARVAM_API_KEY="your-sarvam-api-key"
SARVAM_TTS_SPEAKER="priya"
SARVAM_LANGUAGE_CODE="en-IN"

NEXT_PUBLIC_ARI_AVATAR_GLB="/avatars/ari.glb"
```

---

### Step 2: Install Node Dependencies & Run Database Migrations

```bash
# Install NPM packages
npm install

# Generate Prisma Client & apply schema
npx prisma generate
npx prisma migrate deploy
```

---

### Step 3: Start the Python LiveKit Worker

In a dedicated terminal:

```bash
cd agent

# Install dependencies using uv
uv sync

# Start the agent worker in development mode
uv run python worker.py dev
```

You should see:
```text
INFO livekit.agents - registered worker {"agent_name": "ari-interviewer", ...}
```

---

### Step 4: Start the Next.js Frontend

In another terminal:

```bash
npm run dev
# or for production build
npm run build && npm start
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser!

---

## Deployment Guide

For public deployment (e.g. for a hackathon demo or production screening), Ari uses a two-part deployment:

```
[ Vercel ] --------------> Next.js Web App & REST APIs
[ Render / Docker ] -----> Persistent Python LiveKit Agent Worker
[ Neon ] ----------------> Serverless Postgres, Auth & S3 Storage
[ LiveKit Cloud ] -------> WebRTC SFU Media Cloud
```

### 1. Frontend & API (Vercel)

1. Push your code to GitHub.
2. In [Vercel](https://vercel.com/), click **Add New Project** and import your repository.
3. Add the environment variables from `.env` in the Vercel Project Settings:
   - `DATABASE_URL`
   - `DATABASE_URL_UNPOOLED`
   - `APP_URL` (set to your Vercel URL, e.g. `https://ari-interviews.vercel.app`)
   - `INTERNAL_API_SECRET`
   - `LIVEKIT_URL`
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
   - `LIVEKIT_AGENT_NAME` (`ari-interviewer`)
   - `SARVAM_API_KEY`
   - `NEXT_PUBLIC_ARI_AVATAR_GLB` (`/avatars/ari.glb`)
4. Set Build Command: `prisma generate && next build`
5. Deploy!

### 2. LiveKit Agent Worker (Render / Docker)

LiveKit agents maintain an active WebSocket connection to LiveKit Cloud to listen for incoming rooms. They require a long-running process (not a serverless function).

#### Option A: Deploy on Render as a Background Worker
1. In [Render](https://render.com/), create a new **Background Worker**.
2. Connect your GitHub repository.
3. Configure the worker:
   - **Root Directory**: `agent`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install uv && uv sync`
   - **Start Command**: `uv run python worker.py start`
4. Set Environment Variables:
   - `LIVEKIT_URL`
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
   - `LIVEKIT_AGENT_NAME` (`ari-interviewer`)
   - `SARVAM_API_KEY`
   - `INTERNAL_API_SECRET` (matching the one in Vercel)
   - `APP_URL` (your deployed Vercel URL, e.g. `https://ari-interviews.vercel.app`)

#### Option B: Deploy via Docker
Use the included `agent/Dockerfile` (or build a container) to deploy on Fly.io, AWS ECS, or DigitalOcean App Platform.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Pooled PostgreSQL connection string for Prisma application queries |
| `DATABASE_URL_UNPOOLED` | Yes | Direct PostgreSQL connection string for Prisma migrations |
| `APP_URL` | Yes | Canonical base URL (`http://localhost:3000` or production domain) |
| `INTERNAL_API_SECRET` | Yes | Shared secret for worker-to-server callbacks (`/api/agent/*`) |
| `LIVEKIT_URL` | Yes | LiveKit Cloud WebSocket URL (`wss://<project>.livekit.cloud`) |
| `LIVEKIT_API_KEY` | Yes | LiveKit API Key for token generation |
| `LIVEKIT_API_SECRET` | Yes | LiveKit API Secret for JWT signing |
| `LIVEKIT_AGENT_NAME` | No | Name for worker registration (Default: `ari-interviewer`) |
| `SARVAM_API_KEY` | Yes | Sarvam AI API Key for STT, LLM, and TTS |
| `SARVAM_TTS_SPEAKER` | No | Sarvam voice ID (Default: `priya`) |
| `SARVAM_LANGUAGE_CODE`| No | Primary language code (Default: `en-IN`) |
| `NEXT_PUBLIC_ARI_AVATAR_GLB` | Yes | Path to client-accessible GLB avatar (Default: `/avatars/ari.glb`) |
| `NEON_AUTH_COOKIE_SECRET` | Optional | Random 32+ char secret for signing authentication cookies |
| `AWS_ACCESS_KEY_ID` | Optional | S3 / Neon Object Storage access key for resume storage |
| `AWS_SECRET_ACCESS_KEY` | Optional | S3 / Neon Object Storage secret key |
| `AWS_ENDPOINT_URL_S3` | Optional | S3 endpoint URL (`https://storage.neon.tech`) |

---

## Privacy & Ethical Integrity

- **Zero Audio Retention**: Ari does not record or store raw candidate audio. Only confirmed conversational turns and text transcripts are retained.
- **Transparent Consent**: Every session begins with clear, mandatory consent covering microphone usage, transcript retention (90-day standard), and optional camera participation.
- **Separation of Integrity Events**: Observational integrity markers (such as window focus changes or camera disconnects) are stored strictly as chronological timestamps. They are visually separated in the report and **never** contribute to automated score deductions or rejections.
- **Human-in-the-Loop**: All AI-suggested scores and findings are subject to recruiter review, note annotation, and manual rating overrides.

---

## Assets & Attributions

- **TalkingHead**: Licensed under the [MIT License](https://github.com/met4citizen/TalkingHead).
- **HeadAudio**: Viseme analysis worklet licensed under the [MIT License](https://github.com/met4citizen/TalkingHead).
- **3D Avatar Model (`ari.glb`)**: Powered by the Julia 3D reference model created with Ready Player Me tools and packaged in compliance with asset guidelines. Complete licensing documentation is available in [`public/avatars/ATTRIBUTION.md`](./public/avatars/ATTRIBUTION.md).

---

## License

This project is open-source software licensed under the [MIT License](LICENSE).
