import {
  Button,
  Html,
  Head,
  Body,
  Container,
  Text,
  Section,
  Hr,
  Heading,
} from '@react-email/components'
import { PRODUCT_NAME } from '@/lib/constants'

interface ApproveEmailChangeEmailProps {
  name: string
  newEmail: string
  approveUrl: string
}

/**
 * The "Approve your email change" email, to the address a coach signs in with now: its link lasts one hour and
 * sends the "Confirm your new email" email to the new address, which alone changes it (docs/BETTER-AUTH-PLAN.md
 * 1.1 rule 6).
 */
export default function ApproveEmailChangeEmail({ name, newEmail, approveUrl }: ApproveEmailChangeEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section>
            <Heading style={h1}>Approve your email change</Heading>
            <Text style={text}>Hi {name},</Text>
            <Text style={text}>
              Someone asked to change the email you sign in to {PRODUCT_NAME} with to {newEmail}. Click the button below to
              approve the change. We'll then email {newEmail} a link to confirm it, and your email changes once that
              link is opened.
            </Text>
            <Section style={buttonContainer}>
              <Button style={button} href={approveUrl}>
                Approve the change
              </Button>
            </Section>
            <Text style={smallText}>
              Or copy and paste this URL into your browser:
            </Text>
            <Text style={linkText}>{approveUrl}</Text>
            <Hr style={hr} />
            <Text style={footer}>
              This link expires in one hour. If you didn't ask for this, you can ignore this email: your email stays
              as it is.
            </Text>
            <Text style={footer}>
              Best regards,
              <br />
              The {PRODUCT_NAME} Team
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

// Email styles, as emails/invitation-email.tsx
const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
}

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
}

const h1 = {
  color: '#333',
  fontSize: '24px',
  fontWeight: '600',
  lineHeight: '1.25',
  margin: '32px 0',
  textAlign: 'center' as const,
}

const text = {
  color: '#525f7f',
  fontSize: '16px',
  lineHeight: '1.5',
  margin: '16px 0',
  textAlign: 'left' as const,
}

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '32px 0',
}

const button = {
  backgroundColor: '#656ee8',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 24px',
  margin: '0',
  lineHeight: '1.5',
}

const linkText = {
  color: '#656ee8',
  fontSize: '14px',
  textDecoration: 'underline',
  margin: '8px 0',
}

const smallText = {
  color: '#8898aa',
  fontSize: '14px',
  lineHeight: '1.5',
  margin: '16px 0 8px',
}

const hr = {
  borderColor: '#e6ebf1',
  margin: '32px 0',
}

const footer = {
  color: '#8898aa',
  fontSize: '14px',
  lineHeight: '1.5',
  margin: '8px 0',
}
