'use client'

import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { CheckIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/clients/training/program-builder/builder-tokens'

/**
 * The Teal-Summit tick (migrated 2026-10-02).
 *
 * The treatment is the string the client's workout tracker hand-wrote at both
 * of its ticks (`set-row.tsx`, `exercise-tracker-block.tsx`) to correct the
 * un-migrated OKLCH default — a teal-grey box, filled teal when ticked, a
 * light teal while some of an exercise's sets are — moved here, with the
 * shared focus ring the default lacked (it drew a 3px OKLCH ring). The habits
 * page's tick was about to become a third copy. The look now lives here and
 * the overrides are deleted; a call site passes a size (`size-5` on the
 * client's ticks) and nothing else of the look.
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-4 shrink-0 rounded-[4px] border border-[#93b0b4] shadow-xs transition-colors duration-150 outline-none',
        'data-[state=checked]:border-[#0d9488] data-[state=checked]:bg-[#0d9488] data-[state=checked]:text-white',
        'data-[state=indeterminate]:border-[#0d9488] data-[state=indeterminate]:bg-[rgba(13,148,136,0.25)]',
        'aria-invalid:border-[#c06060]',
        FOCUS_RING,
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
