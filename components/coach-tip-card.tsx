"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Lightbulb, Sparkles } from "lucide-react"

const tips = [
  "Consistency beats intensity. Help your clients build sustainable habits.",
  "Progress photos speak louder than scale numbers. Track visual changes.",
  "Recovery is training. Remind clients that rest days are growth days.",
  "Small wins compound. Celebrate every milestone with your clients.",
]

export function CoachTipCard() {
  const [randomTip, setRandomTip] = useState(tips[0])

  useEffect(() => {
    // Select random tip only on client-side after hydration
    setRandomTip(tips[Math.floor(Math.random() * tips.length)])
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.4, duration: 0.3 }}
      className="relative overflow-hidden rounded-lg gradient-primary p-6 text-white shadow-custom-lg"
    >
      <motion.div
        animate={{
          scale: [1, 1.1, 1],
        }}
        transition={{
          duration: 6,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
        className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-white/8 blur-xl"
      />

      <div className="relative flex gap-4">
        <motion.div
          whileHover={{ scale: 1.1 }}
          transition={{ duration: 0.15 }}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xs bg-white/20 backdrop-blur-sm"
        >
          <Lightbulb className="h-5 w-5" />
        </motion.div>

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-base font-semibold">Coach Tip of the Day</h3>
            <Sparkles className="h-4 w-4" />
          </div>
          <p className="text-white/90 text-sm leading-relaxed">{randomTip}</p>
        </div>
      </div>
    </motion.div>
  )
}
