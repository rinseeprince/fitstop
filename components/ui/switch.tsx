'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/clients/training/program-builder/builder-tokens'

/**
 * The Teal-Summit switch (migrated 2026-08-30).
 *
 * The treatment below is not new — it is the string that was hand-written at
 * ONE call site (`nutrition-surplus-settings.tsx`) and copied in half at two
 * more, while three further sites ran on the un-migrated OKLCH defaults. Six
 * call sites, three different looks: exactly the decay
 * `docs/newdesignsystem.md` → "The `ui/` primitives are Teal-Summit — HARD
 * RULE" describes. The look now lives here and the overrides are deleted.
 *
 * **A switch is the one sanctioned pill in this system.** `rounded-[11px]` on a
 * 22px track is a full radius, against the "no pill shapes" non-negotiable —
 * because on a switch the pill IS the affordance, not decoration. That
 * exemption is written into the design doc beside the spec; it does not extend
 * to anything else.
 *
 * Thumb travel (`translate-x-[18px]` on a 40px track with a 16px thumb) is
 * carried verbatim from the shipped call site so nothing moves by a pixel.
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-[11px] border border-transparent shadow-xs transition-all',
        'data-[state=checked]:bg-[#0d9488] data-[state=unchecked]:bg-[rgba(13,148,136,0.12)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        FOCUS_RING,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] ring-0 transition-transform data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
