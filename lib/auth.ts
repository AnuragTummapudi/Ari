import { createNeonAuth } from "@neondatabase/auth/next/server";

const baseUrl = process.env.NEON_AUTH_BASE_URL || "https://auth.neon.tech";
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET || "fallback-secret-at-least-32-chars-for-dev-and-test";

if (!baseUrl) throw new Error("NEON_AUTH_BASE_URL is required. Run `neon env pull`.");
if (!cookieSecret || cookieSecret.length < 32) {
  throw new Error("NEON_AUTH_COOKIE_SECRET must contain at least 32 characters.");
}

export const auth = createNeonAuth({
  baseUrl,
  cookies: { secret: cookieSecret },
});

export async function getAriUser() {
  if (!process.env.NEON_AUTH_BASE_URL || !process.env.NEON_AUTH_COOKIE_SECRET) {
    return null;
  }
  try {
    const { data } = await auth.getSession();
    return data?.user ?? null;
  } catch {
    return null;
  }
}
