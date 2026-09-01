import type { ReactNode } from "react"
import { ProgramsShell } from "@/components/programs/programs-shell"

// Section layout for /dashboard/programs/** — every view (library tables and
// the builder) renders inside the Programs shell, which mounts the 52px icon
// strip and the sticky topbar.
export default function ProgramsLayout({ children }: { children: ReactNode }) {
  return <ProgramsShell>{children}</ProgramsShell>
}
