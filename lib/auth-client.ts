import { createAuthClient } from "better-auth/react";

/**
 * Better Auth in the browser, the one createAuthClient(...) in the tree
 * (docs/BETTER-AUTH-PLAN.md 2.4): sign-in, sign-out, the password reset, and
 * useSession(), which reads the session from Better Auth's own
 * /api/auth/get-session and renews its cookie. It answers on the page's own
 * origin. The profile and coach row come from GET /api/auth/me
 * (contexts/auth-context.tsx).
 */
export const authClient = createAuthClient();

/** The signed-in person as Better Auth's session names them. */
export type SessionUser = (typeof authClient.$Infer.Session)["user"];
