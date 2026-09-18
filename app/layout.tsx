import type React from "react"
import type { Metadata } from "next"
import { Instrument_Sans, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/contexts/auth-context"
import { MotionPreferencesProvider } from "@/contexts/motion-preferences"
import { IntakePanelProvider } from "@/contexts/intake-panel-context"
import { UnitsProvider } from "@/contexts/units-context"
import { Toaster } from "@/components/ui/sonner"
import { FloatingIntakePanel } from "@/components/coach/floating-intake-panel"

const instrumentSans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"] })
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-mono-display" })

export const metadata: Metadata = {
  title: "CoachHub - Client Management Platform",
  description: "Manage your fitness coaching clients with ease",
  generator: "v0.app",
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" },
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${instrumentSans.className} ${jetbrainsMono.variable}`}>
        {/* Outermost: it configures rendering, holds no state, and every Framer
            animation in the app — including the auth pages' and the marketing
            page's — sits under it. */}
        <MotionPreferencesProvider>
          <AuthProvider>
            {/* Inside AuthProvider: a trainer's unit preference rides on the
                /api/auth/me payload, so UnitsProvider reads it from useAuth()
                rather than fetching it a second time. */}
            <UnitsProvider>
              <IntakePanelProvider>
                {children}
                <FloatingIntakePanel />
                <Toaster />
              </IntakePanelProvider>
            </UnitsProvider>
          </AuthProvider>
        </MotionPreferencesProvider>
      </body>
    </html>
  )
}
