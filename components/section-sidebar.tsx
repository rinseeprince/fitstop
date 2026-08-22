"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { FOCUS_RING, LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens"

/**
 * The 200px white section sidebar that sits beside the 52px icon strip.
 *
 * Extracted from `components/clients/client-sidebar.tsx` when the Clients
 * roster grew a sidebar of its own: the frame, the header row grammar and the
 * 3px-teal-bar tab treatment are shared, while headers (avatar vs section
 * thumb, back arrow or none), tab contents (plain labels vs labels with counts
 * and queue badges) and footers (Settings vs a dashed action) belong to each
 * section. One implementation of the treatment, two shapes on top of it —
 * the alternative was a second copy of the bar, which is exactly the drift
 * docs/newdesignsystem.md keeps having to correct.
 *
 * Below `lg` the sidebar is hidden entirely and the main column takes the
 * width, which is what the client detail pages have always done.
 */
export function SectionSidebar({
  header,
  children,
  footer,
}: {
  /** The header row's contents — laid out as one `gap-2.5` flex row. */
  header: ReactNode
  children: ReactNode
  /** Pinned to the bottom above a hairline. Owns its own padding. */
  footer?: ReactNode
}) {
  return (
    <aside className="fixed left-[52px] top-0 z-20 hidden h-screen w-[200px] flex-col border-r border-[rgba(13,148,136,0.08)] bg-white lg:flex">
      <div className="px-4 pb-[14px] pt-[18px]">
        <div className="flex items-center gap-2.5">{header}</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>

      {footer && (
        <div className="border-t border-[rgba(13,148,136,0.08)]">{footer}</div>
      )}
    </aside>
  )
}

/** A group of tabs. Sections stack several of these with a group label between. */
export function SectionSidebarNav({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <nav className={cn("flex flex-col gap-1 px-2", className)}>{children}</nav>
  )
}

/** The uppercase divider above a group of tabs ("Attention"). Indented to the
 *  tab LABEL, not the sidebar edge, so it reads as their heading. */
export function SectionSidebarGroupLabel({ label }: { label: string }) {
  return <div className={cn("px-5 pb-1.5 pt-3.5", LABEL_CLASS)}>{label}</div>
}

type SectionSidebarTabProps = {
  label: string
  isActive: boolean
  /** Right-aligned count or badge. */
  trailing?: ReactNode
} & (
  | { href: string; onClick?: never }
  | { href?: never; onClick: () => void }
)

/**
 * One vertical tab. Renders a real `<Link>` when it addresses a URL and a real
 * `<button>` when it flips in-page state — never a div with an onClick, and
 * both carry the shared focus ring.
 */
export function SectionSidebarTab(props: SectionSidebarTabProps) {
  // Taken whole rather than destructured: destructuring severs the union's
  // property correlation, and TypeScript stops proving that the button branch
  // has a handler at all.
  const { label, isActive, trailing } = props
  const className = cn(
    "relative flex items-center gap-2 rounded-[6px] px-3 py-[9px] text-left text-[13.5px] transition-colors duration-150",
    FOCUS_RING,
    isActive
      ? "bg-[rgba(13,148,136,0.05)] font-semibold text-[#0c1a1e]"
      : "bg-transparent font-normal text-[#6b8a8e] hover:bg-[rgba(0,0,0,0.02)]",
  )

  const inner = (
    <>
      {isActive && (
        <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-[2px] bg-[#0d9488]" />
      )}
      <span className="truncate">{label}</span>
      {trailing && <span className="ml-auto flex items-center">{trailing}</span>}
    </>
  )

  // Presence, not truthiness: `href=""` type-checks, and a truthiness test
  // would drop it into the button branch with no handler — a control that
  // renders and focuses and does nothing.
  if (props.href !== undefined) {
    return (
      <Link
        href={props.href}
        aria-current={isActive ? "page" : undefined}
        className={className}
      >
        {inner}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-current={isActive ? "page" : undefined}
      className={className}
    >
      {inner}
    </button>
  )
}
