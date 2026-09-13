"use client"

import Link from "next/link"
import type { ComponentProps, MouseEvent } from "react"
import { hasEntryBeforePage, leaveCoachPage } from "@/lib/coach-history"
import { isPlainLeftClick } from "@/lib/pointer-navigation"

type BackLinkProps = Omit<ComponentProps<typeof Link>, "onClick">

/**
 * A page's arrow that is a real link to the page's parent. A plain click
 * LEAVES the page — back over every entry of it to the one before it began
 * (`lib/coach-history.ts`) — and otherwise lets the link navigate: a pasted
 * address, a fresh tab, the first screen after login. A modified click always
 * opens the href, in a new tab or window.
 */
export function BackLink({ href, ...rest }: BackLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(event) || !hasEntryBeforePage()) return
    event.preventDefault()
    leaveCoachPage()
  }
  return <Link href={href} onClick={handleClick} {...rest} />
}
