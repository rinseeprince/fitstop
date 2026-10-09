import { render } from "@react-email/render"
import ApproveEmailChangeEmail from "@/emails/approve-email-change-email"
import ConfirmDeleteAccountEmail from "@/emails/confirm-delete-account-email"
import ConfirmNewEmailEmail from "@/emails/confirm-new-email-email"
import ResetPasswordEmail from "@/emails/reset-password-email"
import SetPasswordEmail from "@/emails/set-password-email"
import { ACCOUNT_DELETION_TAKES, PRODUCT_NAME, type DeletedAccount } from "@/lib/constants"
import { captureApiError } from "@/lib/error-handler"
import { landsOnSetPassword } from "@/lib/password-link"
import { EMAIL_SENDER, resend } from "@/services/email-service"

/**
 * The emails Better Auth sends (docs/BETTER-AUTH-PLAN.md 2.5): one thin
 * function per kind, each rendering its template and sending it through the
 * app's Resend client, from the app's sender.
 */

type Recipient = { email: string; name: string }

type PasswordLink = { user: Recipient; url: string }

type Email = { subject: string; html: string; text: string }

/**
 * Renders one email and sends it to `to`. It never throws: Better Auth sends
 * its emails after the answer has gone (lib/auth.ts, runAfterAnswer), so no
 * one waits on the send, and a failure goes to Sentry instead, as `source`.
 */
async function sendAuthEmail(source: string, to: string, compose: () => Promise<Email>): Promise<void> {
  try {
    const { subject, html, text } = await compose()
    const { error } = await resend.emails.send({ from: EMAIL_SENDER, to, subject, html, text })
    if (error) throw new Error(`Resend refused the "${subject}" email: ${error.message}`)
  } catch (error) {
    captureApiError(error, { source })
  }
}

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

/** The email a password link goes out as: "Set your password for ${PRODUCT_NAME}" for a new coach (rule 9), else "Reset your password" (rule 4). */
async function passwordLinkEmail({ user, url }: PasswordLink): Promise<Email> {
  if (isSetPasswordLink(url)) {
    return {
      subject: `Set your password for ${PRODUCT_NAME}`,
      html: await render(SetPasswordEmail({ name: user.name, setPasswordUrl: url })),
      text: `Hi ${user.name},

Your coach account on ${PRODUCT_NAME} is ready. Open this link to choose your password, then sign in with this email address: ${url}

This link expires in one hour and works once. If it has expired, open the sign-in page and click "Forgot your password?" for a new one.

Best regards,
The ${PRODUCT_NAME} Team`,
    }
  }
  return {
    subject: "Reset your password",
    html: await render(ResetPasswordEmail({ name: user.name, resetUrl: url })),
    text: `Hi ${user.name},

Someone asked to reset the password for your ${PRODUCT_NAME} account. Open this link to choose a new one: ${url}

This link expires in one hour and works once. If you didn't ask for it, you can ignore this email: your password stays as it is.

Best regards,
The ${PRODUCT_NAME} Team`,
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
  await sendAuthEmail("sendPasswordLinkEmail", link.user.email, () => passwordLinkEmail(link))
}

/**
 * Better Auth's sendChangeEmailConfirmation (rule 6): "Approve your email
 * change", to the address the coach signs in with now (`user.email`), naming
 * the new one. Its link (/api/auth/verify-email, one hour) changes nothing: it
 * has Better Auth send the "Confirm your new email" email to the new address.
 */
export async function sendApproveEmailChangeEmail({ user, newEmail, url }: { user: Recipient; newEmail: string; url: string }): Promise<void> {
  await sendAuthEmail("sendApproveEmailChangeEmail", user.email, async () => ({
    subject: "Approve your email change",
    html: await render(ApproveEmailChangeEmail({ name: user.name, newEmail, approveUrl: url })),
    text: `Hi ${user.name},

Someone asked to change the email you sign in to ${PRODUCT_NAME} with to ${newEmail}. Open this link to approve the change: ${url}

We'll then email ${newEmail} a link to confirm it, and your email changes once that link is opened. This link expires in one hour. If you didn't ask for this, you can ignore this email: your email stays as it is.

Best regards,
The ${PRODUCT_NAME} Team`,
  }))
}

/**
 * Better Auth's sendVerificationEmail, which it calls once the current
 * address approved a change (rule 6): "Confirm your new email", to the new
 * address, which Better Auth hands over as `user.email`. Opening its link
 * (/api/auth/verify-email, one hour) is what changes the address. No login is
 * ever unverified (D4), so nothing else asks for this email.
 */
export async function sendConfirmNewEmailEmail({ user, url }: { user: Recipient; url: string }): Promise<void> {
  await sendAuthEmail("sendConfirmNewEmailEmail", user.email, async () => ({
    subject: "Confirm your new email",
    html: await render(ConfirmNewEmailEmail({ name: user.name, confirmUrl: url })),
    text: `Hi ${user.name},

Open this link to confirm this address: ${url}

Once you do, you sign in to ${PRODUCT_NAME} with this email. This link expires in one hour. If you didn't ask for this, you can ignore this email: nothing changes.

Best regards,
The ${PRODUCT_NAME} Team`,
  }))
}

/**
 * Better Auth's sendDeleteAccountVerification (rules 10 and 13), through
 * lib/auth.ts's sendDeletionConfirmation, which reads the asker's role:
 * "Confirm deleting your account", to the address they sign in with, saying
 * what goes with a coach's account or a client's. Its link
 * (/api/auth/delete-user/callback, one day, once) deletes the account when
 * opened where the person is still signed in, and lands on /login?deleted=1.
 */
export async function sendConfirmDeleteAccountEmail({ user, url, account }: { user: Recipient; url: string; account: DeletedAccount }): Promise<void> {
  await sendAuthEmail("sendConfirmDeleteAccountEmail", user.email, async () => ({
    subject: "Confirm deleting your account",
    html: await render(ConfirmDeleteAccountEmail({ name: user.name, account, confirmUrl: url })),
    text: `Hi ${user.name},

Someone asked to delete your ${PRODUCT_NAME} account. ${ACCOUNT_DELETION_TAKES[account]} Open this link to delete it: ${url}

This link expires in one day and works once. Open it in the browser you asked from, while you're signed in. If you didn't ask for this, you can ignore this email: your account stays as it is.

Best regards,
The ${PRODUCT_NAME} Team`,
  }))
}
