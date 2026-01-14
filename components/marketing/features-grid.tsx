"use client"

import {
  Users,
  ClipboardCheck,
  Dumbbell,
  Apple,
  TrendingUp,
  Bell,
  Sparkles,
  BarChart3,
} from "lucide-react"
import { motion } from "framer-motion"

const FEATURES = [
  {
    icon: Users,
    title: "Client Management",
    description:
      "Keep all your client information organized in one place. Track goals, metrics, and progress effortlessly.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    icon: ClipboardCheck,
    title: "Weekly Check-ins",
    description:
      "Send automated check-in forms to clients. Collect photos, metrics, and feedback systematically.",
    color: "text-green-600",
    bg: "bg-green-500/10",
  },
  {
    icon: Sparkles,
    title: "AI-Powered Analysis",
    description:
      "Get instant AI summaries of check-ins. Identify trends and receive personalized coaching suggestions.",
    color: "text-violet-600",
    bg: "bg-violet-500/10",
  },
  {
    icon: Dumbbell,
    title: "Training Plans",
    description:
      "Create and assign custom training programs. Track completion and adjust based on progress.",
    color: "text-orange-600",
    bg: "bg-orange-500/10",
  },
  {
    icon: Apple,
    title: "Nutrition Planning",
    description:
      "Calculate TDEE and macros automatically. Build meal plans tailored to each client's goals.",
    color: "text-red-600",
    bg: "bg-red-500/10",
  },
  {
    icon: TrendingUp,
    title: "Progress Tracking",
    description:
      "Visualize client progress with charts and comparisons. Celebrate wins and identify areas to improve.",
    color: "text-blue-600",
    bg: "bg-blue-500/10",
  },
  {
    icon: Bell,
    title: "Smart Reminders",
    description:
      "Never miss a check-in with automated reminders. Keep clients accountable and engaged.",
    color: "text-amber-600",
    bg: "bg-amber-500/10",
  },
  {
    icon: BarChart3,
    title: "Business Insights",
    description:
      "Track your coaching metrics. Understand client retention, engagement, and business growth.",
    color: "text-cyan-600",
    bg: "bg-cyan-500/10",
  },
]

export function FeaturesGrid() {
  return (
    <section className="py-20 sm:py-24">
      <div className="container px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Everything you need to scale
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-4 text-lg text-muted-foreground"
          >
            Built by coaches, for coaches. All the tools you need to deliver
            exceptional results and grow your business.
          </motion.p>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="group rounded-xl border bg-card p-6 transition-all hover:shadow-md"
              >
                <div
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${feature.bg}`}
                >
                  <Icon className={`h-5 w-5 ${feature.color}`} />
                </div>
                <h3 className="mt-4 font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
