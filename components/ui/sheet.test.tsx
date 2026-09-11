import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

import { Sheet, SheetContent, SheetTitle } from './sheet'

afterEach(cleanup)

// A toaster and an unrelated control beside an open sheet. The toaster markup
// is Sonner's shape, not Sonner: the guard keys on the attribute.
function mount() {
  const onOpenChange = vi.fn()
  render(
    <>
      <ol data-sonner-toaster="">
        <li data-sonner-toast="">
          <button type="button">Close toast</button>
        </li>
      </ol>
      <button type="button">Elsewhere</button>
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetTitle>A sheet</SheetTitle>
        </SheetContent>
      </Sheet>
    </>,
  )
  return onOpenChange
}

// Radix arms its outside-pointer listener a tick after the layer mounts, so
// the click that opened a layer cannot also close it.
const armed = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

describe('SheetContent and the toaster', () => {
  it('stays open when a toast over it is pressed', async () => {
    const onOpenChange = mount()
    await armed()

    fireEvent.pointerDown(screen.getByText('Close toast'))

    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('still closes on a pointer-down anywhere else outside', async () => {
    const onOpenChange = mount()
    await armed()

    fireEvent.pointerDown(screen.getByText('Elsewhere'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
