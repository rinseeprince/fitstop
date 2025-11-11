"use client"

import { useEffect, useState } from "react"
import { useSpring, useTransform } from "framer-motion"

export function AnimatedCounter({ value, duration = 1 }: { value: number; duration?: number }) {
  const spring = useSpring(0, { duration: duration * 1000 })
  const display = useTransform(spring, (current) => Math.round(current))
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    spring.set(value)
    const unsubscribe = display.on("change", (latest) => setDisplayValue(latest))
    return unsubscribe
  }, [value, spring, display])

  return <span>{displayValue}</span>
}
