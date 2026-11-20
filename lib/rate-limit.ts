import { NextResponse } from "next/server";
import { prisma } from "./prisma";

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Fixed-window limiter backed by Postgres, so the limit holds across serverless instances.
 * Returns a 429 response when the caller is over the limit, otherwise null.
 * shortcut: expired rows are reset in place, never deleted; add a cleanup job if the table grows large.
 */
export async function rateLimit(req: Request, bucket: string, limit: number, windowSeconds: number) {
  const key = `${bucket}:${clientIp(req)}`;
  try {
    const [row] = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimit" ("key", "count", "resetAt")
      VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
      ON CONFLICT ("key") DO UPDATE SET
        "count"   = CASE WHEN "RateLimit"."resetAt" <= now() THEN 1 ELSE "RateLimit"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimit"."resetAt" <= now() THEN now() + make_interval(secs => ${windowSeconds}) ELSE "RateLimit"."resetAt" END
      RETURNING "count", "resetAt"`;
    if (row.count <= limit) return null;
    const retryAfter = Math.max(1, Math.ceil((new Date(row.resetAt).getTime() - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  } catch (error) {
    // Fail open: a limiter outage should not take the interview down with it.
    console.error("Rate limiter unavailable", error);
    return null;
  }
}
