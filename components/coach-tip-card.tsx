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
    setRandomTip(tips[Math.floor(Math.random() * tips.length)])
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.2 }}
      className="relative overflow-hidden rounded-[6px] bg-[rgba(13,148,136,0.05)] p-6"
    >
      <div className="relative flex gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[6px] bg-[rgba(13,148,136,0.08)] text-[#0d9488]">
          <Lightbulb className="h-5 w-5" strokeWidth={1.5} />
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-base font-semibold tracking-tight text-[#0c1a1e]">Coach Tip of the Day</h3>
            <Sparkles className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
          </div>
          <p className="text-[#5a7d82] text-sm leading-relaxed">{randomTip}</p>
        </div>
      </div>
    </motion.div>
  )
}
