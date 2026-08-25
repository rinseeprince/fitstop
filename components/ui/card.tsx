import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const cardVariants = cva(
  'rounded-lg transition-colors duration-150',
  {
    variants: {
      variant: {
        default: 'bg-card border border-border',
        interactive: 'bg-card border border-border hover:border-primary/30 cursor-pointer',
        training: 'bg-training/5 border border-training/15',
        nutrition: 'bg-nutrition/5 border border-nutrition/15',
        ai: 'bg-card border border-border',
        success: 'bg-success/5 border border-success/15',
        warning: 'bg-warning/5 border border-warning/15',
        error: 'bg-destructive/5 border border-destructive/15',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

interface CardProps extends React.ComponentProps<'div'>, VariantProps<typeof cardVariants> {}

function Card({ className, variant, ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'px-5 py-4 border-b border-border flex items-center justify-between min-h-[64px]',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="card-title"
      className={cn('font-semibold text-foreground tracking-tight', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('flex items-center gap-2', className)}
      {...props}
    />
  )
}

function CardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-body"
      className={cn('p-5', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('p-5', className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'px-5 py-4 rounded-b-lg flex items-center',
        className,
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardBody,
  CardContent,
  CardFooter,
}
