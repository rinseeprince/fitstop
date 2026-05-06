"use client"

import { Plus, UserPlus, Send, Calendar, FileText, X } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { useState } from "react"
import { Button } from "./ui/button"

const actions = [
  { icon: UserPlus, label: "Add Client", color: "bg-[#0d9488]" },
  { icon: Send, label: "Send Check-In", color: "bg-[#0d9488]" },
  { icon: FileText, label: "Create Program", color: "bg-[#0d9488]" },
  { icon: Calendar, label: "Schedule Call", color: "bg-[#0f766e]" },
]

export function FloatingActionButton() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="fixed bottom-8 right-8 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-20 right-0 flex flex-col gap-3"
          >
            {actions.map((action, i) => (
              <motion.div
                key={action.label}
                initial={{ opacity: 0, y: 20, scale: 0.5 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.5 }}
                transition={{ delay: i * 0.05 }}
              >
                <Button
                  variant="outline"
                  className="group h-12 rounded-[6px] bg-white border border-[rgba(13,148,136,0.08)] text-[#0c1a1e] transition-all duration-150 hover:scale-105 whitespace-nowrap shadow-[0_6px_20px_rgba(13,148,136,0.08)]"
                >
                  <motion.div
                    whileHover={{ scale: 1.1 }}
                    transition={{ duration: 0.15 }}
                    className={`flex h-9 w-9 items-center justify-center rounded-[4px] ${action.color} text-white mr-3`}
                  >
                    <action.icon className="h-4 w-4" strokeWidth={1.5} />
                  </motion.div>
                  <span className="font-medium text-sm">{action.label}</span>
                </Button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex h-14 w-14 items-center justify-center rounded-[6px] bg-[#0d9488] text-white shadow-[0_8px_24px_rgba(13,148,136,0.30)]"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={isOpen ? "close" : "open"}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {isOpen ? <X className="h-5 w-5" strokeWidth={1.5} /> : <Plus className="h-5 w-5" strokeWidth={1.5} />}
          </motion.div>
        </AnimatePresence>
      </motion.button>
    </div>
  )
}
