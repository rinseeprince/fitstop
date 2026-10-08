/**
 * What a sign-in screen says when Better Auth refuses (docs/BETTER-AUTH-PLAN.md
 * 2.2, "Errors"): its codes mapped to the rules' sentences, and nothing raw.
 * Every other refusal says the one generic sentence.
 */
export const AUTH_ERROR_SENTENCES = {
  wrongPassword: "Wrong email or password.",
  tooManyAttempts: "Too many attempts. Wait a moment and try again.",
  expiredLink: "This link has expired. Request a new one.",
  generic: "Something went wrong. Try again.",
} as const;

/** Better Auth's codes, and the sentence each shows (rules 1 and 4). */
const SENTENCE_BY_CODE = new Map<string, string>([
  ["INVALID_EMAIL_OR_PASSWORD", AUTH_ERROR_SENTENCES.wrongPassword],
  ["INVALID_TOKEN", AUTH_ERROR_SENTENCES.expiredLink],
  ["TOKEN_EXPIRED", AUTH_ERROR_SENTENCES.expiredLink],
]);

/** The HTTP status Better Auth's limiter answers with (rule 15). */
const TOO_MANY_REQUESTS = 429;

type Refusal = { status?: number; code?: string; message?: string };

/** A refusal from Better Auth's client, thrown with its status and code so a page can word it. */
export class AuthRefusal extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor({ status, code, message }: Refusal) {
    super(message || code || "Refused");
    this.name = "AuthRefusal";
    this.status = status;
    this.code = code;
  }
}

/**
 * The sentence for a refusal: Better Auth client's error object or an
 * AuthRefusal, by its status, then its code. Anything else (a network
 * failure) says the generic sentence.
 */
export function authErrorSentence(error: unknown): string {
  if (typeof error !== "object" || error === null) return AUTH_ERROR_SENTENCES.generic;
  const { status, code } = error as Refusal;
  if (status === TOO_MANY_REQUESTS) return AUTH_ERROR_SENTENCES.tooManyAttempts;
  return (typeof code === "string" && SENTENCE_BY_CODE.get(code)) || AUTH_ERROR_SENTENCES.generic;
}
