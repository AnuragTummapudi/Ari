"""Resume RAG helpers: chunk resume text and embed it locally with all-MiniLM-L6-v2 (384 dims).

The vectors are stored and searched in Postgres (pgvector) through the web API.
"""
import re

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
_embedder = None


def get_embedder():
    """Load the ONNX model once per process (about 90 MB, downloaded on first use)."""
    global _embedder
    if _embedder is None:
        from fastembed import TextEmbedding

        _embedder = TextEmbedding(model_name=MODEL_NAME)
    return _embedder


def embed(texts: list[str]) -> list[list[float]]:
    return [vector.tolist() for vector in get_embedder().embed(texts)]


def chunk_text(text: str, max_chars: int = 600, overlap_sentences: int = 1) -> list[str]:
    """Split on sentence boundaries into chunks of at most max_chars, carrying one sentence of overlap."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text or "") if s.strip()]
    chunks: list[str] = []
    current: list[str] = []
    for sentence in sentences:
        sentence = sentence[:max_chars]
        if current and len(" ".join(current + [sentence])) > max_chars:
            chunks.append(" ".join(current))
            current = current[-overlap_sentences:] if overlap_sentences else []
            if len(" ".join(current + [sentence])) > max_chars:
                current = []
        current.append(sentence)
    if current:
        chunks.append(" ".join(current))
    return chunks[:200]


if __name__ == "__main__":
    sample = "Built a payments service in Go. Reduced p99 latency by 40%. " * 20
    parts = chunk_text(sample, max_chars=120)
    assert parts and all(len(p) <= 120 for p in parts), parts
    assert chunk_text("") == []
    assert chunk_text("One sentence only.") == ["One sentence only."]
    assert len(chunk_text("x. " * 5000, max_chars=4)) == 200
    print("chunk_text ok")
