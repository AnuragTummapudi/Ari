import { describe, expect, it } from "vitest";
import { hashPasscode, isValidPasscode, verifyPasscode } from "../lib/passcode";
import { EMBEDDING_DIMENSIONS, toVectorLiteral } from "../lib/rag";
import { clientIp } from "../lib/rate-limit";

describe("invite passcode hashing", () => {
  it("stores a salted scrypt hash, never the passcode", async () => {
    const hash = await hashPasscode("orchid-42");
    expect(hash).toMatch(/^scrypt\$[\w-]+\$[\w-]+$/);
    expect(hash).not.toContain("orchid-42");
    expect(await hashPasscode("orchid-42")).not.toBe(hash); // fresh salt every time
  });

  it("verifies only the right passcode", async () => {
    const hash = await hashPasscode("orchid-42");
    expect(await verifyPasscode("orchid-42", hash)).toBe(true);
    expect(await verifyPasscode("orchid-43", hash)).toBe(false);
    expect(await verifyPasscode(undefined, hash)).toBe(false);
    expect(await verifyPasscode("orchid-42", "plain-text")).toBe(false);
  });

  it("enforces passcode length", () => {
    expect(isValidPasscode("abc")).toBe(false);
    expect(isValidPasscode("abcd")).toBe(true);
    expect(isValidPasscode("x".repeat(65))).toBe(false);
  });
});

describe("RAG vector validation", () => {
  it("accepts only finite 384-number embeddings", () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / 1000);
    expect(toVectorLiteral(vector)).toMatch(/^\[0,0\.001,.*\]$/);
    expect(toVectorLiteral(vector.slice(1))).toBeNull();
    expect(toVectorLiteral([...vector.slice(1), Number.NaN])).toBeNull();
    expect(toVectorLiteral([...vector.slice(1), "1); DROP TABLE x;--"])).toBeNull();
  });
});

describe("rate limit client key", () => {
  it("uses the first forwarded address", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }))).toBe("203.0.113.9");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
