import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { toast } from 'sonner'

import { FOCUS_RING } from '@/components/clients/training/program-builder/builder-tokens'
import { Toaster } from './sonner'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// Sonner's toaster only renders its list once a toast exists.
function raise(...args: Parameters<typeof toast.success>) {
  act(() => {
    toast.success(...args)
  })
}

describe('Toaster', () => {
  it('mounts Sonner bottom-right, in the body font, with richColors off', async () => {
    render(<Toaster />)
    raise('Session saved')

    const item = (await screen.findByText('Session saved')).closest('[data-sonner-toast]')
    const list = item?.closest('[data-sonner-toaster]')
    expect(list).toHaveAttribute('data-x-position', 'right')
    expect(list).toHaveAttribute('data-y-position', 'bottom')
    expect(list).toHaveClass('font-sans!')
    // Sonner writes the attribute only when the flag is on.
    expect(item?.getAttribute('data-rich-colors')).not.toBe('true')
  })

  it('paints the Teal-Summit card itself, Sonner\'s own switched off', async () => {
    render(<Toaster />)
    raise('Session saved', { description: 'Programs that already use a copy are unchanged.' })

    const title = await screen.findByText('Session saved')
    const item = title.closest('[data-sonner-toast]')
    // Sonner's card is off (unstyled); the classes below are the only card.
    expect(item).toHaveAttribute('data-styled', 'false')
    expect(item).toHaveAttribute('data-type', 'success')
    expect(item).toHaveClass(
      'pointer-events-auto',
      'rounded-[6px]',
      'bg-white',
      'shadow-[0_6px_20px_rgba(13,148,136,0.10)]',
      'data-[type=success]:border-[rgba(13,148,136,0.20)]',
      'data-[type=error]:border-[rgba(185,28,28,0.20)]',
    )
    expect(title).toHaveClass('text-sm!', 'font-semibold!')
    expect(screen.getByText('Programs that already use a copy are unchanged.')).toHaveClass(
      'text-sm!',
      'opacity-90',
    )
    // Sonner's own success glyph, present and tinted by the toast's type.
    expect(item?.querySelector('[data-icon] svg')).not.toBeNull()
    expect(item?.querySelector('[data-icon]')).toHaveClass('group-data-[type=success]:text-[#0d9488]')
  })

  it('carries an always-visible close button in the icon-action grammar with the system focus ring', async () => {
    render(<Toaster />)
    raise('Session saved')
    await screen.findByText('Session saved')

    const close = screen.getByRole('button', { name: /close toast/i })
    expect(close).toHaveClass('text-[#93b0b4]!', 'hover:text-[#5a7d82]!', 'rounded-[4px]!')
    expect(close).toHaveClass(...FOCUS_RING.split(' '))
    expect(close.querySelector('svg')).toHaveClass('h-4', 'w-4')
  })

  it('keeps a toast for five seconds', async () => {
    vi.useFakeTimers()
    render(<Toaster />)
    raise('Saved')
    // Sonner defers the state write by a timeout.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Saved')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_900)
    })
    expect(screen.getByText('Saved')).toBeInTheDocument()

    // 5 000 ms to close, then Sonner's 200 ms exit before it unmounts.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })
})
