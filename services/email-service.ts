import crypto from 'node:crypto'
import { Resend } from 'resend'
import { render } from '@react-email/render'
import InvitationEmail from '@/emails/invitation-email'
import ActivationEmail from '@/emails/activation-email'
import { PRODUCT_NAME } from '@/lib/constants'

// Initialize Resend client
export const resend = new Resend(process.env.RESEND_API_KEY)

// The sender of every email the app sends (D30), as "Name <address>". Set
// EMAIL_FROM to an address on a domain verified in Resend; until then Resend's
// sandbox sender, which delivers to the Resend account's own address alone.
export const EMAIL_SENDER = process.env.EMAIL_FROM || `${PRODUCT_NAME} <onboarding@resend.dev>`

/**
 * Send an invitation email to a client
 */
export async function sendInvitationEmail(
  clientEmail: string,
  clientName: string,
  coachName: string,
  inviteToken: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate required environment variables
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY environment variable is not set')
    }

    // Get the current app URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const inviteUrl = `${appUrl}/invite/${inviteToken}`

    // Render the email template
    const emailHtml = await render(
      InvitationEmail({
        coachName,
        clientName,
        inviteUrl,
      })
    )

    // Send the email
    const { error } = await resend.emails.send({
      from: EMAIL_SENDER,
      to: clientEmail,
      subject: `You're invited to join ${PRODUCT_NAME} by ${coachName}`,
      html: emailHtml,
      // Optional: Add plain text version
      text: `Hi ${clientName},

${coachName} has invited you to track your fitness journey together on ${PRODUCT_NAME}.

Click this link to create your account: ${inviteUrl}

This invitation expires in 7 days.

Best regards,
The ${PRODUCT_NAME} Team`,
    })

    if (error) {
      console.error('Failed to send invitation email:', error)
      return {
        success: false,
        error: `Failed to send email: ${error.message}`,
      }
    }

    console.warn("Invitation email sent successfully")
    return { success: true }
  } catch (error) {
    console.error('Error in sendInvitationEmail:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    }
  }
}

/**
 * Send an activation email to a client when their coach activates them
 */
export async function sendActivationEmail(
  clientEmail: string,
  clientName: string,
  coachName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY environment variable is not set')
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const emailHtml = await render(
      ActivationEmail({
        coachName,
        clientName,
        appUrl,
      })
    )

    const { error } = await resend.emails.send({
      from: EMAIL_SENDER,
      to: clientEmail,
      subject: `${coachName} has set up your plan on ${PRODUCT_NAME}`,
      html: emailHtml,
      text: `Hi ${clientName},

${coachName} has finished setting up your personalised plan on ${PRODUCT_NAME}. Everything is ready for you to get started.

Open ${PRODUCT_NAME} to view your plan: ${appUrl}

Best regards,
The ${PRODUCT_NAME} Team`,
    })

    if (error) {
      console.error('Failed to send activation email:', error)
      return {
        success: false,
        error: `Failed to send email: ${error.message}`,
      }
    }

    console.warn("Activation email sent successfully")
    return { success: true }
  } catch (error) {
    console.error('Error in sendActivationEmail:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    }
  }
}

/**
 * Generate a secure random token for invitations
 */
export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex')
}