import * as React from 'react'

import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/clients/training/program-builder/builder-tokens'

// Teal-Summit multi-line field — the Input recipe, same reasoning.

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'w-full px-3.5 py-2.5 bg-transparent border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] text-[#0c1a1e] placeholder:text-[#93b0b4] transition-colors duration-150 outline-none min-h-[100px]',
        FOCUS_RING,
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
