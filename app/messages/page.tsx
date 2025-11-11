"use client"

import { useState } from "react"
import { AppLayout } from "@/components/app-layout"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ConversationList } from "@/components/conversation-list"
import { MessageBubble } from "@/components/message-bubble"
import { Search, Send, Paperclip, Mic, Phone, Video, MoreVertical } from "lucide-react"
import type { Conversation } from "@/types/messages"

const mockConversations: Conversation[] = [
  {
    id: "1",
    clientId: "1",
    clientName: "Sarah Johnson",
    clientInitials: "SJ",
    lastMessage: "Thanks for the new program!",
    lastMessageTime: new Date(Date.now() - 1000 * 60 * 30),
    unread: 2,
    messages: [
      {
        id: "1",
        senderId: "coach",
        senderName: "Coach",
        content:
          "Hi Sarah! I've updated your program for next week. Check it out and let me know if you have any questions.",
        timestamp: new Date(Date.now() - 1000 * 60 * 60),
        type: "text",
      },
      {
        id: "2",
        senderId: "1",
        senderName: "Sarah Johnson",
        content: "Thanks for the new program!",
        timestamp: new Date(Date.now() - 1000 * 60 * 30),
        type: "text",
      },
      {
        id: "3",
        senderId: "1",
        senderName: "Sarah Johnson",
        content: "Looking forward to trying it out",
        timestamp: new Date(Date.now() - 1000 * 60 * 29),
        type: "text",
      },
    ],
  },
  {
    id: "2",
    clientId: "2",
    clientName: "Mike Chen",
    clientInitials: "MC",
    lastMessage: "When's our next call?",
    lastMessageTime: new Date(Date.now() - 1000 * 60 * 60 * 3),
    unread: 0,
    messages: [
      {
        id: "1",
        senderId: "2",
        senderName: "Mike Chen",
        content: "When's our next call?",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3),
        type: "text",
      },
    ],
  },
  {
    id: "3",
    clientId: "3",
    clientName: "Emma Davis",
    clientInitials: "ED",
    lastMessage: "Great session today!",
    lastMessageTime: new Date(Date.now() - 1000 * 60 * 60 * 24),
    unread: 0,
    messages: [
      {
        id: "1",
        senderId: "coach",
        senderName: "Coach",
        content: "How did the workout go?",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 25),
        type: "text",
      },
      {
        id: "2",
        senderId: "3",
        senderName: "Emma Davis",
        content: "Great session today!",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
        type: "text",
      },
    ],
  },
]

export default function MessagesPage() {
  const [conversations] = useState<Conversation[]>(mockConversations)
  const [selectedId, setSelectedId] = useState<string | null>(conversations[0]?.id || null)
  const [messageText, setMessageText] = useState("")
  const [searchQuery, setSearchQuery] = useState("")

  const selectedConversation = conversations.find((c) => c.id === selectedId)

  const handleSendMessage = () => {
    if (!messageText.trim()) return
    // In a real app, this would send the message to the backend
    console.log("Sending message:", messageText)
    setMessageText("")
  }

  const filteredConversations = conversations.filter((conv) =>
    conv.clientName.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Messages</h1>
          <p className="text-muted-foreground mt-1">Chat with your clients</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[350px_1fr] h-[calc(100vh-280px)]">
          {/* Conversations List */}
          <Card className="flex flex-col overflow-hidden">
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search conversations..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ConversationList
                conversations={filteredConversations}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </div>
          </Card>

          {/* Chat Area */}
          <Card className="flex flex-col overflow-hidden">
            {selectedConversation ? (
              <>
                {/* Chat Header */}
                <div className="flex items-center justify-between p-4 border-b">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                      {selectedConversation.clientInitials}
                    </div>
                    <div>
                      <p className="font-medium">{selectedConversation.clientName}</p>
                      <p className="text-xs text-muted-foreground">Active now</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon">
                      <Phone className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon">
                      <Video className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {selectedConversation.messages.map((message) => (
                    <MessageBubble key={message.id} message={message} isCoach={message.senderId === "coach"} />
                  ))}
                </div>

                {/* Message Input */}
                <div className="p-4 border-t">
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon">
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    <Input
                      placeholder="Type a message..."
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          handleSendMessage()
                        }
                      }}
                      className="flex-1"
                    />
                    <Button variant="ghost" size="icon">
                      <Mic className="h-4 w-4" />
                    </Button>
                    <Button onClick={handleSendMessage}>
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                Select a conversation to start messaging
              </div>
            )}
          </Card>
        </div>
      </div>
    </AppLayout>
  )
}
