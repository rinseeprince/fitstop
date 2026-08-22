import * as React from 'react'

import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/clients/training/program-builder/builder-tokens'

// Teal-Summit form field. Was un-migrated shadcn: `rounded-md` (8px, against
// the 6px this system mandates for every input), an OKLCH `border-border`,
// `text-sm`, and a 1px/20% focus ring instead of the shared one. Five files had
// already patched the radius by hand with `rounded-xs` at the call site, which
// is what a wrong default looks like from the outside.
//
// The background stays TRANSPARENT: on the white dialogs and cards these sit
// on it is indistinguishable from white, and a hard `bg-white` here would fill
// in any field deliberately placed on a tint.

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'w-full px-3.5 py-2.5 bg-transparent border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] text-[#0c1a1e] placeholder:text-[#93b0b4] transition-colors duration-150 outline-none',
        FOCUS_RING,
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-[#0c1a1e]',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
