import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          'bg-primary hover:bg-primary/90 text-primary-foreground rounded-md',
        secondary:
          'bg-secondary text-secondary-foreground border border-border hover:bg-muted rounded-md',
        ghost:
          'text-muted-foreground hover:text-foreground hover:bg-muted rounded-md',
        destructive:
          'bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md',
        ai:
          'bg-primary hover:bg-primary/90 text-primary-foreground rounded-md',
        outline:
          'border border-border bg-transparent text-foreground hover:bg-muted rounded-md',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2.5',
        sm: 'h-8 px-3 py-1.5 text-sm rounded-md',
        lg: 'h-11 px-6 py-3 text-base rounded-md',
        icon: 'h-9 w-9 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
