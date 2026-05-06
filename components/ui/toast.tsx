'use client'

import * as React from 'react'
import * as ToastPrimitives from '@radix-ui/react-toast'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      'fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]',
      className,
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-[6px] border p-4 shadow-[0_6px_20px_rgba(13,148,136,0.10)] transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default: 'border-[rgba(13,148,136,0.08)] bg-white text-[#0c1a1e]',
        destructive:
          'destructive group border-[rgba(185,28,28,0.20)] bg-white text-[#0c1a1e]',
        success: 'success group border-[rgba(13,148,136,0.20)] bg-white text-[#0c1a1e]',
        warning: 'warning group border-[rgba(245,158,11,0.20)] bg-white text-[#0c1a1e]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  )
})
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-transparent px-3 text-sm font-medium text-[#5a7d82] transition-colors hover:bg-[rgba(13,148,136,0.05)] focus:outline-none focus:ring-2 focus:ring-[#0d9488] focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-[rgba(185,28,28,0.30)] group-[.destructive]:hover:bg-[rgba(185,28,28,0.08)] group-[.destructive]:hover:text-[#b91c1c] group-[.destructive]:focus:ring-[#b91c1c] group-[.success]:border-[rgba(13,148,136,0.30)] group-[.success]:hover:bg-[rgba(13,148,136,0.08)] group-[.success]:hover:text-[#0d9488] group-[.success]:focus:ring-[#0d9488] group-[.warning]:border-[rgba(245,158,11,0.30)] group-[.warning]:hover:bg-[rgba(245,158,11,0.08)] group-[.warning]:hover:text-[#d97706] group-[.warning]:focus:ring-[#d97706]',
      className,
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      'absolute right-2 top-2 rounded-[4px] p-1 text-[#93b0b4] opacity-0 transition-opacity hover:text-[#5a7d82] focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#0d9488] group-hover:opacity-100 group-[.destructive]:text-[rgba(185,28,28,0.70)] group-[.destructive]:hover:text-[#b91c1c] group-[.destructive]:focus:ring-[#b91c1c] group-[.success]:text-[rgba(13,148,136,0.70)] group-[.success]:hover:text-[#0d9488] group-[.success]:focus:ring-[#0d9488] group-[.warning]:text-[rgba(245,158,11,0.70)] group-[.warning]:hover:text-[#d97706] group-[.warning]:focus:ring-[#d97706]',
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" strokeWidth={1.5} />
  </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn('text-sm font-semibold', className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn('text-sm opacity-90', className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}
