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

interface ActivationEmailProps {
  coachName: string
  clientName: string
  appUrl: string
}

export default function ActivationEmail({
  coachName,
  clientName,
  appUrl,
}: ActivationEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section>
            <Heading style={h1}>Your plan is ready!</Heading>
            <Text style={text}>Hi {clientName},</Text>
            <Text style={text}>
              {coachName} has finished setting up your personalised plan on CoachHub.
              Everything is ready for you to get started.
            </Text>
            <Text style={text}>
              Click the button below to open CoachHub and see your plan:
            </Text>
            <Section style={buttonContainer}>
              <Button style={button} href={appUrl}>
                View Your Plan
              </Button>
            </Section>
            <Hr style={hr} />
            <Text style={footer}>
              If you have any questions, reach out to {coachName} directly.
            </Text>
            <Text style={footer}>
              Best regards,
              <br />
              The CoachHub Team
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

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
