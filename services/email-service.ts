import { Resend } from 'resend'
import { render } from '@react-email/render'
import InvitationEmail from '@/emails/invitation-email'

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = 'onboarding@resend.dev'
const FROM_NAME = 'CoachHub'

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
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: clientEmail,
      subject: `You're invited to join CoachHub by ${coachName}`,
      html: emailHtml,
      // Optional: Add plain text version
      text: `Hi ${clientName},

${coachName} has invited you to track your fitness journey together on CoachHub.

Click this link to create your account: ${inviteUrl}

This invitation expires in 7 days.

Best regards,
The CoachHub Team`,
    })

    if (error) {
      console.error('Failed to send invitation email:', error)
      return {
        success: false,
        error: `Failed to send email: ${error.message}`,
      }
    }

    console.log(`Invitation email sent successfully to ${clientEmail}`)
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
 * Generate a secure random token for invitations
 */
export function generateInviteToken(): string {
  // Use crypto for secure random token generation
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    const array = new Uint8Array(32)
    globalThis.crypto.getRandomValues(array)
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
  }
  
  // Fallback for Node.js environment
  const nodeCrypto = require('crypto')
  return nodeCrypto.randomBytes(32).toString('hex')
}