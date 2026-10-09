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
import { ACCOUNT_DELETION_TAKES, PRODUCT_NAME, type DeletedAccount } from '@/lib/constants'

interface ConfirmDeleteAccountEmailProps {
  name: string
  account: DeletedAccount
  confirmUrl: string
}

/**
 * The "Confirm deleting your account" email, to the address the person signs in with: what goes with the account,
 * the coach's or the client's (docs/BETTER-AUTH-PLAN.md 1.1 rules 10 and 13), and Better Auth's link, which lasts
 * one day, works once, and deletes the account only where the person is still signed in.
 */
export default function ConfirmDeleteAccountEmail({ name, account, confirmUrl }: ConfirmDeleteAccountEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section>
            <Heading style={h1}>Confirm deleting your account</Heading>
            <Text style={text}>Hi {name},</Text>
            <Text style={text}>
              Someone asked to delete your {PRODUCT_NAME} account. {ACCOUNT_DELETION_TAKES[account]}
            </Text>
            <Section style={buttonContainer}>
              <Button style={button} href={confirmUrl}>
                Delete my account
              </Button>
            </Section>
            <Text style={smallText}>
              Or copy and paste this URL into your browser:
            </Text>
            <Text style={linkText}>{confirmUrl}</Text>
            <Hr style={hr} />
            <Text style={footer}>
              This link expires in one day and works once. Open it in the browser you asked from, while you're signed
              in. If you didn't ask for this, you can ignore this email: your account stays as it is.
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
