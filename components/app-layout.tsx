import type { ReactNode } from "react"
import { NotificationsDropdown } from "./navbar/notifications-dropdown"
import { PersistentSidebar } from "./persistent-sidebar"

interface AppLayoutProps {
  children: ReactNode
  pageHeader?: ReactNode
  headerActions?: ReactNode
}

export function AppLayout({ children, pageHeader, headerActions }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <PersistentSidebar />
      {/* Main content — offset by the 80px rail this shell mounts */}
      <div className="flex-1 flex flex-col bg-background lg:ml-20">
        {/* Header - sticky with solid background and border */}
        <header className="sticky top-0 z-10 bg-white">
          {pageHeader ? (
            <div className="relative">
              {/* Actions/Notifications overlay (for pages that pass headerActions) */}
              {headerActions && (
                <div className="absolute top-4 right-6 flex items-center gap-3 z-10">
                  {headerActions}
                  <NotificationsDropdown />
                </div>
              )}
              {/* Page-specific header content */}
              {pageHeader}
            </div>
          ) : (
            <div className="flex h-16 items-center justify-end gap-2 px-6 lg:px-8">
              {headerActions}
              <NotificationsDropdown />
            </div>
          )}
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto px-6 lg:px-8 pt-4 pb-6 lg:pb-8 bg-[#f4f7f6]">{children}</main>
      </div>
    </div>
  )
}
