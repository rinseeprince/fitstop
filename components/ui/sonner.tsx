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
          toast: 'bg-card rounded-lg shadow-md border border-border p-4',
          title: 'text-sm font-medium text-foreground',
          description: 'text-xs text-muted-foreground mt-0.5',
          success:
            'bg-card border-success/20 [&>[data-icon]]:bg-success/10 [&>[data-icon]]:text-success',
          error:
            'bg-card border-destructive/20 [&>[data-icon]]:bg-destructive/10 [&>[data-icon]]:text-destructive',
          warning:
            'bg-card border-warning/20 [&>[data-icon]]:bg-warning/10 [&>[data-icon]]:text-warning',
          info: 'bg-card border-primary/20 [&>[data-icon]]:bg-primary/10 [&>[data-icon]]:text-primary',
          icon: 'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--success-bg': 'var(--card)',
          '--success-text': 'var(--foreground)',
          '--success-border': 'oklch(from var(--success) l c h / 0.2)',
          '--error-bg': 'var(--card)',
          '--error-text': 'var(--foreground)',
          '--error-border': 'oklch(from var(--destructive) l c h / 0.2)',
          '--warning-bg': 'var(--card)',
          '--warning-text': 'var(--foreground)',
          '--warning-border': 'oklch(from var(--warning) l c h / 0.2)',
          '--info-bg': 'var(--card)',
          '--info-text': 'var(--foreground)',
          '--info-border': 'oklch(from var(--primary) l c h / 0.2)',
        } as Record<string, string> & React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
