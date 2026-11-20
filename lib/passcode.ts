import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

export function isValidPasscode(value: unknown): value is string {
  return typeof value === "string" && value.length >= 4 && value.length <= 64;
}

/** Salted scrypt hash, stored as `scrypt$<salt>$<hash>` (base64url). */
export async function hashPasscode(passcode: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(passcode, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPasscode(passcode: unknown, stored: string) {
  if (typeof passcode !== "string" || passcode.length > 64) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(passcode, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}
