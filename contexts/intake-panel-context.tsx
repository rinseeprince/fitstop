"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react"
import type { ClientIntake } from "@/types/client-intake"

type IntakePanelState = {
  clientId: string
  clientName: string
  intake: ClientIntake
}

type PersistedState = {
  panel: IntakePanelState | null
  isExpanded: boolean
}

type IntakePanelContextType = {
  /** The currently pinned intake data, or null when no panel is active */
  panel: IntakePanelState | null
  /** Whether the panel is expanded (true) or minimized (false) */
  isExpanded: boolean
  /** Open the panel expanded with intake data for a specific client */
  openPanel: (clientId: string, clientName: string, intake: ClientIntake) => void
  /** Open the panel already minimized (for pin-and-navigate flows) */
  openMinimized: (clientId: string, clientName: string, intake: ClientIntake) => void
  /** Update the intake data for the currently pinned client (keeps panel state) */
  updateIntake: (intake: ClientIntake) => void
  /** Minimize the panel to a bottom tab */
  minimizePanel: () => void
  /** Expand a minimized panel */
  expandPanel: () => void
  /** Close and clear the panel entirely */
  closePanel: () => void
  /** Toggle between expanded and minimized */
  togglePanel: () => void
}

const STORAGE_KEY = "coachhub:intake-panel"

const IntakePanelContext = createContext<IntakePanelContextType | null>(null)

function readStorage(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PersistedState
  } catch {
    return null
  }
}

function writeStorage(state: PersistedState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Private browsing or quota exceeded - silently ignore
  }
}

function clearStorage() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Silently ignore
  }
}

export function IntakePanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<IntakePanelState | null>(null)
  const [isExpanded, setIsExpanded] = useState(true)
  const [hydrated, setHydrated] = useState(false)

  // Restore from sessionStorage on mount (client-side only)
  useEffect(() => {
    const stored = readStorage()
    if (stored?.panel) {
      setPanel(stored.panel)
      setIsExpanded(stored.isExpanded)
    }
    setHydrated(true)
  }, [])

  // Persist to sessionStorage whenever state changes (skip until hydrated)
  useEffect(() => {
    if (!hydrated) return
    if (panel) {
      writeStorage({ panel, isExpanded })
    } else {
      clearStorage()
    }
  }, [panel, isExpanded, hydrated])

  const openPanel = useCallback(
    (clientId: string, clientName: string, intake: ClientIntake) => {
      setPanel({ clientId, clientName, intake })
      setIsExpanded(true)
    },
    []
  )

  const openMinimized = useCallback(
    (clientId: string, clientName: string, intake: ClientIntake) => {
      setPanel({ clientId, clientName, intake })
      setIsExpanded(false)
    },
    []
  )

  const updateIntake = useCallback((intake: ClientIntake) => {
    setPanel((prev) => (prev ? { ...prev, intake } : null))
  }, [])

  const minimizePanel = useCallback(() => {
    setIsExpanded(false)
  }, [])

  const expandPanel = useCallback(() => {
    setIsExpanded(true)
  }, [])

  const closePanel = useCallback(() => {
    setPanel(null)
    setIsExpanded(true)
  }, [])

  const togglePanel = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  return (
    <IntakePanelContext.Provider
      value={{
        panel: hydrated ? panel : null,
        isExpanded,
        openPanel,
        openMinimized,
        updateIntake,
        minimizePanel,
        expandPanel,
        closePanel,
        togglePanel,
      }}
    >
      {children}
    </IntakePanelContext.Provider>
  )
}

export function useIntakePanel() {
  const ctx = useContext(IntakePanelContext)
  if (!ctx) {
    throw new Error("useIntakePanel must be used within IntakePanelProvider")
  }
  return ctx
}
