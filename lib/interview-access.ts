import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14;

function signingKey() {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || secret.length < 32) throw new Error("INTERNAL_API_SECRET must contain at least 32 characters.");
  return secret;
}

export function createInterviewAccessToken(interviewId: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ sub: interviewId, exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS })).toString("base64url");
  const signature = createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function getInterviewIdFromAccessToken(token: string | null | undefined, now = Date.now()) {
  if (!token || token.length > 2048) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  let expected: Buffer;
  try { expected = createHmac("sha256", signingKey()).update(payload).digest(); }
  catch { return null; }
  let actual: Buffer;
  try { actual = Buffer.from(signature, "base64url"); }
  catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
    return typeof decoded.sub === "string" && decoded.sub.length > 0 && typeof decoded.exp === "number" && decoded.exp > Math.floor(now / 1000)
      ? decoded.sub
      : null;
  } catch { return null; }
}

export function verifyInterviewAccessToken(token: string | null | undefined, interviewId: string, now = Date.now()) {
  return getInterviewIdFromAccessToken(token, now) === interviewId;
}
