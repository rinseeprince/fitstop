'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedControlOption {
  value: string
  label: string
  icon?: React.ReactNode
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[]
  value: string
  onChange: (value: string) => void
  className?: string
  size?: 'sm' | 'default'
}

function SegmentedControl({
  options,
  value,
  onChange,
  className,
  size = 'default',
}: SegmentedControlProps) {
  return (
    <div
      className={cn(
        'bg-gray-100 p-1 rounded-lg inline-flex',
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center gap-2 font-medium rounded-md transition-all duration-150',
              size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
              isActive
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {option.icon && (
              <span className={cn(
                '[&>svg]:w-4 [&>svg]:h-4',
                size === 'sm' && '[&>svg]:w-3.5 [&>svg]:h-3.5',
              )}>
                {option.icon}
              </span>
            )}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export { SegmentedControl }
