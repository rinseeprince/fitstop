import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 [&>svg]:size-3 [&>svg]:pointer-events-none transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary/15 text-primary',
        secondary: 'bg-muted text-muted-foreground',
        destructive: 'bg-destructive/15 text-destructive',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warning',
        error: 'bg-destructive/15 text-destructive',
        info: 'bg-primary/15 text-primary',
        neutral: 'bg-muted text-muted-foreground',
        training: 'bg-secondary/15 text-secondary',
        nutrition: 'bg-warning/15 text-warning',
        ai: 'bg-accent/15 text-accent',
        outline: 'border border-border bg-transparent text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
