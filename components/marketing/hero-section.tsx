"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight, CheckCircle } from "lucide-react"
import { motion } from "framer-motion"

const BENEFITS = [
  "AI-powered check-in analysis",
  "Custom training & nutrition plans",
  "Client progress tracking",
  "Automated reminders",
]

export function HeroSection() {
  return (
    <section className="relative overflow-hidden py-20 sm:py-32">
      {/* Background gradient */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5" />

      <div className="container px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
              For Personal Trainers & Coaches
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
          >
            Manage your clients.{" "}
            <span className="text-primary">Grow your business.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-6 text-lg text-muted-foreground sm:text-xl"
          >
            The all-in-one platform for fitness professionals. Track client
            progress, create personalized plans, and scale your coaching
            business with AI-powered insights.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
          >
            <Button size="lg" asChild>
              <Link href="/signup">
                Start Free Trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">Log in to your account</Link>
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
          >
            {BENEFITS.map((benefit, _i) => (
              <div
                key={benefit}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <CheckCircle className="h-4 w-4 text-primary" />
                {benefit}
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  )
}
