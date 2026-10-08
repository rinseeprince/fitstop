import { render } from "@react-email/render"
import ResetPasswordEmail from "@/emails/reset-password-email"
import SetPasswordEmail from "@/emails/set-password-email"
import { captureApiError } from "@/lib/error-handler"
import { landsOnSetPassword } from "@/lib/password-link"
import { EMAIL_SENDER, resend } from "@/services/email-service"

/**
 * The emails Better Auth sends (docs/BETTER-AUTH-PLAN.md 2.5): one thin
 * function per kind, each rendering its template and sending it through the
 * app's Resend client, from the app's sender.
 */

type PasswordLink = { user: { email: string; name: string }; url: string }

type Email = { subject: string; html: string; text: string }

/**
 * Whether Better Auth's password link lands on /set-password. The page the
 * link was asked for rides in it as its callbackURL, and it alone tells the
 * owner's "Set your password" link from a reset (D17): only the server's own
 * call may ask for that page (lib/auth.ts refuses it over HTTP).
 */
function isSetPasswordLink(url: string): boolean {
  const landing = new URL(url).searchParams.get("callbackURL")
  return landing !== null && landsOnSetPassword(landing, url)
}

/** The email a password link goes out as: "Set your password for CoachHub" for a new coach (rule 9), else "Reset your password" (rule 4). */
async function passwordLinkEmail({ user, url }: PasswordLink): Promise<Email> {
  if (isSetPasswordLink(url)) {
    return {
      subject: "Set your password for CoachHub",
      html: await render(SetPasswordEmail({ name: user.name, setPasswordUrl: url })),
      text: `Hi ${user.name},

Your coach account on CoachHub is ready. Open this link to choose your password, then sign in with this email address: ${url}

This link expires in one hour and works once. If it has expired, open the sign-in page and click "Forgot your password?" for a new one.

Best regards,
The CoachHub Team`,
    }
  }
  return {
    subject: "Reset your password",
    html: await render(ResetPasswordEmail({ name: user.name, resetUrl: url })),
    text: `Hi ${user.name},

Someone asked to reset the password for your CoachHub account. Open this link to choose a new one: ${url}

This link expires in one hour and works once. If you didn't ask for it, you can ignore this email: your password stays as it is.

Best regards,
The CoachHub Team`,
  }
}

/**
 * Better Auth's sendResetPassword: the "Reset your password" email, or the
 * "Set your password" one for a link the owner's coach:create asked for. `url`
 * is Better Auth's own link (/api/auth/reset-password/<token>, one hour),
 * which lands on the page it was asked for (/reset-password or /set-password)
 * with the token.
 *
 * It never throws. Forgot password answers every address with one sentence;
 * a failed send thrown from here would answer an address that has a login
 * differently, and tell anyone which addresses have one. The failure goes to
 * Sentry instead, and the person can ask again.
 */
export async function sendPasswordLinkEmail(link: PasswordLink): Promise<void> {
  try {
    const { subject, html, text } = await passwordLinkEmail(link)
    const { error } = await resend.emails.send({ from: EMAIL_SENDER, to: link.user.email, subject, html, text })
    if (error) throw new Error(`Resend refused the "${subject}" email: ${error.message}`)
  } catch (error) {
    captureApiError(error, { source: "sendPasswordLinkEmail" })
  }
}
