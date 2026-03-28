import type React from "react"
import type { Metadata } from "next"
import { Instrument_Sans, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/contexts/auth-context"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { PersistentSidebar } from "@/components/persistent-sidebar"

const instrumentSans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"] })
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-mono-display" })

export const metadata: Metadata = {
  title: "CoachHub - Client Management Platform",
  description: "Manage your fitness coaching clients with ease",
  generator: "v0.app",
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
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
        <AuthProvider>
          <PersistentSidebar />
          {children}
          <Toaster />
          <SonnerToaster position="bottom-right" richColors />
        </AuthProvider>
      </body>
    </html>
  )
}
