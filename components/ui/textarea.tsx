import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'w-full px-3.5 py-2.5 bg-transparent border border-border rounded-md text-sm placeholder:text-muted-foreground transition-colors duration-150 outline-none min-h-[100px]',
        'focus:border-primary focus:ring-1 focus:ring-primary/20',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
