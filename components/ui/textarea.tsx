import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 transition-all duration-150 outline-none min-h-[100px]',
        'focus:border-primary focus:ring-2 focus:ring-ring',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
