export const EMBEDDING_DIMENSIONS = 384; // sentence-transformers/all-MiniLM-L6-v2, computed in the agent

/** Validates an embedding and renders it as a pgvector literal, e.g. "[0.1,0.2,...]". */
export function toVectorLiteral(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== EMBEDDING_DIMENSIONS) return null;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return `[${value.join(",")}]`;
}

export function isInternalRequest(req: Request) {
  const secret = process.env.INTERNAL_API_SECRET;
  return Boolean(secret) && req.headers.get("x-internal-secret") === secret;
}
