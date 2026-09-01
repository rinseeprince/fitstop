"use client"

import type { ReactNode } from "react"
import { MotionConfig } from "framer-motion"

/**
 * The app-wide reduced-motion gate for every Framer animation.
 *
 * `reducedMotion="user"` makes Framer read the reader's OS setting: positional
 * values (the transform props, plus width/height/inset) snap straight to their
 * target while opacity still animates, so an entrance keeps its fade and loses
 * its travel. `.animate-card-in` is gated the same way in `app/globals.css`,
 * so the CSS and Framer entrance paths behave identically — see
 * `docs/newdesignsystem.md` → "Where animation may be used".
 *
 * It is its own file because `MotionConfig` is a client component while the
 * root layout is a server one, and framer-motion's build ships no `use client`
 * directive of its own.
 *
 * It does NOT reach a `useSpring` / `useTransform` used outside a `motion`
 * element: `components/animated-counter.tsx` reads `useReducedMotion()` for
 * itself. Any future raw motion value must do the same.
 */
export function MotionPreferencesProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
