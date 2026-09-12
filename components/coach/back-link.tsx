"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ComponentProps, MouseEvent } from "react"
import { hasCoachHistory } from "@/lib/coach-history"
import { isPlainLeftClick } from "@/lib/pointer-navigation"

type BackLinkProps = Omit<ComponentProps<typeof Link>, "onClick">

/**
 * A back arrow that is a real link to its parent. A plain click goes back
 * when a coach page precedes the current entry (`lib/coach-history.ts`) and
 * otherwise lets the link navigate — a pasted address, a fresh tab. A
 * modified click always opens the href, in a new tab or window.
 * `hooks/use-coach-back.ts` is the same decision for an arrow that is not a
 * link.
 */
export function BackLink({ href, ...rest }: BackLinkProps) {
  const router = useRouter()
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(event) || !hasCoachHistory()) return
    event.preventDefault()
    router.back()
  }
  return <Link href={href} onClick={handleClick} {...rest} />
}
