import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  signupSchema,
  credentialsSchema,
} from "@/lib/auth/password";

describe("password hashing", () => {
  it("produces a bcrypt hash and verifies the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(hash.length).toBe(60);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword("nope", hash)).toBe(false);
  });

  it("verify returns false for a malformed hash instead of throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("signup schema", () => {
  it("accepts a valid signup and normalises email", () => {
    const r = signupSchema.safeParse({ name: " Ric ", email: " RIC@OOVIE.COM ", password: "1234567890" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("ric@oovie.com");
      expect(r.data.name).toBe("Ric");
    }
  });

  it("rejects short passwords and bad emails", () => {
    expect(signupSchema.safeParse({ name: "A", email: "a@b.com", password: "short" }).success).toBe(false);
    expect(signupSchema.safeParse({ name: "A", email: "not-an-email", password: "1234567890" }).success).toBe(false);
    expect(signupSchema.safeParse({ name: "", email: "a@b.com", password: "1234567890" }).success).toBe(false);
  });
});

describe("credentials schema", () => {
  it("lowercases the email and requires a password", () => {
    const r = credentialsSchema.safeParse({ email: "USER@X.COM", password: "x" });
    expect(r.success && r.data.email).toBe("user@x.com");
    expect(credentialsSchema.safeParse({ email: "user@x.com", password: "" }).success).toBe(false);
  });
});
