export interface Message {
  id: string
  senderId: string
  senderName: string
  content: string
  timestamp: Date
  type: "text" | "image"
  imageUrl?: string
}

export interface Conversation {
  id: string
  clientId: string
  clientName: string
  clientInitials: string
  lastMessage: string
  lastMessageTime: Date
  unread: number
  messages: Message[]
}
