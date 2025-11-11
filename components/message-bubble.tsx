import { cn } from "@/lib/utils"
import type { Message } from "@/types/messages"

interface MessageBubbleProps {
  message: Message
  isCoach: boolean
}

export function MessageBubble({ message, isCoach }: MessageBubbleProps) {
  const time = message.timestamp.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })

  return (
    <div className={cn("flex gap-2 max-w-[80%]", isCoach ? "ml-auto flex-row-reverse" : "mr-auto")}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
        {message.senderName
          .split(" ")
          .map((n) => n[0])
          .join("")}
      </div>
      <div>
        <div
          className={cn(
            "rounded-2xl px-4 py-2",
            isCoach ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm",
          )}
        >
          {message.type === "image" && message.imageUrl ? (
            <img src={message.imageUrl || "/placeholder.svg"} alt="Shared image" className="max-w-[250px] rounded-lg" />
          ) : (
            <p className="text-sm leading-relaxed">{message.content}</p>
          )}
        </div>
        <p className={cn("text-xs text-muted-foreground mt-1 px-1", isCoach && "text-right")}>{time}</p>
      </div>
    </div>
  )
}
