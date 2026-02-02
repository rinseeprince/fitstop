'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Sparkline } from './chart'

const statCardVariants = cva(
  'group relative overflow-hidden rounded-lg border transition-all duration-150 hover:shadow-custom-lg',
  {
    variants: {
      variant: {
        default: 'bg-card shadow-custom-md',
        glass: 'glass-card shadow-custom-md',
        'glass-heavy': 'glass-heavy shadow-custom-lg',
      },
    },
    defaultVariants: {
      variant: 'glass',
    },
  }
)

export interface StatCardProps extends React.ComponentProps<'div'>, VariantProps<typeof statCardVariants> {
  label: string
  value: string | number
  icon?: LucideIcon
  trend?: {
    value: number
    isPositive: boolean
  }
  sparklineData?: number[]
  description?: string
}

function StatCardV2({
  className,
  variant,
  label,
  value,
  icon: Icon,
  trend,
  sparklineData,
  description,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cn(statCardVariants({ variant }), className)}
      {...props}
    >
      <div className="p-6 space-y-4">
        {/* Header with Icon and Label */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            {label}
          </span>
          {Icon && (
            <div className="flex h-9 w-9 items-center justify-center rounded-xs bg-primary/10 text-primary transition-all duration-150 group-hover:bg-primary/20">
              <Icon className="h-4 w-4" />
            </div>
          )}
        </div>

        {/* Value and Trend */}
        <div className="space-y-1">
          <div className="flex items-end justify-between">
            <p className="text-4xl font-semibold tracking-tight">
              {value}
            </p>
            {trend && (
              <div className={cn(
                "flex items-center gap-1 text-sm font-medium",
                trend.isPositive ? "text-success" : "text-destructive"
              )}>
                <span className={cn(
                  "inline-block",
                  trend.isPositive ? "rotate-0" : "rotate-180"
                )}>
                  ↑
                </span>
                <span>{Math.abs(trend.value)}%</span>
              </div>
            )}
          </div>

          {description && (
            <p className="text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        {/* Sparkline */}
        {sparklineData && sparklineData.length > 0 && (
          <Sparkline data={sparklineData} color="hsl(var(--primary))" />
        )}
      </div>
    </div>
  )
}

export { StatCardV2, statCardVariants }
