'use client'

import * as React from 'react'

// Where a popover opened inside a sheet mounts. A modal sheet blocks the mouse
// wheel everywhere outside its own content node (Radix hands react-remove-scroll
// the content as its one shard), so a popover portaled to <body> from inside a
// sheet could only be scrolled by dragging its scrollbar. SheetContent provides
// a node inside its content here and PopoverContent portals into it, so the
// popover is a DOM child of the sheet and inside every rule the sheet keys on
// its content: the wheel, the focus trap and the outside click. Outside a sheet
// there is no provider and a popover mounts on <body> as before.

const PortalContainerContext = React.createContext<HTMLElement | null>(null)

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null
  children: React.ReactNode
}) {
  return (
    <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>
  )
}

/** The node a popover opened here mounts in; undefined means <body>. */
export function usePortalContainer(): HTMLElement | undefined {
  return React.useContext(PortalContainerContext) ?? undefined
}
