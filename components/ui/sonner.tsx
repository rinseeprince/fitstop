'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner, ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: 'bg-white rounded-xl shadow-lg border border-gray-100 p-4',
          title: 'text-sm font-medium text-gray-900',
          description: 'text-xs text-gray-500 mt-0.5',
          success:
            'bg-white border-success/20 [&>[data-icon]]:bg-success/15 [&>[data-icon]]:text-success',
          error:
            'bg-white border-destructive/20 [&>[data-icon]]:bg-destructive/15 [&>[data-icon]]:text-destructive',
          warning:
            'bg-white border-warning/20 [&>[data-icon]]:bg-warning/15 [&>[data-icon]]:text-warning',
          info: 'bg-white border-primary/20 [&>[data-icon]]:bg-primary/15 [&>[data-icon]]:text-primary',
          icon: 'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--success-bg': 'white',
          '--success-text': 'var(--foreground)',
          '--success-border': 'oklch(from var(--success) l c h / 0.2)',
          '--error-bg': 'white',
          '--error-text': 'var(--foreground)',
          '--error-border': 'oklch(from var(--destructive) l c h / 0.2)',
          '--warning-bg': 'white',
          '--warning-text': 'var(--foreground)',
          '--warning-border': 'oklch(from var(--warning) l c h / 0.2)',
          '--info-bg': 'white',
          '--info-text': 'var(--foreground)',
          '--info-border': 'oklch(from var(--primary) l c h / 0.2)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
