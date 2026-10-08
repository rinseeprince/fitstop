import { render } from "@react-email/render"
import ResetPasswordEmail from "@/emails/reset-password-email"
import { captureApiError } from "@/lib/error-handler"
import { EMAIL_SENDER, resend } from "@/services/email-service"

/**
 * The emails Better Auth sends (docs/BETTER-AUTH-PLAN.md 2.5): one thin
 * function per kind, each rendering its template and sending it through the
 * app's Resend client, from the app's sender.
 */

type PasswordLink = { user: { email: string; name: string }; url: string }

/**
 * Better Auth's sendResetPassword: the "Reset your password" email. `url` is
 * Better Auth's own link (/api/auth/reset-password/<token>, one hour), which
 * lands on /reset-password with the token.
 *
 * It never throws. Forgot password answers every address with one sentence;
 * a failed send thrown from here would answer an address that has a login
 * differently, and tell anyone which addresses have one. The failure goes to
 * Sentry instead, and the person can ask again.
 */
export async function sendPasswordLinkEmail({ user, url }: PasswordLink): Promise<void> {
  try {
    const html = await render(ResetPasswordEmail({ name: user.name, resetUrl: url }))
    const { error } = await resend.emails.send({
      from: EMAIL_SENDER,
      to: user.email,
      subject: "Reset your password",
      html,
      text: `Hi ${user.name},

Someone asked to reset the password for your CoachHub account. Open this link to choose a new one: ${url}

This link expires in one hour and works once. If you didn't ask for it, you can ignore this email: your password stays as it is.

Best regards,
The CoachHub Team`,
    })
    if (error) throw new Error(`Resend refused the reset password email: ${error.message}`)
  } catch (error) {
    captureApiError(error, { source: "sendPasswordLinkEmail" })
  }
}
