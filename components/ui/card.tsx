import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const cardVariants = cva(
  'rounded-xl transition-all duration-150',
  {
    variants: {
      variant: {
        default: 'bg-white shadow-sm',
        interactive: 'bg-white shadow-sm hover:shadow-lg hover:scale-[1.01] cursor-pointer',
        training: 'bg-secondary/10 border border-secondary/20',
        nutrition: 'bg-warning/10 border border-warning/20',
        ai: 'bg-gradient-to-br from-violet-50/50 to-blue-50/50 shadow-sm',
        success: 'bg-success/10 border border-success/20',
        warning: 'bg-warning/10 border border-warning/20',
        error: 'bg-destructive/10 border border-destructive/20',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface CardProps extends React.ComponentProps<'div'>, VariantProps<typeof cardVariants> {}

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
        'px-5 py-4 border-b border-gray-100 flex items-center justify-between',
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
      className={cn('font-semibold text-gray-900', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-sm text-gray-500', className)}
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
        'px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl flex items-center',
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
