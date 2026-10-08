import { describe, it, expect } from "vitest";
import { AUTH_ERROR_SENTENCES, AuthRefusal, authErrorSentence } from "./auth-error-messages";

describe("authErrorSentence", () => {
  it("a wrong email or password says so (rule 1)", () => {
    expect(authErrorSentence({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" })).toBe("Wrong email or password.");
  });

  it("a wrong current password on an Account dialog says so (rule 6)", () => {
    expect(authErrorSentence({ status: 400, code: "INVALID_PASSWORD" })).toBe("Wrong password.");
    expect(AUTH_ERROR_SENTENCES.wrongCurrentPassword).toBe("Wrong password.");
  });

  it("a used or expired reset link says it has expired (rule 4)", () => {
    expect(authErrorSentence({ status: 400, code: "INVALID_TOKEN" })).toBe("This link has expired. Request a new one.");
    expect(authErrorSentence({ status: 400, code: "TOKEN_EXPIRED" })).toBe("This link has expired. Request a new one.");
  });

  it("the limiter's answer says to wait, whatever its code (rule 15)", () => {
    expect(authErrorSentence({ status: 429 })).toBe("Too many attempts. Wait a moment and try again.");
    expect(authErrorSentence({ status: 429, code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(AUTH_ERROR_SENTENCES.tooManyAttempts);
  });

  it("anything else, or nothing at all, says the generic sentence and nothing raw", () => {
    expect(authErrorSentence({ status: 500, code: "FAILED_TO_GET_SESSION" })).toBe("Something went wrong. Try again.");
    expect(authErrorSentence({ status: 403, code: "EMAIL_NOT_VERIFIED" })).toBe(AUTH_ERROR_SENTENCES.generic);
    expect(authErrorSentence({ code: "constructor" })).toBe(AUTH_ERROR_SENTENCES.generic);
    expect(authErrorSentence({})).toBe(AUTH_ERROR_SENTENCES.generic);
    expect(authErrorSentence(null)).toBe(AUTH_ERROR_SENTENCES.generic);
    expect(authErrorSentence(new TypeError("Failed to fetch"))).toBe(AUTH_ERROR_SENTENCES.generic);
  });

  it("words an AuthRefusal thrown with the client's error by its status and code", () => {
    const refusal = new AuthRefusal({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });
    expect(refusal).toBeInstanceOf(Error);
    expect(authErrorSentence(refusal)).toBe(AUTH_ERROR_SENTENCES.wrongPassword);
    expect(authErrorSentence(new AuthRefusal({ status: 429 }))).toBe(AUTH_ERROR_SENTENCES.tooManyAttempts);
  });
});
