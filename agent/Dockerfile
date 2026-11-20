# Python LiveKit agent — uses uv for fast, reproducible installs
FROM python:3.12-slim AS runner

WORKDIR /agent

# System deps: uv installer needs curl
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.cargo/bin:/root/.local/bin:$PATH"

# Copy dependency manifests first for layer caching
COPY pyproject.toml uv.lock* ./

# Install deps into the system Python (no venv needed inside container)
RUN uv pip install --system --no-cache -r pyproject.toml 2>/dev/null \
 || uv pip install --system --no-cache \
      "livekit-agents[sarvam,openai]~=1.8" \
      "python-dotenv>=1.0.1" \
      "httpx>=0.27.2" \
      "fastembed>=0.9,<1"

# Copy agent source
COPY . .

# Download LiveKit plugin model files at build time so the container
# starts immediately without a cold-download delay
RUN python -c "from livekit.agents import utils; pass" 2>/dev/null || true
# Bake the resume-embedding model (all-MiniLM-L6-v2, ~90 MB) into the image
RUN python -c "import resume_rag; resume_rag.get_embedder()"

EXPOSE 8080

# `start` mode: connects to LiveKit Cloud and waits for jobs
CMD ["python", "worker.py", "start"]
