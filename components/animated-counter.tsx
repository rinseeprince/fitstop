"use client"

import { useEffect, useState } from "react"
import { useReducedMotion, useSpring, useTransform } from "framer-motion"

export function AnimatedCounter({ value, duration = 1 }: { value: number; duration?: number }) {
  // A raw motion value, so MotionConfig's app-wide reducedMotion gate does not
  // reach it — that only filters values animated through a `motion` element.
  // Counting up from 0 IS the entrance here, so the reader's setting has to be
  // read directly and the figure shown outright.
  const shouldReduceMotion = useReducedMotion()
  const spring = useSpring(0, { duration: duration * 1000 })
  const display = useTransform(spring, (current) => Math.round(current))
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    if (shouldReduceMotion) {
      setDisplayValue(value)
      return
    }
    spring.set(value)
    const unsubscribe = display.on("change", (latest) => setDisplayValue(latest))
    return unsubscribe
  }, [value, spring, display, shouldReduceMotion])

  return <span>{displayValue}</span>
}
