import { SET_PASSWORD_PAGE } from "@/lib/constants"

/**
 * Whether a password link's landing is /set-password, the page the owner's
 * "Set your password" link opens (D17). The landing is read as a browser
 * resolves it against `base`, so the page named by its full address or with
 * a query of its own counts, and a landing that cannot be read does not.
 * lib/auth.ts asks it of the landing a request asks for, and the email picker
 * (services/auth-email-service.ts) of the landing a link carries: one answer.
 */
export function landsOnSetPassword(landing: string, base: string): boolean {
  return URL.canParse(landing, base) && new URL(landing, base).pathname === SET_PASSWORD_PAGE
}
