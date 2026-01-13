import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 transition-all duration-150 outline-none',
        'focus:border-primary focus:ring-2 focus:ring-ring',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-gray-700',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
