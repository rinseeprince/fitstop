"use client"

import type { ReactNode } from "react"
import { SidebarNav } from "./sidebar-nav"
import { Button } from "./ui/button"
import { Menu, Bell, User, ChevronLeft, ChevronRight } from "lucide-react"
import { ThemeToggle } from "./theme-toggle"
import { motion, AnimatePresence } from "framer-motion"
import { useState } from "react"
import { ThemeProvider } from "next-themes"

export function AppLayout({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <ThemeProvider attribute="class" defaultTheme="light">
      <div className="flex min-h-screen bg-background">
        <AnimatePresence mode="wait">
          <motion.aside
            initial={false}
            animate={{ width: sidebarCollapsed ? 80 : 280 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="hidden lg:flex flex-col border-r border-border/50 glass-surface relative"
          >
            <div className="flex h-20 items-center justify-between px-6 border-b border-border/50">
              <motion.h1
                animate={{ opacity: sidebarCollapsed ? 0 : 1 }}
                className="text-xl font-semibold bg-gradient-to-r from-primary to-primary bg-clip-text text-transparent"
              >
                CoachHub
              </motion.h1>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="h-8 w-8"
              >
                {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <SidebarNav />
            </div>

            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="border-t border-border/50 p-6"
              >
                <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3 transition-all duration-150 hover:bg-muted">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xs bg-primary/10 text-primary">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">Coach Name</p>
                    <p className="text-xs text-muted-foreground truncate">coach@example.com</p>
                  </div>
                </div>
              </motion.div>
            )}
          </motion.aside>
        </AnimatePresence>

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          <header className="sticky top-0 z-10 flex h-20 items-center gap-4 border-b border-border/50 glass-surface px-6 lg:px-8">
            <Button variant="ghost" size="icon" className="lg:hidden">
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex-1" />
            <ThemeToggle />
            <Button variant="ghost" size="icon" className="relative hover:scale-105 transition-transform duration-150">
              <Bell className="h-5 w-5" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive animate-pulse" />
            </Button>
          </header>

          {/* Page Content */}
          <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </ThemeProvider>
  )
}
