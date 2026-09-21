import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet'

// Radix's popper measures its anchor through ResizeObserver, which jsdom lacks
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

afterEach(cleanup)

// A popover's list with more below it. jsdom lays nothing out, so the list says
// it overflows — react-remove-scroll reads these to decide whether the wheel may
// scroll it — and its overflow is inline, where jsdom's computed style finds it.
function ScrollingList() {
  return (
    <div
      data-testid="list"
      style={{ overflowY: 'auto' }}
      ref={(node) => {
        if (!node) return
        Object.defineProperty(node, 'scrollHeight', { configurable: true, value: 400 })
        Object.defineProperty(node, 'clientHeight', { configurable: true, value: 200 })
      }}
    >
      Pull Up
    </div>
  )
}

function wheel(target: Element): WheelEvent {
  const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('a popover opened inside a modal sheet', () => {
  function mountInSheet() {
    render(
      <>
        <div data-testid="page">The page behind</div>
        <Sheet open>
          <SheetContent>
            <SheetTitle>Hybrid day</SheetTitle>
            <SheetDescription>Session</SheetDescription>
            <Popover open>
              <PopoverTrigger>Add exercise</PopoverTrigger>
              <PopoverContent>
                <ScrollingList />
              </PopoverContent>
            </Popover>
          </SheetContent>
        </Sheet>
      </>,
    )
  }

  it('mounts inside the sheet', () => {
    mountInSheet()
    const sheet = document.querySelector('[data-slot="sheet-content"]')
    expect(sheet).not.toBeNull()
    expect(sheet!.contains(screen.getByTestId('list'))).toBe(true)
  })

  it('scrolls with the wheel, while the page behind the sheet does not', () => {
    mountInSheet()

    expect(wheel(screen.getByTestId('list')).defaultPrevented).toBe(false)
    // The sheet's scroll lock is on: the same wheel outside the sheet is refused
    expect(wheel(screen.getByTestId('page')).defaultPrevented).toBe(true)
  })
})

describe('a popover outside any sheet', () => {
  it('mounts on the body, as it always has', () => {
    render(
      <Popover open>
        <PopoverTrigger>Pick</PopoverTrigger>
        <PopoverContent>
          <ScrollingList />
        </PopoverContent>
      </Popover>,
    )

    const content = screen.getByTestId('list').closest('[data-slot="popover-content"]')
    // Its positioning wrapper is a child of <body>
    expect(content?.parentElement?.parentElement).toBe(document.body)
  })
})
